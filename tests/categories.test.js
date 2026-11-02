import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, resetDb, makeApp, adminClient, makeCategory, makeProduct } from './helpers.js';

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

describe('categories', () => {
  it('creates categories and generates unique slugs', async () => {
    const c = await adminClient(app);
    const a = await c.post('/api/v1/admin/categories', { name: 'Home Decor' });
    expect(a.status).toBe(201);
    expect(a.body.data.slug).toBe('home-decor');
    const dupSlug = await c.post('/api/v1/admin/categories', { name: 'Other', slug: 'home-decor' });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.code).toBe('DUPLICATE_SLUG');
    expect((await c.post('/api/v1/admin/categories', { name: 'home decor' })).status).toBe(409);
  });

  it('subcategories are optional: products can sit directly under a category', async () => {
    const c = await adminClient(app);
    const cat = (await c.post('/api/v1/admin/categories', { name: 'Gifts' })).body.data;
    const prod = await c.post('/api/v1/admin/products', { name: 'Gift Box', sku: 'GB1', category: cat.id, price: 700, stock: 3 });
    expect(prod.status).toBe(201);
    const list = await request(app).get('/api/v1/categories/gifts/products');
    expect(list.status).toBe(200);
    expect(list.body.data.map((p) => p.name)).toEqual(['Gift Box']);
  });

  it('supports Category → Subcategory → Child category and returns a nested tree', async () => {
    const c = await adminClient(app);
    const cat = (await c.post('/api/v1/admin/categories', { name: 'Home Decor' })).body.data;
    const sub = await c.post('/api/v1/admin/subcategories', { name: 'Photo Frames', parent: cat.id });
    expect(sub.status).toBe(201);
    expect(sub.body.data.level).toBe(2);
    const child = await c.post('/api/v1/admin/child-categories', { name: 'Wooden Frames', parent: sub.body.data.id });
    expect(child.status).toBe(201);
    expect(child.body.data.level).toBe(3);
    const prod = await c.post('/api/v1/admin/products', { name: 'Oak Frame', sku: 'OF1', category: cat.id, subcategory: sub.body.data.id, childCategory: child.body.data.id, price: 900, stock: 2 });
    expect(prod.status).toBe(201);

    const tree = await request(app).get('/api/v1/categories');
    expect(tree.body.data[0].children[0].children[0].name).toBe('Wooden Frames');
    expect((await request(app).get('/api/v1/categories/wooden-frames/products')).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/categories/home-decor/products')).body.data).toHaveLength(1);
  });

  it('rejects invalid parent-child relationships', async () => {
    const c = await adminClient(app);
    const a = (await c.post('/api/v1/admin/categories', { name: 'A' })).body.data;
    const b = (await c.post('/api/v1/admin/categories', { name: 'B' })).body.data;
    const subA = (await c.post('/api/v1/admin/subcategories', { name: 'SubA', parent: a.id })).body.data;
    const childA = (await c.post('/api/v1/admin/child-categories', { name: 'ChildA', parent: subA.id })).body.data;

    expect((await c.post('/api/v1/admin/subcategories', { name: 'Orphan' })).body.code).toBe('PARENT_REQUIRED');
    expect((await c.post('/api/v1/admin/child-categories', { name: 'Wrong', parent: a.id })).body.code).toBe('INVALID_PARENT_LEVEL');
    expect((await c.post('/api/v1/admin/categories', { name: 'Too deep', parent: childA.id })).body.code).toBe('MAX_DEPTH');
    // product pointing at a subcategory of a different category
    const bad = await c.post('/api/v1/admin/products', { name: 'X', sku: 'X1', category: b.id, subcategory: subA.id, price: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SUBCATEGORY');
    const noSub = await c.post('/api/v1/admin/products', { name: 'Y', sku: 'Y1', category: a.id, childCategory: childA.id, price: 100 });
    expect(noSub.body.code).toBe('INVALID_CHILD_CATEGORY');
  });

  it('refuses to delete a category with dependents unless archiving or reassigning', async () => {
    const c = await adminClient(app);
    const a = await makeCategory({ name: 'Old' });
    const b = await makeCategory({ name: 'New' });
    const prod = await makeProduct(a);

    const blocked = await c.del(`/api/v1/admin/categories/${a._id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('HAS_DEPENDENTS');
    expect(blocked.body.details.productCount).toBe(1);

    const moved = await c.del(`/api/v1/admin/categories/${a._id}?reassignTo=${b._id}`);
    expect(moved.status).toBe(200);
    expect((await request(app).get(`/api/v1/products/${prod._id}`)).body.data.category.name).toBe('New');
    expect((await c.del(`/api/v1/admin/categories/${b._id}?archive=true`)).status).toBe(200);
    expect((await request(app).get('/api/v1/categories')).body.data).toHaveLength(0);
  });

  it('deletes an empty category outright', async () => {
    const c = await adminClient(app);
    const a = await makeCategory({ name: 'Empty' });
    expect((await c.del(`/api/v1/admin/categories/${a._id}`)).status).toBe(200);
  });

  it('hides inactive categories from the public', async () => {
    const c = await adminClient(app);
    const a = (await c.post('/api/v1/admin/categories', { name: 'Hidden', isActive: false })).body.data;
    expect((await request(app).get('/api/v1/categories')).body.data).toHaveLength(0);
    expect((await request(app).get(`/api/v1/categories/${a.slug}`)).status).toBe(404);
  });
});
