import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { productCreateSchema, productUpdateSchema, productStatusSchema, productStockSchema, productListQuery, searchQuery } from '../validators/productValidator.js';
import * as c from '../controllers/productController.js';

export const publicRouter = Router();
// Static paths must be registered before "/:id".
publicRouter.get('/', validate(productListQuery, 'query'), c.publicList);
publicRouter.get('/featured', validate(productListQuery, 'query'), c.publicFeatured);
publicRouter.get('/bestsellers', validate(productListQuery, 'query'), c.publicBestsellers);
publicRouter.get('/new-arrivals', validate(productListQuery, 'query'), c.publicNewArrivals);
publicRouter.get('/search', validate(searchQuery, 'query'), c.publicSearch);
publicRouter.get('/slug/:slug', c.publicGetBySlug);
publicRouter.get('/:id/related', c.publicRelated);
publicRouter.get('/:id', c.publicGetById);

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', validate(productListQuery, 'query'), c.adminList);
adminRouter.post('/', validate(productCreateSchema), c.adminCreate);
adminRouter.get('/:id', c.adminGet);
adminRouter.patch('/:id', validate(productUpdateSchema), c.adminUpdate);
adminRouter.patch('/:id/status', validate(productStatusSchema), c.adminSetStatus);
adminRouter.patch('/:id/stock', validate(productStockSchema), c.adminSetStock);
adminRouter.delete('/:id', c.adminDelete);
