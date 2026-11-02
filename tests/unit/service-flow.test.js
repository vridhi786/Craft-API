// Runs the REAL services/controllers logic against a FAKE Supabase client (node:test module mocking).
// It verifies query construction, row mapping, pricing, order orchestration and error translation – not PostgreSQL itself.
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const url = (rel) => new URL(rel, import.meta.url).href;

/** Chainable, thenable query recorder. Every method call is recorded; awaiting it calls handler(record). */
function makeFake(handler) {
  const log = [];
  const chain = (rec) => {
    const proxy = new Proxy(function noop() {}, {
      get(_t, prop) {
        if (prop === 'then') { log.push(rec); return (res, rej) => Promise.resolve(handler(rec)).then(res, rej); }
        return (...args) => { rec.steps.push([prop, ...args]); return proxy; };
      },
    });
    return proxy;
  };
  const fake = {
    from: (table) => chain({ table, steps: [] }),
    rpc: (fn, args) => chain({ rpc: fn, args, steps: [] }),
  };
  return { fake, log };
}

let current = { handler: () => ({ data: null, error: null }) };
let noExisting = false;   // when true, the idempotency-key lookup finds nothing
const proxyClient = { from: (t) => current.fake.from(t), rpc: (f, a) => current.fake.rpc(f, a) };
const use = (handler) => { current = makeFake(handler); return current.log; };
const has = (rec, name, ...args) => rec.steps.some(([n, ...a]) => n === name && args.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));

let productService; let pricingService; let orderService; let settingsService;
before(async () => {
  mock.module(url('../../config/environment.js'), { namedExports: { env: { whatsappNumber: '919574546023', isProduction: false, isTest: true }, assertEnvironment() {} } });
  mock.module(url('../../config/supabase.js'), { namedExports: { supabase: proxyClient, getSupabase: () => proxyClient, checkDatabase: async () => ({ ok: true }) } });
  productService = await import(url('../../services/productService.js'));
  pricingService = await import(url('../../services/pricingService.js'));
  orderService = await import(url('../../services/orderService.js'));
  settingsService = await import(url('../../services/settingsService.js'));
});

const productRow = (o = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', name: 'Oak Frame', slug: 'oak-frame', sku: 'OF1', short_description: '', description: '', specifications: [],
  category_id: 'c1', subcategory_id: null, child_category_id: null, images: [{ url: 'https://x/a.jpg', alt: '' }], price: 500, discount_price: 400, min_price: 400,
  stock: 5, low_stock_threshold: 2, track_inventory: true, stock_status: 'in_stock', custom_fields: [], is_featured: false, is_bestseller: false, is_new_arrival: false,
  keywords: [], is_active: true, is_archived: false, sold_count: 0, created_at: 't', updated_at: 't', variants: [], category: null, ...o,
});

test('listProducts builds the expected single query (filters, sort, range) and maps rows', async () => {
  const log = use((rec) => (rec.table === 'products' ? { data: [productRow()], count: 1, error: null } : { data: null, error: null }));
  const { items, total } = await productService.listProducts({ page: 2, limit: 12, sort: 'price_desc', q: '50%_mug', minPrice: 100, inStock: true }, { publicOnly: true });
  assert.equal(total, 1);
  assert.equal(items[0].price, 500);
  assert.equal(items[0].discountPrice, 400);
  const products = log.filter((r) => r.table === 'products');
  assert.equal(products.length, 1, 'query must execute exactly once, only at the end');
  const q = products[0];
  assert.ok(has(q, 'eq', 'is_active', true) && has(q, 'eq', 'is_archived', false));
  assert.ok(has(q, 'ilike', 'search_text', '%50\\%\\_mug%'), 'LIKE wildcards in user input are escaped');
  assert.ok(has(q, 'gte', 'min_price', 100));
  assert.ok(has(q, 'neq', 'stock_status', 'out_of_stock'));
  assert.ok(has(q, 'order', 'min_price', { ascending: false }));
  assert.ok(has(q, 'range', 12, 23));
});

