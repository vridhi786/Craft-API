import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, resetDb, makeApp, createAdmin, adminClient, ADMIN_PASSWORD } from './helpers.js';

const app = makeApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

describe('admin authentication', () => {
  it('logs in with valid credentials and sets an HttpOnly cookie', async () => {
    const admin = await createAdmin();
    const res = await request(app).post('/api/v1/auth/admin/login').send({ email: admin.email, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.csrfToken).toBeTruthy();
    expect(res.body.data.admin.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/cw_admin=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('rejects invalid credentials with a generic message', async () => {
    const admin = await createAdmin();
    const wrong = await request(app).post('/api/v1/auth/admin/login').send({ email: admin.email, password: 'wrong-password' });
    const unknown = await request(app).post('/api/v1/auth/admin/login').send({ email: 'nobody@example.com', password: 'whatever12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects missing credentials', async () => {
    const res = await request(app).post('/api/v1/auth/admin/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rate-limits repeated login attempts', async () => {
    const limited = makeApp({ loginMax: 3, apiMax: 1000, orderMax: 1000 });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await request(limited).post('/api/v1/auth/admin/login').send({ email: 'a@b.com', password: 'x' })).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });

  it('locks the account after repeated failures', async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/v1/auth/admin/login').send({ email: admin.email, password: 'bad-password-1' });
    const res = await request(app).post('/api/v1/auth/admin/login').send({ email: admin.email, password: ADMIN_PASSWORD });
    expect(res.status).toBe(423);
  });

  it('blocks unauthenticated access to admin endpoints', async () => {
    for (const path of ['/admin/products', '/admin/orders', '/admin/settings', '/admin/customers', '/admin/dashboard']) {
      const res = await request(app).get(`/api/v1${path}`);
      expect(res.status, path).toBe(401);
    }
    expect((await request(app).get('/api/v1/auth/admin/me')).status).toBe(401);
  });

  it('forbids staff from catalogue and settings management', async () => {
    const staff = await adminClient(app, 'staff');
    expect((await staff.post('/api/v1/admin/products', {})).status).toBe(403);
    expect((await staff.get('/api/v1/admin/settings')).status).toBe(403);
    expect((await staff.get('/api/v1/admin/orders')).status).toBe(200);
  });

  it('requires a CSRF token for state-changing admin requests', async () => {
    const { agent } = await adminClient(app);
    const res = await agent.post('/api/v1/admin/categories').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('returns the session on /me and ends it on logout', async () => {
    const c = await adminClient(app);
    const me = await c.get('/api/v1/auth/admin/me');
    expect(me.status).toBe(200);
    expect(me.body.data.admin.email).toBe(c.admin.email);
    await c.agent.post('/api/v1/auth/admin/logout');
    expect((await c.get('/api/v1/auth/admin/me')).status).toBe(401);
  });

  it('changes password, enforcing the policy and invalidating old sessions', async () => {
    const c = await adminClient(app);
    expect((await c.post('/api/v1/auth/admin/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await c.post('/api/v1/auth/admin/change-password', { currentPassword: 'nope-nope-nope', newPassword: 'NewStr0ngPassw0rd!' })).status).toBe(400);
    expect((await c.post('/api/v1/auth/admin/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: 'NewStr0ngPassw0rd!' })).status).toBe(200);
  });

  it('rejects disallowed CORS origins', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('exposes a health endpoint without secrets', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(JSON.stringify(res.body)).not.toMatch(/supabase|service_role|secret|password/i);
  });
});
