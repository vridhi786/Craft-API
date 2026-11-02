import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, resetDb, makeApp, adminClient, makeCategory, makeProduct } from './helpers.js';

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const body = (category, extra = {}) => ({ name: 'Photo Frame', sku: 'PF-001', category: String(category._id), price: 999, discountPrice: 799, stock: 5, ...extra });

describe('public products', () => {
  it('lists only active, non-archived products and hides exact stock', async () => {
    const cat = await makeCategory();
    await makeProduct(cat, { name: 'Visible One' });
    await makeProduct(cat, { name: 'Hidden Inactive', isActive: false });
    await makeProduct(cat, { name: 'Hidden Archived', isArchived: true });
    const res = await request(app).get('/api/v1/products');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.name)).toEqual(['Visible One']);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].stock).toBeUndefined();
    expect(res.body.data[0].discountPercent).toBe(20);
  });

  it('shows no discount unless the product really has one', async () => {
    const cat = await makeCategory();
    await makeProduct(cat, { name: 'Plain', discountPrice: null });
    const res = await request(app).get('/api/v1/products');
    expect(res.body.data[0]).toMatchObject({ price: 500, mrp: null, discountPercent: 0 });
  });

  it('returns details by id and slug, 404 for inactive, 400 for malformed ids', async () => {
    const cat = await makeCategory();
    const p = await makeProduct(cat, { name: 'Mug Deluxe' });
    const off = await makeProduct(cat, { name: 'Off', isActive: false });
    expect((await request(app).get(`/api/v1/products/${p._id}`)).body.data.name).toBe('Mug Deluxe');
    expect((await request(app).get('/api/v1/products/slug/mug-deluxe')).status).toBe(200);
    expect((await request(app).get(`/api/v1/products/${off._id}`)).status).toBe(404);
    const bad = await request(app).get('/api/v1/products/not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_ID');
  });

  it('filters, sorts, searches and paginates', async () => {
    const cat = await makeCategory();
    await makeProduct(cat, { name: 'Alpha Mug', discountPrice: null, price: 300, keywords: ['coffee'] });
    await makeProduct(cat, { name: 'Beta Frame', discountPrice: null, price: 900 });
    await makeProduct(cat, { name: 'Gamma Box', discountPrice: null, price: 600, stock: 0 });
    const sorted = await request(app).get('/api/v1/products?sort=price_desc');
    expect(sorted.body.data.map((p) => p.name)).toEqual(['Beta Frame', 'Gamma Box', 'Alpha Mug']);
    expect((await request(app).get('/api/v1/products?minPrice=500')).body.meta.total).toBe(2);
    expect((await request(app).get('/api/v1/products?inStock=true')).body.meta.total).toBe(2);
    expect((await request(app).get('/api/v1/products/search?q=coffee')).body.data[0].name).toBe('Alpha Mug');
    const page = await request(app).get('/api/v1/products?limit=1&page=2&sort=name');
    expect(page.body.data[0].name).toBe('Beta Frame');
    expect((await request(app).get('/api/v1/products?limit=1000')).status).toBe(400);
  });

  it('serves featured, bestsellers and new arrivals', async () => {
    const cat = await makeCategory();
    await makeProduct(cat, { name: 'F', isFeatured: true });
    await makeProduct(cat, { name: 'B', isBestseller: true });
    await makeProduct(cat, { name: 'N', isNewArrival: true });
    expect((await request(app).get('/api/v1/products/featured')).body.data.map((p) => p.name)).toEqual(['F']);
    expect((await request(app).get('/api/v1/products/bestsellers')).body.data.map((p) => p.name)).toEqual(['B']);
    expect((await request(app).get('/api/v1/products/new-arrivals')).body.data.map((p) => p.name)).toEqual(['N']);
  });
});

describe('admin product management', () => {
  it('rejects unauthenticated creation', async () => {
    const cat = await makeCategory();
    expect((await request(app).post('/api/v1/admin/products').send(body(cat))).status).toBe(401);
  });

  it('creates, updates and deactivates a product', async () => {
    const c = await adminClient(app);
    const cat = await makeCategory();
    const created = await c.post('/api/v1/admin/products', body(cat));
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.slug).toBe('photo-frame');

    const updated = await c.patch(`/api/v1/admin/products/${id}`, { price: 1200, discountPrice: 1000, isFeatured: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data.price).toBe(1200);
    expect((await request(app).get(`/api/v1/products/${id}`)).body.data.price).toBe(1000);

    expect((await c.patch(`/api/v1/admin/products/${id}/status`, { isActive: false })).status).toBe(200);
    expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404);
    expect((await c.get(`/api/v1/admin/products/${id}`)).status).toBe(200);
  });

  it('validates price, discount and SKU', async () => {
    const c = await adminClient(app);
    const cat = await makeCategory();
    expect((await c.post('/api/v1/admin/products', body(cat, { price: -5 }))).status).toBe(400);
    expect((await c.post('/api/v1/admin/products', body(cat, { price: 'abc' }))).status).toBe(400);
    const bad = await c.post('/api/v1/admin/products', body(cat, { price: 500, discountPrice: 500 }));
    expect(bad.status).toBe(400);
    expect((await c.post('/api/v1/admin/products', body(cat))).status).toBe(201);
    const dup = await c.post('/api/v1/admin/products', body(cat, { name: 'Other' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_SKU');
  });

  it('supports variants with their own price and stock, plus customisation fields', async () => {
    const c = await adminClient(app);
    const cat = await makeCategory();
    const res = await c.post('/api/v1/admin/products', body(cat, {
      variants: [{ label: 'Small', price: 500, stock: 3 }, { label: 'Large', price: 800, stock: 0 }],
      customFields: [{ key: 'name_text', label: 'Name to print', type: 'text', required: true }],
    }));
    expect(res.status).toBe(201);
    const pub = await request(app).get(`/api/v1/products/${res.body.data.id}`);
    expect(pub.body.data.variants).toHaveLength(2);
    expect(pub.body.data.variants[1].availability).toBe('out_of_stock');
    expect(pub.body.data.customFields[0].required).toBe(true);
  });

  it('archives instead of deleting', async () => {
    const c = await adminClient(app);
    const cat = await makeCategory();
    const p = await makeProduct(cat);
    expect((await c.del(`/api/v1/admin/products/${p._id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/products/${p._id}`)).status).toBe(404);
  });

  it('adjusts stock with history and refuses negative stock', async () => {
    const c = await adminClient(app);
    const cat = await makeCategory();
    const p = await makeProduct(cat, { stock: 4 });
    expect((await c.patch(`/api/v1/admin/products/${p._id}/stock`, { delta: 5, reason: 'Restock' })).body.data.newStock).toBe(9);
    expect((await c.patch(`/api/v1/admin/products/${p._id}/stock`, { delta: -20, reason: 'Oops' })).status).toBe(409);
    const hist = await c.get('/api/v1/admin/inventory/history');
    expect(hist.body.data[0].reason).toBe('Restock');
  });
});
