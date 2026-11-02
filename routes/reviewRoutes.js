import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { reviewCreateSchema, reviewModerateSchema, reviewListQuery } from '../validators/commerceValidator.js';
import * as c from '../controllers/reviewController.js';

export function publicRouter(limiters) {
  const r = Router();
  r.get('/', validate(reviewListQuery, 'query'), c.publicList);
  r.post('/', limiters.track, validate(reviewCreateSchema), c.create);
  return r;
}

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', validate(reviewListQuery, 'query'), c.adminList);
adminRouter.patch('/:id', validate(reviewModerateSchema), c.moderate);
adminRouter.delete('/:id', c.remove);
