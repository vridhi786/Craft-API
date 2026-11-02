import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment.js';
import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { mapAdmin } from '../utils/mappers.js';

export const COOKIE_NAME = 'cw_admin';

export function signSession(admin) {
  const csrf = crypto.randomBytes(24).toString('hex');
  const token = jwt.sign({ sub: admin.id, role: admin.role, csrf }, env.jwtSecret, { algorithm: 'HS256', expiresIn: env.jwtExpiresIn });
  return { token, csrf };
}

const cookieBase = () => ({ httpOnly: true, secure: env.isProduction || env.cookieSameSite === 'none', sameSite: env.cookieSameSite, path: '/' });
export const setSessionCookie = (res, token) => res.cookie(COOKIE_NAME, token, { ...cookieBase(), maxAge: 8 * 60 * 60 * 1000 });
export const clearSessionCookie = (res) => res.clearCookie(COOKIE_NAME, cookieBase());

/** Verifies the HttpOnly session cookie and loads the admin from Supabase. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw ApiError.unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw ApiError.unauthorized('Session expired. Please sign in again.', 'SESSION_INVALID');
  }
  if (!isUuid(payload.sub)) throw ApiError.unauthorized('Session expired. Please sign in again.', 'SESSION_INVALID');
  const { data } = await run(supabase.from('admins').select('*').eq('id', payload.sub).maybeSingle());
  const admin = data ? mapAdmin(data) : null;
  if (!admin || !admin.isActive) throw ApiError.unauthorized('Account is not available', 'SESSION_INVALID');
  if (admin.passwordChangedAt && payload.iat < Math.floor(admin.passwordChangedAt.getTime() / 1000)) {
    throw ApiError.unauthorized('Password was changed. Please sign in again.', 'SESSION_INVALID');
  }
  req.admin = admin;
  req.auth = { csrf: payload.csrf };
  next();
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence for cookie auth: state-changing requests must echo the per-session token in a custom header. */
export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const expected = Buffer.from(String(req.auth?.csrf || ''));
  if (sent.length === 0 || sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return next(ApiError.forbidden('Invalid or missing CSRF token', 'CSRF_INVALID'));
  }
  return next();
}

export const adminAuth = [authenticate, requireCsrf];
