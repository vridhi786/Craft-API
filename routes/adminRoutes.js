import { Router } from 'express';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { imageUpload } from '../middleware/uploadMiddleware.js';
import { uploadTo } from '../controllers/uploadController.js';
import { stats } from '../controllers/dashboardController.js';

export const uploadRouter = Router();
uploadRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
uploadRouter.post('/product-images', imageUpload(10), uploadTo('products'));
uploadRouter.post('/category-images', imageUpload(1), uploadTo('categories'));
uploadRouter.post('/banner-images', imageUpload(2), uploadTo('banners'));
uploadRouter.post('/site-images', imageUpload(1), uploadTo('site'));

export const dashboardRouter = Router();
dashboardRouter.use(adminAuth, authorizeAdmin(...ACCESS.staff));
dashboardRouter.get('/', stats);
