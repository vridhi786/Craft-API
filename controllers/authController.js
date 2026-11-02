import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { mapAdmin, toSafeAdmin } from '../utils/mappers.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from '../utils/password.js';
import { signSession, setSessionCookie, clearSessionCookie } from '../middleware/authenticate.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { data } = await run(supabase.from('admins').select('*').eq('email', email.toLowerCase().trim()).maybeSingle());
  const admin = data ? mapAdmin(data) : null;
  const invalid = new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');

  if (!admin || !admin.isActive) { await burnPasswordCheck(password); throw invalid; }
  if (admin.lockUntil && admin.lockUntil > new Date()) throw new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');

  if (!(await verifyPassword(password, admin.passwordHash))) {
    const attempts = admin.failedLoginAttempts + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await run(supabase.from('admins').update({ failed_login_attempts: lock ? 0 : attempts, lock_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null }).eq('id', admin.id));
    throw invalid;
  }
  await run(supabase.from('admins').update({ failed_login_attempts: 0, lock_until: null, last_login_at: new Date().toISOString() }).eq('id', admin.id));

  const { token, csrf } = signSession(admin);
  setSessionCookie(res, token);
  req.admin = admin;
  await audit(req, 'admin.login', 'Admin', admin.id);
  sendSuccess(res, { message: 'Signed in', data: { admin: toSafeAdmin(admin), csrfToken: csrf } });
});

export const logout = asyncHandler(async (_req, res) => {
  clearSessionCookie(res);
  sendSuccess(res, { message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: { admin: toSafeAdmin(req.admin), csrfToken: req.auth.csrf } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await verifyPassword(currentPassword, req.admin.passwordHash))) throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  if (currentPassword === newPassword) throw ApiError.badRequest('Choose a different password', 'PASSWORD_REUSED');
  const changedAt = new Date();
  await run(supabase.from('admins').update({ password_hash: await hashPassword(newPassword), password_changed_at: changedAt.toISOString() }).eq('id', req.admin.id));
  const { token, csrf } = signSession(req.admin); // new iat >= passwordChangedAt keeps THIS session valid, all older ones die
  setSessionCookie(res, token);
  await audit(req, 'admin.password_changed', 'Admin', req.admin.id);
  sendSuccess(res, { message: 'Password updated', data: { csrfToken: csrf } });
});
