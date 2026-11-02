import { adminRouterFor } from './categoryRoutes.js';

// Subcategories (level 2) and child categories (level 3) share the Category model and controller logic,
// with the level enforced by the router.
export const subcategoryRouter = adminRouterFor(2);
export const childCategoryRouter = adminRouterFor(3);
