import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toApiError } from '../../utils/dbError.js';
import { ApiError } from '../../utils/ApiError.js';
import { escapeLike, safeFilterTerm } from '../../utils/regex.js';
import { isUuid } from '../../utils/ids.js';
import { deepMerge } from '../../utils/deepMerge.js';
import { mapProduct, mapOrder, mapCoupon, mapOffer, mapAdmin, toSafeAdmin } from '../../utils/mappers.js';
import { unitPrice, productAvailability, minimumPrice } from '../../utils/pricing.js';

test('Postgres/PostgREST errors map to the same ApiError codes the website expects', () => {
  const dupSku = toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "products_sku_key"' });
  assert.deepEqual([dupSku.status, dupSku.code], [409, 'DUPLICATE_SKU']);
  assert.equal(toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "categories_sibling_name_key"' }).code, 'DUPLICATE_NAME');
  assert.equal(toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "orders_idempotency_key_key"' }).code, 'DUPLICATE_ORDER');
  assert.equal(toApiError({ code: '23505', message: 'duplicate key value violates unique constraint "reviews_one_per_order_product"' }).code, 'REVIEW_EXISTS');
  assert.equal(toApiError({ code: '23505', message: 'unknown_constraint' }).code, 'DUPLICATE');
  assert.equal(toApiError({ code: '23503', message: 'fk' }).status, 409);
  assert.equal(toApiError({ code: '23514', message: 'violates check constraint "coupons_percent_chk"' }).status, 400);
  assert.equal(toApiError({ code: '22P02', message: 'invalid input syntax for type uuid' }).code, 'INVALID_INPUT');
  assert.equal(toApiError({ code: 'PGRST116', message: 'no rows' }).status, 404);
  assert.equal(toApiError({ code: '', message: 'TypeError: fetch failed' }).status, 503);
});

test('errors raised by our SQL functions (P0001) map to HTTP semantics', () => {
  const oos = toApiError({ code: 'P0001', message: 'OUT_OF_STOCK', details: 'Oak Frame' });
  assert.deepEqual([oos.status, oos.code], [409, 'OUT_OF_STOCK']);
  assert.match(oos.message, /Oak Frame/);
  assert.equal(toApiError({ code: 'P0001', message: 'COUPON_EXHAUSTED' }).code, 'COUPON_EXHAUSTED');
  assert.equal(toApiError({ code: 'P0001', message: 'INVALID_TRANSITION' }).status, 409);
  assert.equal(toApiError({ code: 'P0001', message: 'NEGATIVE_STOCK' }).status, 409);
  assert.equal(toApiError({ code: 'P0001', message: 'NOT_FOUND' }).status, 404);
  assert.equal(toApiError({ code: 'P0001', message: 'INVALID_TARGET' }).status, 400);
});

test('unknown database errors never leak internals', () => {
  const e = toApiError({ code: 'XX000', message: 'secret internal detail: relation "x" at /var/lib' });
  assert.equal(e.status, 500);
  assert.ok(!e.message.includes('secret'));
  const same = new ApiError(418, 'X', 'y');
  assert.equal(toApiError(same), same);
});

test('LIKE escaping and PostgREST filter whitelisting', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  assert.equal(safeFilterTerm('asha),status.eq.cancelled,(x'), 'ashastatuseqcancelledx');
  assert.equal(safeFilterTerm('CW-261031-AB12 @x'), 'CW-261031-AB12 @x');
  assert.equal(safeFilterTerm("a'b%c_d"), 'abcd');
});

test('uuid check', () => {
  assert.ok(isUuid('00000000-0000-4000-8000-000000000000'));
  assert.ok(!isUuid('64b7f0f0f0f0f0f0f0f0f0f0'));
  assert.ok(!isUuid('abc'));
  assert.ok(!isUuid(undefined));
});

test('deepMerge keeps sibling defaults on partial settings updates', () => {
  const out = deepMerge({ hero: { title: 'T', subtitle: 'S' }, a: 1, list: [1] }, { hero: { title: 'X' }, list: [2, 3] });
  assert.deepEqual(out, { hero: { title: 'X', subtitle: 'S' }, a: 1, list: [2, 3] });
});

const productRow = {
  id: 'p1', name: 'Frame', slug: 'frame', sku: 'F1', short_description: '', description: '', specifications: [], category_id: 'c1', subcategory_id: null, child_category_id: null,
  images: [], price: '500.00', discount_price: 400, min_price: 400, stock: 3, low_stock_threshold: 2, track_inventory: true, stock_status: 'low_stock', custom_fields: [],
  is_featured: false, is_bestseller: true, is_new_arrival: false, keywords: ['a'], seo_title: null, seo_description: null, shipping_info: '', is_active: true, is_archived: false, sold_count: 0,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  category: { id: 'c1', name: 'Decor', slug: 'decor', level: 1 },
  variants: [{ id: 'v2', label: 'Large', price: 800, discount_price: null, stock: 0, is_active: true, sort_order: 2 }, { id: 'v1', label: 'Small', price: null, discount_price: null, stock: 4, is_active: true, sort_order: 1 }],
};

test('mapProduct produces the camelCase shape (with id and _id) the pricing code expects', () => {
  const p = mapProduct(productRow);
  assert.equal(p.id, 'p1'); assert.equal(p._id, 'p1');
  assert.equal(p.price, 500); assert.equal(typeof p.price, 'number');
  assert.equal(p.discountPrice, 400);
  assert.deepEqual(p.variants.map((v) => v.label), ['Small', 'Large']);      // ordered by sort_order
  assert.equal(p.variants[0]._id, 'v1');
  assert.equal(p.category.name, 'Decor');
  assert.equal(p.subcategory, null);
  assert.equal(p.categoryId, 'c1');
  // and the shared pricing helpers work on it unchanged:
  assert.equal(unitPrice(p).price, 400);
  assert.equal(unitPrice(p, p.variants[1]).price, 800);
  assert.equal(minimumPrice(p), 400);
  assert.equal(productAvailability(p), 'in_stock');    // active variants hold 4 units in total, above the threshold of 2
});

test('mapOrder rebuilds the nested order shape from joined rows', () => {
  const o = mapOrder({
    id: 'o1', order_id: 'CW-1', idempotency_key: null, customer_name: 'Asha', customer_phone: '9574546023', customer_whatsapp: null, customer_email: 'a@x.com',
    address: { city: 'Surat' }, subtotal: '800.00', discount: 0, shipping_charge: 60, total: 860, currency: 'INR', coupon_code: null, status: 'confirmed',
    payment_status: 'unpaid', amount_collected: 0, customer_notes: null, gift_message: null, stock_released: false, created_at: 't', updated_at: 't',
    items: [{ product_id: 'p1', name: 'Frame', quantity: 2, mrp: 500, unit_price: 400, line_total: 800, customizations: [{ key: 'k', label: 'L', value: 'V' }], tracked: true }],
    history: [{ status: 'confirmed', at: '2026-01-02', by_actor: 'admin', note: null }, { status: 'pending_confirmation', at: '2026-01-01', by_actor: 'customer', note: 'x' }],
    notes: [{ note: 'hi', by_actor: 'admin', at: '2026-01-03' }],
  });
  assert.equal(o.orderId, 'CW-1'); assert.equal(o.customer.name, 'Asha'); assert.equal(o.subtotal, 800);
  assert.equal(o.items[0].unitPrice, 400); assert.equal(o.items[0].product, 'p1');
  assert.deepEqual(o.statusHistory.map((h) => h.status), ['pending_confirmation', 'confirmed']);   // chronological
  assert.equal(o.adminNotes[0].by, 'admin');
});

test('mapCoupon / mapOffer flatten join tables', () => {
  const c = mapCoupon({ id: 'c', code: 'X', type: 'fixed', value: '50', min_cart_amount: 0, max_discount: null, used_count: 1, is_active: true, coupon_products: [{ product_id: 'p1' }], coupon_categories: [] });
  assert.deepEqual(c.products, ['p1']); assert.equal(c.value, 50); assert.equal(c.usedCount, 1);
  const o = mapOffer({ id: 'o', title: 'T', is_active: true, offer_products: [{ products: { id: 'p1', name: 'N', slug: 's' } }], offer_categories: [{ categories: null }] });
  assert.equal(o.products[0].name, 'N'); assert.equal(o.categories.length, 0);
});

test('admin mapping never exposes the password hash in the safe view', () => {
  const a = mapAdmin({ id: 'a1', name: 'Owner', email: 'o@x.com', role: 'super_admin', is_active: true, password_hash: 'HASH', failed_login_attempts: 0, lock_until: null, last_login_at: null, password_changed_at: '2026-01-01T00:00:00Z' });
  assert.equal(a.passwordHash, 'HASH');
  assert.ok(a.passwordChangedAt instanceof Date);
  assert.equal(JSON.stringify(toSafeAdmin(a)).includes('HASH'), false);
});
