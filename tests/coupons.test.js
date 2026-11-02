import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, resetDb, makeApp, adminClient, makeCategory, makeProduct, validOrder, key, makeCoupon, getCoupon } from './helpers.js';

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const base = { type: 'percentage', value: 10, isActive: true };
const day = 86_400_000;
const validate = (product, code, qty = 2) =>
  request(app).post('/api/v1/coupons/validate').send({ code, items: [{ productId: String(product._id), quantity: qty }] });

async function setup() {
  const product = await makeProduct(await makeCategory(), { price: 500, discountPrice: null, stock: 50 });
  return product;
}

describe('coupons', () => {
  it('applies a valid percentage coupon (case-insensitive)', async () => {
    const p = await setup();
    await makeCoupon({ ...base, code: 'WELCOME10' });
    const res = await validate(p, 'welcome10');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ subtotal: 1000, discount: 100, total: 900 });
  });

  it('rejects unknown, inactive and expired coupons', async () => {
    const p = await setup();
    await makeCoupon({ ...base, code: 'OFF', isActive: false });
    await makeCoupon({ ...base, code: 'OLD', startsAt: new Date(Date.now() - 3 * day), expiresAt: new Date(Date.now() - day) });
    await makeCoupon({ ...base, code: 'SOON', startsAt: new Date(Date.now() + day) });
    expect((await validate(p, 'NOPE')).body.code).toBe('COUPON_INVALID');
    expect((await validate(p, 'OFF')).body.code).toBe('COUPON_INVALID');
    expect((await validate(p, 'OLD')).body.code).toBe('COUPON_EXPIRED');
    expect((await validate(p, 'SOON')).body.code).toBe('COUPON_NOT_STARTED');
  });

  it('enforces the minimum cart amount and the maximum discount cap', async () => {
    const p = await setup();
    await makeCoupon({ ...base, code: 'BIG', value: 50, minCartAmount: 2000, maxDiscount: 300 });
    expect((await validate(p, 'BIG', 2)).body.code).toBe('COUPON_MIN_CART');
    const ok = await validate(p, 'BIG', 6); // subtotal 3000, 50% = 1500, capped at 300
    expect(ok.body.data.discount).toBe(300);
  });

  it('supports fixed discounts that never exceed the cart value', async () => {
    const p = await setup();
    await makeCoupon({ code: 'FLAT5K', type: 'fixed', value: 5000 });
    expect((await validate(p, 'FLAT5K', 1)).body.data).toMatchObject({ discount: 500, total: 0 });
  });

  it('enforces total usage and per-customer limits when orders are placed', async () => {
    const p = await setup();
    await makeCoupon({ ...base, code: 'ONCE', usageLimit: 1 });
    await makeCoupon({ ...base, code: 'PERCUST', perCustomerLimit: 1 });
    const order = (code, phone = '9574546023') => {
      const b = validOrder(p._id, { couponCode: code });
      b.customer.phone = phone;
      return request(app).post('/api/v1/orders').set('Idempotency-Key', key()).send(b);
    };
    const first = await order('ONCE');
    expect(first.status).toBe(201);
    expect(first.body.data.discount).toBe(100);
    expect((await order('ONCE', '9876543210')).body.code).toBe('COUPON_EXHAUSTED');
    expect((await order('PERCUST')).status).toBe(201);
    expect((await order('PERCUST')).body.code).toBe('COUPON_CUSTOMER_LIMIT');
    expect((await order('PERCUST', '9876543210')).status).toBe(201);
    expect((await getCoupon('ONCE')).usedCount).toBe(1);
  });

  it('rejects an invalid coupon at order time instead of silently ignoring it', async () => {
    const p = await setup();
    const res = await request(app).post('/api/v1/orders').set('Idempotency-Key', key()).send(validOrder(p._id, { couponCode: 'FAKE' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COUPON_INVALID');
  });

  it('restricts a coupon to selected products', async () => {
    const cat = await makeCategory();
    const a = await makeProduct(cat, { price: 500, discountPrice: null });
    const b = await makeProduct(cat, { price: 500, discountPrice: null });
    await makeCoupon({ ...base, code: 'ONLYA', products: [a.id] });
    expect((await validate(b, 'ONLYA')).body.code).toBe('COUPON_NOT_APPLICABLE');
    expect((await validate(a, 'ONLYA')).body.data.discount).toBe(100);
  });

  it('is managed only by admins with validated rules', async () => {
    expect((await request(app).get('/api/v1/admin/coupons')).status).toBe(401);
    const c = await adminClient(app);
    expect((await c.post('/api/v1/admin/coupons', { code: 'x', type: 'percentage', value: 10 })).status).toBe(400);
    expect((await c.post('/api/v1/admin/coupons', { code: 'SAVE', type: 'percentage', value: 150 })).status).toBe(400);
    const created = await c.post('/api/v1/admin/coupons', { code: 'save20', type: 'percentage', value: 20 });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('SAVE20');
    expect((await c.post('/api/v1/admin/coupons', { code: 'SAVE20', type: 'fixed', value: 5 })).status).toBe(409);
    expect((await c.del(`/api/v1/admin/coupons/${created.body.data._id}`)).status).toBe(200);
  });
});
