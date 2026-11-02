import request from 'supertest';
import { createApp } from '../app.js';
import { supabase } from '../config/supabase.js';
import { hashPassword } from '../utils/password.js';
import { clearSettingsCache } from '../services/settingsService.js';
import { mapProduct, mapCategory, mapOrder, mapCoupon, SELECT_PRODUCT, SELECT_ORDER, SELECT_COUPON } from '../utils/mappers.js';

export const BIG_LIMITS = { loginMax: 1000, apiMax: 100000, orderMax: 100000 };
export const makeApp = (limits = BIG_LIMITS) => createApp({ limits, allowedOrigins: ['http://localhost:5173'] });
export const ADMIN_PASSWORD = 'Str0ngPassw0rd!x';

const ZERO = '00000000-0000-0000-0000-000000000000';
// children before parents (foreign keys)
const WIPE_ORDER = ['reviews', 'order_notes', 'order_status_history', 'order_items', 'orders', 'coupon_products', 'coupon_categories', 'coupons', 'offer_products', 'offer_categories', 'offers', 'banners', 'inventory_adjustments', 'audit_logs', 'customers', 'product_variants', 'products', 'categories', 'site_settings', 'admins'];
const NO_ID = { coupon_products: 'coupon_id', coupon_categories: 'coupon_id', offer_products: 'offer_id', offer_categories: 'offer_id' };

/** Wipes every table. Refuses to run unless explicitly allowed (it must only ever see a throw-away test database). */
export async function resetDb() {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS !== 'yes' || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to wipe the database. Use a DEDICATED test Supabase project (see .env.test.example) and set ALLOW_DESTRUCTIVE_TESTS=yes.');
  }
  for (const table of WIPE_ORDER) {
    const { error } = await supabase.from(table).delete().neq(NO_ID[table] || 'id', ZERO);
    if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
  }
  clearSettingsCache();
}
export async function startDb() {
  const { error } = await supabase.from('products').select('id', { head: true }).limit(1);
  if (error) throw new Error(`Test database not reachable / schema missing: ${error.message}. Run supabase/schema.sql on the TEST project.`);
}
export const stopDb = async () => {};

export async function createAdmin(role = 'super_admin', email = `${role}@example.com`) {
  const { data, error } = await supabase.from('admins').insert({ name: `Test ${role}`, email, password_hash: await hashPassword(ADMIN_PASSWORD), role }).select('*').single();
  if (error) throw new Error(error.message);
  return { id: data.id, email: data.email, role: data.role };
}

/** Signs in and returns helpers that automatically send the cookie and CSRF header. */
export async function adminClient(app, role = 'super_admin') {
  const admin = await createAdmin(role);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/admin/login').send({ email: admin.email, password: ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed in test helper: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.data.csrfToken;
  return {
    admin, csrf, agent,
    get: (url) => agent.get(url),
    post: (url, body) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function makeCategory(o = {}) {
  const name = o.name || 'Gifts';
  const row = must(await supabase.from('categories').insert({ name, slug: o.slug || slug(name), level: o.level || 1, parent_id: o.parent_id || null, is_active: o.isActive ?? true, is_archived: o.isArchived ?? false }).select('*').single());
  return mapCategory(row);
}

export const getProduct = async (id) => mapProduct(must(await supabase.from('products').select(SELECT_PRODUCT).eq('id', id).single()));

let skuCounter = 0;
/** camelCase overrides: name, price, discountPrice, stock, isActive, isArchived, isFeatured, keywords, variants[], customFields[] … */
export async function makeProduct(category, o = {}) {
  skuCounter += 1;
  const name = o.name || `Test Mug ${skuCounter}`;
  const row = must(await supabase.from('products').insert({
    name, slug: slug(name), sku: `SKU-${skuCounter}`, category_id: category.id,
    price: o.price ?? 500, discount_price: o.discountPrice === undefined ? 400 : o.discountPrice, stock: o.stock ?? 10, low_stock_threshold: o.lowStockThreshold ?? 2,
    images: o.images || [{ url: 'https://example.com/a.jpg', alt: 'a' }], is_active: o.isActive ?? true, is_archived: o.isArchived ?? false,
    is_featured: o.isFeatured ?? false, is_bestseller: o.isBestseller ?? false, is_new_arrival: o.isNewArrival ?? false,
    keywords: o.keywords || [], track_inventory: o.trackInventory ?? true, custom_fields: o.customFields || [],
  }).select('id').single());
  if (o.variants?.length) {
    must(await supabase.from('product_variants').insert(o.variants.map((v, i) => ({ product_id: row.id, label: v.label, price: v.price ?? null, discount_price: v.discountPrice ?? null, stock: v.stock ?? 0, is_active: v.isActive ?? true, sort_order: i }))));
  }
  return getProduct(row.id);
}

export async function makeCoupon(o) {
  const row = must(await supabase.from('coupons').insert({
    code: o.code, type: o.type || 'percentage', value: o.value ?? 10, min_cart_amount: o.minCartAmount ?? 0, max_discount: o.maxDiscount ?? null,
    starts_at: o.startsAt ? new Date(o.startsAt).toISOString() : null, expires_at: o.expiresAt ? new Date(o.expiresAt).toISOString() : null,
    usage_limit: o.usageLimit ?? null, per_customer_limit: o.perCustomerLimit ?? null, is_active: o.isActive ?? true,
  }).select('id').single());
  if (o.products?.length) must(await supabase.from('coupon_products').insert(o.products.map((p) => ({ coupon_id: row.id, product_id: p }))));
  return row.id;
}
export const getCoupon = async (code) => mapCoupon(must(await supabase.from('coupons').select(SELECT_COUPON).eq('code', code).single()));
export const getOrderByOrderId = async (orderId) => mapOrder(must(await supabase.from('orders').select(SELECT_ORDER).eq('order_id', orderId).single()));
export const countOrders = async () => (await supabase.from('orders').select('id', { count: 'exact', head: true })).count;

export const validOrder = (productId, extra = {}) => ({
  customer: { name: 'Asha Patel', phone: '9574546023', email: 'asha@example.com' },
  address: { line1: '12 Test Street', city: 'Surat', state: 'Gujarat', pincode: '395007' },
  items: [{ productId: String(productId), quantity: 2 }],
  ...extra,
});

export const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
export const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
export { request };
