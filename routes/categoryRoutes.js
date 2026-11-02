import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { categoryCreateSchema, categoryUpdateSchema, categoryDeleteQuery } from '../validators/categoryValidator.js';
import { productListQuery } from '../validators/productValidator.js';
import * as c from '../controllers/categoryController.js';

export const publicRouter = Router();
publicRouter.get('/', c.publicTree);
publicRouter.get('/:slug/products', validate(productListQuery, 'query'), c.publicProducts);
publicRouter.get('/:id', c.publicGet);

/** level: undefined = any level (/admin/categories), 2 = /admin/subcategories, 3 = /admin/child-categories */
export function adminRouterFor(level) {
  const r = Router();
  r.use(adminAuth, authorizeAdmin(...ACCESS.manager));
  r.get('/', c.adminList(level));
  r.post('/', validate(categoryCreateSchema), c.adminCreate(level));
  r.get('/:id', c.adminGet);
  r.patch('/:id', validate(categoryUpdateSchema), c.adminUpdate(level));
  r.delete('/:id', validate(categoryDeleteQuery, 'query'), c.adminDelete(level));
  return r;
}
