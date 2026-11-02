import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { settingsSchema } from '../validators/commerceValidator.js';
import * as c from '../controllers/settingsController.js';

export const publicRouter = Router();
publicRouter.get('/public', c.getPublicSettings);

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', c.getAdminSettings);
adminRouter.patch('/', validate(settingsSchema), c.updateSettings);
