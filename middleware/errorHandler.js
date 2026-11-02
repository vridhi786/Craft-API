import { ZodError } from 'zod';
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { toApiError } from '../utils/dbError.js';
import { env } from '../config/environment.js';

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

// Supabase/Postgres errors look like {message, code, details, hint}. Database calls normally throw ApiError already (utils/dbError.js);
// this is the safety net for anything that slipped through.
const looksLikeDbError = (e) => e && typeof e === 'object' && typeof e.message === 'string' && typeof e.code === 'string' && /^(\d{2}[A-Z0-9]{3}|PGRST\d+|P\d{4})$/.test(e.code);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid request';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (looksLikeDbError(err)) {
    const mapped = toApiError(err);
    ({ status, code, message, details } = mapped);
  } else if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    status = tooBig ? 413 : 400;
    code = tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = tooBig ? 'Image is too large (max 5 MB)' : `Upload failed: ${err.message}`;
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON';
  } else if (err?.message === 'CORS_NOT_ALLOWED') {
    status = 403; code = 'CORS_NOT_ALLOWED'; message = 'Origin not allowed';
  }

  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  const body = { success: false, message, code };
  if (details) body.details = details;
  if (!env.isProduction && status >= 500) body.debug = err?.message;
  res.status(status).json(body);
}