test('listProducts filters by category via a DB-resolved UUID, and returns empty for unknown categories', async () => {
  const catId = '22222222-2222-4222-8222-222222222222';
  const log = use((rec) => {
    if (rec.table === 'categories') return { data: { id: catId, name: 'Decor', slug: 'decor', level: 1, is_active: true }, error: null };
    return { data: [productRow()], count: 1, error: null };
  });
  await productService.listProducts({ page: 1, limit: 12, sort: 'newest', category: 'decor' }, { publicOnly: true });
  const q = log.find((r) => r.table === 'products');
  assert.ok(has(q, 'or', `category_id.eq.${catId},subcategory_id.eq.${catId},child_category_id.eq.${catId}`));
  use((rec) => (rec.table === 'categories' ? { data: null, error: null } : { data: [productRow()], count: 1, error: null }));
  const none = await productService.listProducts({ page: 1, limit: 12, sort: 'newest', category: 'nope' }, { publicOnly: true });
  assert.deepEqual(none, { items: [], total: 0 });
});

test('database errors surface as ApiError (e.g. unreachable DB → 503)', async () => {
  use(() => ({ data: null, error: { message: 'TypeError: fetch failed', code: '' } }));
  await assert.rejects(productService.listProducts({ page: 1, limit: 12, sort: 'newest' }), (e) => e.status === 503 && e.code === 'DB_UNAVAILABLE');
});

const PID = '11111111-1111-4111-8111-111111111111';
const VID = '33333333-3333-4333-8333-333333333333';
const withSettings = (shipping, others) => (rec) => {
  if (rec.table === 'site_settings') return { data: { data: shipping ? { shipping } : {} }, error: null };
  return others(rec);
};

test('buildQuote prices on the server: variant price, quantity, free-shipping threshold, issues', async () => {
  const row = productRow({ discount_price: null, variants: [{ id: VID, label: 'Large', price: 800, discount_price: null, stock: 5, is_active: true, sort_order: 1, created_at: 't' }] });
  use(withSettings({ flatRate: 60, freeShippingThreshold: 1500 }, (rec) => (rec.table === 'products' ? { data: [row], error: null } : { data: null, error: null })));
  settingsService.clearSettingsCache();
  const one = await pricingService.buildQuote({ items: [{ productId: PID, variantId: VID, quantity: 1, customizations: {} }] });
  assert.equal(one.subtotal, 800); assert.equal(one.shippingCharge, 60); assert.equal(one.total, 860); assert.equal(one.freeShippingRemaining, 700);
  const two = await pricingService.buildQuote({ items: [{ productId: PID, variantId: VID, quantity: 2, customizations: {} }] });
  assert.equal(two.total, 1600); assert.equal(two.shippingCharge, 0);
  const bad = await pricingService.buildQuote({ items: [{ productId: PID, quantity: 1, customizations: {} }] });
  assert.equal(bad.issues[0].code, 'VARIANT_REQUIRED');
  const tooMany = await pricingService.buildQuote({ items: [{ productId: PID, variantId: VID, quantity: 9, customizations: {} }] });
  assert.equal(tooMany.issues[0].code, 'INSUFFICIENT_STOCK');
});

test('buildQuote enforces required/valid customisation and ignores browser-side prices', async () => {
  const row = productRow({ custom_fields: [{ key: 'name_text', label: 'Name', type: 'text', required: true, options: [], maxLength: 5 }] });
  use(withSettings(null, (rec) => (rec.table === 'products' ? { data: [row], error: null } : { data: null, error: null })));
  settingsService.clearSettingsCache();
  assert.equal((await pricingService.buildQuote({ items: [{ productId: PID, quantity: 1, customizations: {} }] })).issues[0].code, 'CUSTOMIZATION_REQUIRED');
  assert.equal((await pricingService.buildQuote({ items: [{ productId: PID, quantity: 1, customizations: { name_text: 'toolong' } }] })).issues[0].code, 'CUSTOMIZATION_INVALID');
  const ok = await pricingService.buildQuote({ items: [{ productId: PID, quantity: 2, customizations: { name_text: 'Asha' }, unitPrice: 1, price: 1 }] });
  assert.equal(ok.issues.length, 0); assert.equal(ok.total, 800); assert.deepEqual(ok.lines[0].customizations, [{ key: 'name_text', label: 'Name', value: 'Asha' }]);
  const unavailable = await pricingService.buildQuote({ items: [{ productId: '99999999-9999-4999-8999-999999999999', quantity: 1, customizations: {} }] });
  assert.equal(unavailable.issues[0].code, 'UNAVAILABLE');
});

