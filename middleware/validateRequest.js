import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

/** validate(schema, 'body'|'query'|'params') – replaces the request part with the parsed (coerced, stripped) value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    req[source] = schema.parse(req[source] ?? {});
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      const first = details[0];
      return next(new ApiError(400, 'VALIDATION_ERROR', first ? `${first.field ? `${first.field}: ` : ''}${first.message}` : 'Invalid request', details));
    }
    return next(err);
  }
};
