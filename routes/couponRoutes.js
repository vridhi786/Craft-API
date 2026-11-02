import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { couponSchema, couponUpdateSchema, couponValidateSchema } from '../validators/commerceValidator.js';
import { adminCoupons as c, validateCouponPublic } from '../controllers/couponController.js';

export const publicRouter = Router();
publicRouter.post('/validate', validate(couponValidateSchema), validateCouponPublic);

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', c.list);
adminRouter.post('/', validate(couponSchema), c.create);
adminRouter.get('/:id', c.get);
adminRouter.patch('/:id', validate(couponUpdateSchema), c.update);
adminRouter.delete('/:id', c.remove);
