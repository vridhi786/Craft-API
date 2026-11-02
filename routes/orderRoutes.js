import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { quoteSchema, createOrderSchema, trackQuery, orderListQuery, statusSchema, notesSchema, cancelSchema, paymentSchema, exportSchema } from '../validators/orderValidator.js';
import * as c from '../controllers/orderController.js';

/** Cart/pricing endpoints: POST /cart/validate and POST /pricing/quote */
export const pricingRouter = Router();
pricingRouter.post('/cart/validate', validate(quoteSchema), c.quote);
pricingRouter.post('/pricing/quote', validate(quoteSchema), c.quote);

export function publicOrderRouter(limiters) {
  const r = Router();
  r.post('/', limiters.order, validate(createOrderSchema), c.create);
  r.get('/:orderId/track', limiters.track, validate(trackQuery, 'query'), c.track);
  return r;
}

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.staff));
adminRouter.get('/', validate(orderListQuery, 'query'), c.adminList);
adminRouter.post('/export', validate(exportSchema), c.adminExport);
adminRouter.get('/:id', c.adminGet);
adminRouter.patch('/:id/status', validate(statusSchema), c.adminSetStatus);
adminRouter.patch('/:id/notes', validate(notesSchema), c.adminAddNote);
adminRouter.patch('/:id/payment', validate(paymentSchema), c.adminSetPayment);
adminRouter.post('/:id/cancel', validate(cancelSchema), c.adminCancel);
