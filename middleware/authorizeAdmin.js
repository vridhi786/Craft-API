import { ApiError } from '../utils/ApiError.js';

export const ROLES = { SUPER: 'super_admin', MANAGER: 'manager', STAFF: 'staff' };

/** staff: orders/customers/inventory; manager: + catalogue & marketing; super_admin: + settings & destructive actions. */
export const ACCESS = {
  staff: [ROLES.SUPER, ROLES.MANAGER, ROLES.STAFF],
  manager: [ROLES.SUPER, ROLES.MANAGER],
  super: [ROLES.SUPER],
};

export const authorizeAdmin = (...allowed) => (req, _res, next) => {
  if (!req.admin) return next(ApiError.unauthorized());
  if (!allowed.includes(req.admin.role)) return next(ApiError.forbidden('Your role cannot perform this action'));
  return next();
};
