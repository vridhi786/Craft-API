import { supabase } from '../config/supabase.js';
import { run } from '../utils/dbError.js';
import { mapProduct } from '../utils/mappers.js';
import { getSettings } from './settingsService.js';
import { validateCoupon } from './couponService.js';
import { ApiError } from '../utils/ApiError.js';
import { cleanText } from '../utils/sanitizeInput.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { unitPrice, availableStock, hasActiveVariants } from '../utils/pricing.js';

function resolveCustomizations(product, input = {}) {
  const values = [];
  const errors = [];
  for (const field of product.customFields || []) {
    const raw = cleanText(input[field.key] ?? '');
    if (!raw) {
      if (field.required) errors.push({ code: 'CUSTOMIZATION_REQUIRED', field: field.key, message: `"${field.label}" is required for ${product.name}` });
      continue;
    }
    if (raw.length > field.maxLength) errors.push({ code: 'CUSTOMIZATION_INVALID', field: field.key, message: `"${field.label}" must be at most ${field.maxLength} characters` });
    else if (field.type === 'select' && !field.options.includes(raw)) errors.push({ code: 'CUSTOMIZATION_INVALID', field: field.key, message: `Choose a valid option for "${field.label}"` });
    else values.push({ key: field.key, label: field.label, value: raw });
  }
  return { values, errors };
}

/**
 * The single source of truth for money. The browser only sends product ids, variant ids, quantities and
 * customisation text; every price, discount, shipping charge and total is calculated here.
 */
export async function buildQuote({ items, couponCode, phone, strictCoupon = false }) {
  const settings = await getSettings();
  const ids = [...new Set(items.map((i) => i.productId))];
  const { data: rows } = await run(supabase.from('products').select('*, variants:product_variants(*)').in('id', ids));
  const products = new Map(rows.map((r) => { const p = mapProduct(r); return [p.id, p]; }));

  const lines = [];
  const issues = [];
  const demand = new Map();

  items.forEach((item, index) => {
    const p = products.get(item.productId);
    if (!p || !p.isActive || p.isArchived) {
      issues.push({ index, productId: item.productId, code: 'UNAVAILABLE', message: 'This product is no longer available' });
      return;
    }
    let variant = null;
    if (hasActiveVariants(p)) {
      variant = item.variantId ? p.variants.find((v) => v.id === item.variantId) || null : null;
      if (!variant || variant.isActive === false) {
        issues.push({ index, productId: item.productId, name: p.name, code: 'VARIANT_REQUIRED', message: `Please choose an option for ${p.name}` });
        return;
      }
    }
    const custom = resolveCustomizations(p, item.customizations);
    custom.errors.forEach((e) => issues.push({ index, productId: item.productId, name: p.name, ...e }));
    const { mrp, price } = unitPrice(p, variant);
    const untracked = p.trackInventory === false;
    const key = `${p.id}:${variant?.id || ''}`;
    demand.set(key, (demand.get(key) || 0) + item.quantity);
    const available = availableStock(p, variant);
    if (!untracked && demand.get(key) > available) {
      issues.push({
        index, productId: item.productId, name: p.name, available,
        code: available <= 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK',
        message: available <= 0 ? `${p.name} is out of stock` : `Only ${available} of ${p.name} available`,
      });
    }
    lines.push({
      productId: p.id, variantId: variant ? variant.id : null, name: p.name, sku: variant?.sku || p.sku, slug: p.slug,
      image: p.images?.[0]?.url || null, variantLabel: variant?.label || null, quantity: item.quantity,
      mrp, unitPrice: price, lineTotal: fromPaise(toPaise(price) * item.quantity),
      customizations: custom.values, untracked,
      _categoryIds: [p.categoryId, p.subcategoryId, p.childCategoryId].filter(Boolean),
    });
  });

  const subtotalPaise = lines.reduce((s, l) => s + toPaise(l.unitPrice) * l.quantity, 0);

  let discountPaise = 0;
  let couponDoc = null;
  let coupon = null;
  let couponError = null;
  if (couponCode) {
    try {
      if (!settings.coupons.enabled) throw new ApiError(400, 'COUPON_INVALID', 'Coupons are not available right now');
      const result = await validateCoupon({ code: couponCode, lines, subtotalPaise, phone });
      discountPaise = Math.min(result.discountPaise, subtotalPaise);
      coupon = { code: result.coupon.code, description: result.coupon.description };
      couponDoc = result.coupon;
    } catch (err) {
      if (strictCoupon || !(err instanceof ApiError)) throw err;
      couponError = { code: err.code, message: err.message };
    }
  }

  const afterDiscountPaise = subtotalPaise - discountPaise;
  const threshold = toPaise(settings.shipping.freeShippingThreshold || 0);
  const flat = toPaise(settings.shipping.flatRate || 0);
  const freeShipping = lines.length === 0 || (threshold > 0 && afterDiscountPaise >= threshold);
  const shippingPaise = freeShipping ? 0 : flat;
  const totalPaise = afterDiscountPaise + shippingPaise;

  return {
    currency: 'INR',
    lines,
    issues,
    subtotal: fromPaise(subtotalPaise),
    discount: fromPaise(discountPaise),
    shippingCharge: fromPaise(shippingPaise),
    total: fromPaise(totalPaise),
    coupon,
    couponError,
    freeShippingRemaining: threshold > 0 && !freeShipping ? fromPaise(threshold - afterDiscountPaise) : 0,
    maintenance: settings.maintenance.enabled ? settings.maintenance.message : null,
    _couponDoc: couponDoc,
  };
}

/** Strips internal fields before sending a quote to the browser. */
export function publicQuote(quote) {
  const { _couponDoc, ...rest } = quote;
  return { ...rest, lines: quote.lines.map(({ _categoryIds, untracked, ...l }) => l) };
}
