import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const cloud = vi.hoisted(() => ({ configured: true, uploadBuffer: vi.fn() }));
vi.mock('../config/cloud-storage.js', () => ({
  isCloudStorageConfigured: () => cloud.configured,
  uploadBuffer: cloud.uploadBuffer,
  deleteImage: vi.fn(),
}));

const { startDb, stopDb, resetDb, makeApp, adminClient } = await import('./helpers.js');

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  cloud.configured = true;
  cloud.uploadBuffer.mockReset();
  cloud.uploadBuffer.mockResolvedValue({ secure_url: 'https://res.cloudinary.com/test/image/upload/a.png', public_id: 'a', width: 1, height: 1 });
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const upload = (c, path, buf, name = 'a.png', type = 'image/png') => c.agent.post(`/api/v1/admin/uploads/${path}`).set('X-CSRF-Token', c.csrf).attach('images', buf, { filename: name, contentType: type });

describe('image uploads', () => {
  it('accepts a valid image and returns only public data', async () => {
    const c = await adminClient(app);
    const res = await upload(c, 'product-images', PNG);
    expect(res.status).toBe(201);
    expect(res.body.data[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\//), publicId: 'a' });
    expect(JSON.stringify(res.body)).not.toMatch(/api_secret|apiSecret/i);
  });

  it('rejects unsupported MIME types', async () => {
    const c = await adminClient(app);
    const res = await upload(c, 'product-images', Buffer.from('hello'), 'a.txt', 'text/plain');
    expect(res.status).toBe(415);
  });

  it('rejects files whose content does not match their declared type', async () => {
    const c = await adminClient(app);
    const res = await upload(c, 'product-images', Buffer.from('<?php echo 1; ?> not an image at all'), 'evil.png', 'image/png');
    expect(res.status).toBe(415);
    expect(cloud.uploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects oversized images', async () => {
    const c = await adminClient(app);
    const big = Buffer.concat([PNG.subarray(0, 12), Buffer.alloc(6 * 1024 * 1024)]);
    const res = await upload(c, 'banner-images', big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects unauthenticated and under-privileged uploads', async () => {
    expect((await request(app).post('/api/v1/admin/uploads/product-images').attach('images', PNG, { filename: 'a.png', contentType: 'image/png' })).status).toBe(401);
    const staff = await adminClient(app, 'staff');
    expect((await upload(staff, 'product-images', PNG)).status).toBe(403);
  });

  it('reports storage failures honestly', async () => {
    const c = await adminClient(app);
    cloud.uploadBuffer.mockRejectedValue(new Error('cloud down'));
    const res = await upload(c, 'category-images', PNG);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPLOAD_FAILED');
    cloud.configured = false;
    expect((await upload(c, 'category-images', PNG)).body.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});

describe('settings, banners, reviews', () => {
  it('persists settings and exposes only public fields', async () => {
    const c = await adminClient(app);
    const saved = await c.patch('/api/v1/admin/settings', { announcement: { enabled: true, text: 'Free gift wrap' }, whatsappNumber: '919574546023' });
    expect(saved.status).toBe(200);
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.data.announcement).toMatchObject({ enabled: true, text: 'Free gift wrap' });
    expect(pub.body.data.hero.title).toBeTruthy(); // sibling defaults survive partial update
    expect(pub.body.data._id).toBeUndefined();
    expect(pub.body.data.key).toBeUndefined();
    expect((await c.patch('/api/v1/admin/settings', { whatsappNumber: '+91 95745 46023' })).status).toBe(400);
  });

  it('serves only scheduled, active banners', async () => {
    const c = await adminClient(app);
    const img = { url: 'https://res.cloudinary.com/test/image/upload/b.jpg', alt: 'x' };
    await c.post('/api/v1/admin/banners', { title: 'Live', image: img });
    await c.post('/api/v1/admin/banners', { title: 'Off', image: img, isActive: false });
    await c.post('/api/v1/admin/banners', { title: 'Future', image: img, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const res = await request(app).get('/api/v1/banners');
    expect(res.body.data.map((b) => b.title)).toEqual(['Live']);
  });

  it('only allows reviews from verified, delivered orders and requires moderation', async () => {
    const { makeCategory, makeProduct, validOrder, key } = await import('./helpers.js');
    const c = await adminClient(app);
    const p = await makeProduct(await makeCategory());
    const order = (await request(app).post('/api/v1/orders').set('Idempotency-Key', key()).send(validOrder(p._id))).body.data;
    const review = { orderId: order.orderId, phone: '9574546023', productId: String(p._id), rating: 5, text: 'Lovely gift' };

    expect((await request(app).post('/api/v1/reviews').send(review)).status).toBe(403); // not delivered yet
    for (const s of ['confirmed', 'processing', 'ready_to_ship', 'shipped', 'delivered']) await c.patch(`/api/v1/admin/orders/${order.orderId}/status`, { status: s });
    expect((await request(app).post('/api/v1/reviews').send({ ...review, phone: '9876543210' })).status).toBe(403);
    expect((await request(app).post('/api/v1/reviews').send({ ...review, rating: 9 })).status).toBe(400);
    expect((await request(app).post('/api/v1/reviews').send(review)).status).toBe(201);
    expect((await request(app).post('/api/v1/reviews').send(review)).status).toBe(409);

    expect((await request(app).get('/api/v1/reviews')).body.data).toHaveLength(0);
    const pending = await c.get('/api/v1/admin/reviews?status=pending');
    expect((await c.patch(`/api/v1/admin/reviews/${pending.body.data[0].id}`, { status: 'approved' })).status).toBe(200);
    const pub = await request(app).get('/api/v1/reviews');
    expect(pub.body.data[0]).toMatchObject({ rating: 5, customerName: 'Asha' });
    expect(JSON.stringify(pub.body)).not.toMatch(/9574546023/);
  });
});
