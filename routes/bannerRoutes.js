import { Router } from 'express';
import { validate } from '../middleware/validateRequest.js';
import { adminAuth } from '../middleware/authenticate.js';
import { authorizeAdmin, ACCESS } from '../middleware/authorizeAdmin.js';
import { bannerSchema, bannerUpdateSchema } from '../validators/commerceValidator.js';
import { adminBanners as c, publicBanners } from '../controllers/bannerController.js';

export const publicRouter = Router();
publicRouter.get('/', publicBanners);

export const adminRouter = Router();
adminRouter.use(adminAuth, authorizeAdmin(...ACCESS.manager));
adminRouter.get('/', c.list);
adminRouter.post('/', validate(bannerSchema), c.create);
adminRouter.get('/:id', c.get);
adminRouter.patch('/:id', validate(bannerUpdateSchema), c.update);
adminRouter.delete('/:id', c.remove);
