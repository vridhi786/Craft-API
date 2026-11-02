import { discountPercent } from './money.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Effective {mrp, price} for a product (and optional variant). `mrp` is only > price when a real discount exists. */
export function unitPrice(product, variant = null) {
  let base = product.price;
  let sale = num(product.discountPrice);
  if (variant) {
    const vPrice = num(variant.price);
    if (vPrice !== null) {
      base = vPrice;
      sale = num(variant.discountPrice);
    } else if (num(variant.discountPrice) !== null) {
      sale = num(variant.discountPrice);
    }
  }
  const price = sale !== null && sale >= 0 && sale < base ? sale : base;
  return { mrp: base, price, discountPercent: discountPercent(base, price) };
}

export const hasActiveVariants = (product) => Array.isArray(product.variants) && product.variants.some((v) => v.isActive !== false);

/** Units available for purchase. Infinity when inventory is not tracked. */
export function availableStock(product, variant = null) {
  if (product.trackInventory === false) return Infinity;
  return Math.max(0, Number(variant ? variant.stock : product.stock) || 0);
}

export function productAvailability(product) {
  if (product.trackInventory === false) return 'in_stock';
  const threshold = Number(product.lowStockThreshold) || 0;
  if (hasActiveVariants(product)) {
    const stocks = product.variants.filter((v) => v.isActive !== false).map((v) => Number(v.stock) || 0);
    const total = stocks.reduce((a, b) => a + b, 0);
    if (total <= 0) return 'out_of_stock';
    return total <= threshold ? 'low_stock' : 'in_stock';
  }
  const s = Number(product.stock) || 0;
  if (s <= 0) return 'out_of_stock';
  return s <= threshold ? 'low_stock' : 'in_stock';
}

export function variantAvailability(product, variant) {
  if (product.trackInventory === false) return 'in_stock';
  const s = Number(variant.stock) || 0;
  if (s <= 0) return 'out_of_stock';
  return s <= (Number(variant.lowStockThreshold ?? product.lowStockThreshold) || 0) ? 'low_stock' : 'in_stock';
}

/** Lowest effective price a shopper can pay (used for sorting and price filters). */
export function minimumPrice(product) {
  if (hasActiveVariants(product)) {
    return Math.min(...product.variants.filter((v) => v.isActive !== false).map((v) => unitPrice(product, v).price));
  }
  return unitPrice(product).price;
}