const orderRow = (o = {}) => ({
  id: '44444444-4444-4444-8444-444444444444', order_id: 'CW-261031-ABCDEF', idempotency_key: 'key-12345678', customer_name: 'Asha', customer_phone: '9574546023', customer_whatsapp: null, customer_email: null,
  address: { city: 'Surat' }, subtotal: 800, discount: 0, shipping_charge: 0, total: 800, currency: 'INR', coupon_code: null, status: 'pending_confirmation', payment_status: 'unpaid',
  amount_collected: 0, customer_notes: null, gift_message: null, stock_released: false, created_at: 't', updated_at: 't',
  items: [{ product_id: PID, name: 'Oak Frame', quantity: 2, mrp: 500, unit_price: 400, line_total: 800, customizations: [], tracked: true }], history: [], notes: [], ...o,
});
const payload = (extra = {}) => ({
  customer: { name: 'Asha', phone: '9574546023' }, address: { line1: 'x', city: 'Surat', state: 'Gujarat', pincode: '395007' },
  items: [{ productId: PID, quantity: 2, customizations: {} }], ...extra,
});
const orderHandler = (rpcResult) => withSettings(null, (rec) => {
  if (rec.table === 'products') return { data: [productRow()], error: null };
  if (rec.rpc === 'create_order_tx') return rpcResult(rec);
  if (rec.table === 'orders') return { data: rec.steps.some((s) => s[1] === 'idempotency_key' || s[2] === 'idempotency_key') && noExisting ? null : orderRow(), error: null };
  return { data: null, error: null };
});

test('createOrder sends ONE atomic RPC with a server-priced payload and returns the stored order', async () => {
  noExisting = true;
  const log = use(orderHandler(() => ({ data: '44444444-4444-4444-8444-444444444444', error: null })));
  settingsService.clearSettingsCache();
  const { order, duplicate } = await orderService.createOrder(payload({ expectedTotal: 800 }), 'key-12345678');
  assert.equal(duplicate, false); assert.equal(order.orderId, 'CW-261031-ABCDEF'); assert.equal(order.items[0].unitPrice, 400);
  const rpc = log.find((r) => r.rpc === 'create_order_tx');
  assert.ok(rpc, 'create_order_tx called');
  assert.equal(rpc.args.p_order.total, 800); assert.equal(rpc.args.p_order.subtotal, 800); assert.equal(rpc.args.p_order.idempotency_key, 'key-12345678');
  assert.match(rpc.args.p_order.order_id, /^CW-\d{6}-[A-Z2-9]{6}$/);
  assert.equal(rpc.args.p_items[0].unit_price, 400); assert.equal(rpc.args.p_items[0].quantity, 2); assert.equal(rpc.args.p_items[0].tracked, true);
  assert.equal(log.filter((r) => r.rpc).length, 1, 'no other writes: everything else happens inside the SQL transaction');
});

test('createOrder: price drift → 409 PRICE_CHANGED and nothing is written', async () => {
  noExisting = true;
  const log = use(orderHandler(() => ({ data: 'x', error: null })));
  settingsService.clearSettingsCache();
  await assert.rejects(orderService.createOrder(payload({ expectedTotal: 1 }), 'key-87654321'), (e) => e.status === 409 && e.code === 'PRICE_CHANGED' && e.details.quote.total === 800);
  assert.equal(log.filter((r) => r.rpc).length, 0);
});

