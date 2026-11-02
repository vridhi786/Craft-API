import { Router } from 'express';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import * as c from '../controllers/customerController.js';

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.staff));
adminRouter.get('/', c.list);
adminRouter.get('/:id', c.get);
