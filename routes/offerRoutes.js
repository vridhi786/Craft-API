import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { offerSchema, offerUpdateSchema } from '../validators/commerceValidator.js';
import { adminOffers as c, publicOffers } from '../controllers/offerController.js';

export const publicRouter = Router();
publicRouter.get('/', publicOffers);

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', c.list);
adminRouter.post('/', validate(offerSchema), c.create);
adminRouter.get('/:id', c.get);
adminRouter.patch('/:id', validate(offerUpdateSchema), c.update);
adminRouter.delete('/:id', c.remove);
