import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, resetDb, makeApp, adminClient, makeCategory, makeProduct, validOrder, key, getProduct, getOrderByOrderId, countOrders, MISSING_UUID } from './helpers.js';

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const place = (body, k = key()) => request(app).post('/api/v1/orders').set('Idempotency-Key', k).send(body);

describe('order creation', () => {
  it('creates an order with server-calculated totals, persists it and reduces stock', async () => {
    const p = await makeProduct(await makeCategory(), { price: 500, discountPrice: 400, stock: 5 });
    const res = await place(validOrder(p._id));
    expect(res.status).toBe(201);
    expect(res.body.data.orderId).toMatch(/^CW-\d{6}-[A-Z2-9]{6}$/);
    expect(res.body.data.subtotal).toBe(800);
    expect(res.body.data.total).toBe(800);
    expect(res.body.data.status).toBe('pending_confirmation');
    const saved = await getOrderByOrderId(res.body.data.orderId);
    expect(saved.items[0]).toMatchObject({ name: p.name, unitPrice: 400, quantity: 2 });
    expect(saved.statusHistory).toHaveLength(1);
    expect((await getProduct(p._id)).stock).toBe(3);
  });

  it('ignores tampered prices, discounts and totals sent by the browser', async () => {
    const p = await makeProduct(await makeCategory(), { price: 500, discountPrice: null });
    const body = validOrder(p._id, { total: 1, subtotal: 1, discount: 450, shippingCharge: 0 });
    body.items[0].unitPrice = 1;
    body.items[0].price = 1;
    const res = await place(body);
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(1000);
    expect(res.body.data.discount).toBe(0);
  });

  it('asks the shopper to confirm when the expected total no longer matches', async () => {
    const p = await makeProduct(await makeCategory(), { price: 500, discountPrice: null });
    const res = await place(validOrder(p._id, { expectedTotal: 100 }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details.quote.total).toBe(1000);
    expect(await countOrders()).toBe(0);
    expect((await getProduct(p._id)).stock).toBe(10);
  });

  it('validates customer data', async () => {
    const p = await makeProduct(await makeCategory());
    const bad = validOrder(p._id);
    bad.customer.phone = '12345';
    expect((await place(bad)).status).toBe(400);
    const noName = validOrder(p._id);
    noName.customer.name = '  ';
    expect((await place(noName)).status).toBe(400);
    const badPin = validOrder(p._id);
    badPin.address.pincode = '12';
    expect((await place(badPin)).status).toBe(400);
  });

  it('rejects invalid product ids and quantities', async () => {
    const p = await makeProduct(await makeCategory());
    const malformed = validOrder('nope');
    expect((await place(malformed)).status).toBe(400);
    const missing = await place(validOrder(MISSING_UUID));
    expect(missing.status).toBe(409);
    expect(missing.body.details.issues[0].code).toBe('UNAVAILABLE');
    for (const quantity of [0, -1, 21, 1.5]) {
      const b = validOrder(p._id);
      b.items[0].quantity = quantity;
      expect((await place(b)).status, `qty ${quantity}`).toBe(400);
    }
  });

  it('refuses out-of-stock and insufficient-stock items without creating an order', async () => {
    const cat = await makeCategory();
    const none = await makeProduct(cat, { stock: 0 });
    const few = await makeProduct(cat, { stock: 1 });
    const a = await place(validOrder(none._id));
    expect(a.status).toBe(409);
    expect(a.body.details.issues[0].code).toBe('OUT_OF_STOCK');
    const b = await place(validOrder(few._id)); // quantity 2 > stock 1
    expect(b.body.details.issues[0].code).toBe('INSUFFICIENT_STOCK');
    expect(await countOrders()).toBe(0);
  });

  it('never oversells under concurrent orders', async () => {
    const p = await makeProduct(await makeCategory(), { stock: 1 });
    const body = validOrder(p._id);
    body.items[0].quantity = 1;
    const results = await Promise.all([place(body), place(body), place(body)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await getProduct(p._id)).stock).toBe(0);
    expect(await countOrders()).toBe(1);
  });

  it('prevents duplicate orders for a repeated idempotency key', async () => {
    const p = await makeProduct(await makeCategory(), { stock: 10 });
    const k = key();
    const first = await place(validOrder(p._id), k);
    const second = await place(validOrder(p._id), k);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.orderId).toBe(first.body.data.orderId);
    expect(await countOrders()).toBe(1);
    expect((await getProduct(p._id)).stock).toBe(8);
  });

  it('requires variants and mandatory customisation, and snapshots them on the order', async () => {
    const cat = await makeCategory();
    const p = await makeProduct(cat, {
      variants: [{ label: 'Blue', price: 600, stock: 4 }],
      customFields: [{ key: 'name_text', label: 'Name', type: 'text', required: true, maxLength: 10 }, { key: 'style', label: 'Style', type: 'select', options: ['Gold', 'Silver'] }],
    });
    const variantId = String(p.variants[0]._id);
    const noVariant = await place(validOrder(p._id));
    expect(noVariant.body.details.issues.some((i) => i.code === 'VARIANT_REQUIRED')).toBe(true);
    const body = (custom) => validOrder(p._id, { items: [{ productId: String(p._id), variantId, quantity: 1, customizations: custom }] });
    expect((await place(body({}))).body.details.issues[0].code).toBe('CUSTOMIZATION_REQUIRED');
    expect((await place(body({ name_text: 'This is far too long' }))).body.details.issues[0].code).toBe('CUSTOMIZATION_INVALID');
    expect((await place(body({ name_text: 'Asha', style: 'Bronze' }))).body.details.issues[0].code).toBe('CUSTOMIZATION_INVALID');
    const ok = await place(body({ name_text: 'Asha', style: 'Gold' }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.items[0]).toMatchObject({ variantLabel: 'Blue', unitPrice: 600 });
    expect(ok.body.data.items[0].customizations.map((c) => c.value)).toEqual(['Asha', 'Gold']);
    expect((await getProduct(p._id)).variants[0].stock).toBe(3);
  });

  it('applies shipping settings on the server', async () => {
    const c = await adminClient(app);
    await c.patch('/api/v1/admin/settings', { shipping: { flatRate: 60, freeShippingThreshold: 1500 } });
    const p = await makeProduct(await makeCategory(), { price: 500, discountPrice: null });
    const small = await place(validOrder(p._id));
    expect(small.body.data.shippingCharge).toBe(60);
    expect(small.body.data.total).toBe(1060);
    const b = validOrder(p._id);
    b.items[0].quantity = 3;
    expect((await place(b)).body.data.shippingCharge).toBe(0);
  });
});

describe('order privacy and administration', () => {
  it('requires the matching phone number to track and leaks no address or contact data', async () => {
    const p = await makeProduct(await makeCategory());
    const { body } = await place(validOrder(p._id));
    const id = body.data.orderId;
    const wrong = await request(app).get(`/api/v1/orders/${id}/track?phone=9876543210`);
    const missing = await request(app).get('/api/v1/orders/CW-000000-AAAAAA/track?phone=9574546023');
    expect(wrong.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(wrong.body.message).toBe(missing.body.message);
    const ok = await request(app).get(`/api/v1/orders/${id}/track?phone=%2B91%209574546023`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.statusLabel).toBe('Pending Confirmation');
    expect(JSON.stringify(ok.body)).not.toMatch(/Test Street|asha@example|Surat/);
    expect((await request(app).get(`/api/v1/orders/${id}/track`)).status).toBe(400);
  });

  it('protects admin order endpoints', async () => {
    const p = await makeProduct(await makeCategory());
    const { body } = await place(validOrder(p._id));
    expect((await request(app).get('/api/v1/admin/orders')).status).toBe(401);
    expect((await request(app).get(`/api/v1/admin/orders/${body.data.orderId}`)).status).toBe(401);
    expect((await request(app).patch(`/api/v1/admin/orders/${body.data.orderId}/status`).send({ status: 'confirmed' })).status).toBe(401);
    expect((await request(app).post('/api/v1/admin/orders/export').send({})).status).toBe(401);
  });

  it('lets an admin find, confirm and progress an order, visible in tracking', async () => {
    const c = await adminClient(app);
    const p = await makeProduct(await makeCategory());
    const { body } = await place(validOrder(p._id));
    const id = body.data.orderId;

    expect((await c.get('/api/v1/admin/orders?q=asha')).body.meta.total).toBe(1);
    expect((await c.get('/api/v1/admin/orders?q=9574546023')).body.meta.total).toBe(1);
    expect((await c.get(`/api/v1/admin/orders?q=${id}&status=pending_confirmation`)).body.meta.total).toBe(1);
    expect((await c.get('/api/v1/admin/orders?status=shipped')).body.meta.total).toBe(0);

    const detail = await c.get(`/api/v1/admin/orders/${id}`);
    expect(detail.body.data.customer.phone).toBe('9574546023');
    expect(detail.body.data.whatsappCustomerUrl).toMatch(/^https:\/\/wa\.me\/919574546023\?text=/);

    expect((await c.patch(`/api/v1/admin/orders/${id}/status`, { status: 'shipped' })).status).toBe(409);
    expect((await c.patch(`/api/v1/admin/orders/${id}/status`, { status: 'confirmed' })).status).toBe(200);
    expect((await c.patch(`/api/v1/admin/orders/${id}/status`, { status: 'processing' })).status).toBe(200);
    expect((await c.patch(`/api/v1/admin/orders/${id}/notes`, { note: 'Engrave on left side' })).body.data[0].note).toBe('Engrave on left side');

    const tracked = await request(app).get(`/api/v1/orders/${id}/track?phone=9574546023`);
    expect(tracked.body.data.status).toBe('processing');
    expect(tracked.body.data.history.map((h) => h.status)).toEqual(['pending_confirmation', 'confirmed', 'processing']);
  });

  it('cancels according to business rules and restores stock once', async () => {
    const c = await adminClient(app);
    const p = await makeProduct(await makeCategory(), { stock: 5 });
    const { body } = await place(validOrder(p._id));
    expect((await getProduct(p._id)).stock).toBe(3);
    expect((await c.post(`/api/v1/admin/orders/${body.data.orderId}/cancel`, { reason: 'Customer request' })).status).toBe(200);
    expect((await getProduct(p._id)).stock).toBe(5);
    expect((await c.post(`/api/v1/admin/orders/${body.data.orderId}/cancel`, { reason: 'again' })).status).toBe(409);
    expect((await getProduct(p._id)).stock).toBe(5);

    const { body: b2 } = await place(validOrder(p._id));
    for (const s of ['confirmed', 'processing', 'ready_to_ship', 'shipped']) await c.patch(`/api/v1/admin/orders/${b2.data.orderId}/status`, { status: s });
    expect((await c.post(`/api/v1/admin/orders/${b2.data.orderId}/cancel`, { reason: 'too late' })).status).toBe(409);
  });

  it('separates gross order value from collected revenue on the dashboard', async () => {
    const c = await adminClient(app);
    const p = await makeProduct(await makeCategory(), { price: 500, discountPrice: null });
    const { body } = await place(validOrder(p._id));
    let stats = (await c.get('/api/v1/admin/dashboard')).body.data;
    expect(stats.revenue.grossOrderValue).toBe(1000);
    expect(stats.revenue.collected).toBe(0);
    expect(stats.orders.pending).toBe(1);
    expect((await c.patch(`/api/v1/admin/orders/${body.data.orderId}/payment`, { paymentStatus: 'partially_paid', amountCollected: 400 })).status).toBe(200);
    stats = (await c.get('/api/v1/admin/dashboard')).body.data;
    expect(stats.revenue).toMatchObject({ grossOrderValue: 1000, collected: 400, outstanding: 600 });
    expect((await c.patch(`/api/v1/admin/orders/${body.data.orderId}/payment`, { paymentStatus: 'paid', amountCollected: 5000 })).status).toBe(200);
  });

  it('exports CSV and neutralises spreadsheet formulas', async () => {
    const c = await adminClient(app);
    const p = await makeProduct(await makeCategory());
    const b = validOrder(p._id);
    b.customer.name = '=HYPERLINK("http://evil")';
    await place(b);
    const res = await c.post('/api/v1/admin/orders/export', {});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK`);
  });
});
