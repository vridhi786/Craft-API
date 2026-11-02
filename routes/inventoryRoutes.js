import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { inventoryAdjustSchema } from '../validators/commerceValidator.js';
import * as c from '../controllers/inventoryController.js';

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.staff));
adminRouter.get('/', c.list);
adminRouter.get('/history', c.history);
adminRouter.post('/adjust', validate(inventoryAdjustSchema), c.adjust);
