import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/environment.js';
import { checkDatabase } from './config/supabase.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { sanitizeRequest } from './utils/sanitizeInput.js';
import { createLimiters } from './middleware/rateLimiter.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { sendSuccess } from './utils/ApiResponse.js';
import authRoutes from './routes/authRoutes.js';
import * as productRoutes from './routes/productRoutes.js';
import * as categoryRoutes from './routes/categoryRoutes.js';
import { subcategoryRouter, childCategoryRouter } from './routes/subcategoryRoutes.js';
import * as orderRoutes from './routes/orderRoutes.js';
import * as couponRoutes from './routes/couponRoutes.js';
import * as offerRoutes from './routes/offerRoutes.js';
import * as bannerRoutes from './routes/bannerRoutes.js';
import * as reviewRoutes from './routes/reviewRoutes.js';
import * as customerRoutes from './routes/customerRoutes.js';
import * as inventoryRoutes from './routes/inventoryRoutes.js';
import * as settingsRoutes from './routes/settingsRoutes.js';
import { uploadRouter, dashboardRouter } from './routes/adminRoutes.js';

export const API_VERSION = '1.0.0';

export function createApp({ limits = env.limits, allowedOrigins = env.frontendOrigins } = {}) {
  const app = express();
  const limiters = createLimiters(limits);

  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', env.trustProxy);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS_NOT_ALLOWED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      maxAge: 600,
    })
  );
  app.use(compression());
  if (!env.isTest) app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeRequest);

  const v1 = express.Router();
  v1.use(limiters.api);

  // Render's health check: returns 200 while the process is up (database state is reported, but does not fail the check).
  v1.get('/health', asyncHandler(async (_req, res) => {
    const db = await checkDatabase();
    sendSuccess(res, { message: 'Service is running', data: { status: 'ok', version: API_VERSION, database: db.ok ? 'up' : 'down', time: new Date().toISOString() } });
  }));

  v1.use('/auth', authRoutes(limiters));

  // Public
  v1.use('/products', productRoutes.publicRouter);
  v1.use('/categories', categoryRoutes.publicRouter);
  v1.use('/', orderRoutes.pricingRouter);
  v1.use('/orders', orderRoutes.publicOrderRouter(limiters));
  v1.use('/coupons', couponRoutes.publicRouter);
  v1.use('/offers', offerRoutes.publicRouter);
  v1.use('/banners', bannerRoutes.publicRouter);
  v1.use('/reviews', reviewRoutes.publicRouter(limiters));
  v1.use('/settings', settingsRoutes.publicRouter);

  // Admin (every router applies authenticate + CSRF + role checks itself)
  v1.use('/admin/dashboard', dashboardRouter);
  v1.use('/admin/products', productRoutes.adminRouter);
  v1.use('/admin/categories', categoryRoutes.adminRouterFor());
  v1.use('/admin/subcategories', subcategoryRouter);
  v1.use('/admin/child-categories', childCategoryRouter);
  v1.use('/admin/orders', orderRoutes.adminRouter);
  v1.use('/admin/customers', customerRoutes.adminRouter);
  v1.use('/admin/coupons', couponRoutes.adminRouter);
  v1.use('/admin/offers', offerRoutes.adminRouter);
  v1.use('/admin/banners', bannerRoutes.adminRouter);
  v1.use('/admin/reviews', reviewRoutes.adminRouter);
  v1.use('/admin/inventory', inventoryRoutes.adminRouter);
  v1.use('/admin/settings', settingsRoutes.adminRouter);
  v1.use('/admin/uploads', uploadRouter);

  app.use('/api/v1', v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