test('createOrder: stock lost to a concurrent order → 409 OUT_OF_STOCK from the SQL function', async () => {
  noExisting = true;
  use(orderHandler(() => ({ data: null, error: { code: 'P0001', message: 'OUT_OF_STOCK', details: 'Oak Frame' } })));
  settingsService.clearSettingsCache();
  await assert.rejects(orderService.createOrder(payload(), 'key-aaaaaaaa'), (e) => e.status === 409 && e.code === 'OUT_OF_STOCK' && /Oak Frame/.test(e.message));
});

test('createOrder: repeated Idempotency-Key returns the original order without calling the RPC', async () => {
  noExisting = false;
  const log = use(orderHandler(() => ({ data: 'x', error: null })));
  const { order, duplicate } = await orderService.createOrder(payload(), 'key-12345678');
  assert.equal(duplicate, true); assert.equal(order.orderId, 'CW-261031-ABCDEF');
  assert.equal(log.filter((r) => r.rpc).length, 0);
});

test('createOrder: losing a concurrent double-submit race (unique violation) falls back to the winner', async () => {
  let existing = false;
  const log = use(withSettings(null, (rec) => {
    if (rec.table === 'products') return { data: [productRow()], error: null };
    if (rec.rpc === 'create_order_tx') { existing = true; return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_idempotency_key_key"' } }; }
    if (rec.table === 'orders') return { data: existing ? orderRow() : null, error: null };
    return { data: null, error: null };
  }));
  settingsService.clearSettingsCache();
  const { duplicate, order } = await orderService.createOrder(payload(), 'key-race-0001');
  assert.equal(duplicate, true); assert.equal(order.orderId, 'CW-261031-ABCDEF');
  assert.equal(log.filter((r) => r.rpc === 'create_order_tx').length, 1);
});

test('changeStatus validates transitions in JS and delegates the atomic change to SQL', async () => {
  const order = { id: 'o1', status: 'pending_confirmation' };
  const log = use((rec) => (rec.table === 'orders' ? { data: orderRow({ status: 'confirmed' }), error: null } : { data: null, error: null }));
  const updated = await orderService.changeStatus(order, { status: 'confirmed', note: 'ok', by: 'admin@x.com' });
  assert.equal(updated.status, 'confirmed');
  const rpc = log.find((r) => r.rpc === 'set_order_status_tx');
  assert.deepEqual(rpc.args, { p_id: 'o1', p_status: 'confirmed', p_note: 'ok', p_by: 'admin@x.com' });
  const log2 = use(() => ({ data: null, error: null }));
  await assert.rejects(orderService.changeStatus(order, { status: 'shipped', by: 'a' }), (e) => e.status === 409 && e.code === 'INVALID_TRANSITION');
  assert.equal(log2.length, 0);
  const log3 = use((rec) => (rec.table === 'orders' ? { data: orderRow({ status: 'cancelled' }), error: null } : { data: null, error: null }));
  await orderService.changeStatus(order, { status: 'cancelled', note: 'why', by: 'a' });
  assert.deepEqual(log3.find((r) => r.rpc).args, { p_id: 'o1', p_reason: 'why', p_by: 'a' });
  assert.equal(log3.find((r) => r.rpc).rpc, 'cancel_order_tx');
});

test('settings are deep-merged over defaults and cached', async () => {
  let reads = 0;
  use((rec) => { if (rec.table === 'site_settings') { reads += 1; return { data: { data: { hero: { title: 'Custom' } } }, error: null }; } return { data: null, error: null }; });
  settingsService.clearSettingsCache();
  const s = await settingsService.getSettings();
  assert.equal(s.hero.title, 'Custom'); assert.ok(s.hero.subtitle.length > 0); assert.equal(s.whatsappNumber, '919574546023');
  await settingsService.getSettings();
  assert.equal(reads, 1, 'second call served from cache');
  const pub = settingsService.toPublicSettings(s);
  assert.equal('key' in pub, false); assert.ok('brandName' in pub);
});
