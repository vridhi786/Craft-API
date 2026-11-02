import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { authenticate, requireCsrf } from '../middleware/authenticate.js';
import { loginSchema, changePasswordSchema } from '../validators/authValidator.js';
import * as auth from '../controllers/authController.js';

/** Receives the login limiter so each app instance (and each test) can configure it. */
export default function authRoutes(limiters) {
  const r = Router();
  r.post('/admin/login', limiters.login, validate(loginSchema), auth.login);
  r.post('/admin/logout', auth.logout);
  r.get('/admin/me', authenticate, auth.me);
  r.post('/admin/change-password', authenticate, requireCsrf, validate(changePasswordSchema), auth.changePassword);
  return r;
}
