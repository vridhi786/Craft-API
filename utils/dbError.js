import { ApiError } from './ApiError.js';

// Friendly messages for named unique constraints (see supabase/schema.sql)
const UNIQUE = {
  products_sku_key: ['DUPLICATE_SKU', 'A product with this SKU already exists'],
  products_slug_key: ['DUPLICATE_SLUG', 'This slug is already in use'],
  categories_slug_key: ['DUPLICATE_SLUG', 'This slug is already in use'],
  categories_sibling_name_key: ['DUPLICATE_NAME', 'That name already exists at this level'],
  coupons_code_key: ['DUPLICATE', 'A coupon with this code already exists'],
  admins_email_key: ['DUPLICATE', 'An admin with this email already exists'],
  orders_idempotency_key_key: ['DUPLICATE_ORDER', 'This order was already submitted'],
  orders_order_id_key: ['DUPLICATE', 'Order reference collision'],
  reviews_one_per_order_product: ['REVIEW_EXISTS', 'You have already reviewed this product for this order'],
  product_variants_label_key: ['VALIDATION_ERROR', 'Variant labels must be unique'],
  customers_phone_key: ['DUPLICATE', 'Customer already exists'],
};

// Errors raised by our PL/pgSQL functions: errcode P0001, message = stable code, details = context.
const FUNCTION_ERRORS = {
  OUT_OF_STOCK: (e) => new ApiError(409, 'OUT_OF_STOCK', `${e.details || 'An item'} just went out of stock or has fewer units than requested`),
  COUPON_EXHAUSTED: () => new ApiError(400, 'COUPON_EXHAUSTED', 'This coupon has reached its usage limit'),
  INVALID_TRANSITION: () => new ApiError(409, 'INVALID_TRANSITION', 'That status change is not allowed for this order'),
  NEGATIVE_STOCK: () => new ApiError(409, 'NEGATIVE_STOCK', 'Stock cannot go below zero'),
  VARIANT_REQUIRED: () => new ApiError(400, 'VARIANT_REQUIRED', 'This product has variants: choose which variant to adjust'),
  NOT_FOUND: () => new ApiError(404, 'NOT_FOUND', 'Record not found'),
  INVALID_TARGET: () => new ApiError(400, 'INVALID_TARGET', 'Choose a different, existing category at the same level to move items into'),
  INVALID_PARENT_LEVEL: () => new ApiError(400, 'INVALID_PARENT_LEVEL', 'Parent has the wrong level'),
  DELTA_OR_SET: () => new ApiError(400, 'VALIDATION_ERROR', 'Provide either "delta" or "stock"'),
};

const constraintOf = (message = '') => (message.match(/constraint "([^"]+)"/) || [])[1];

/** Converts a Supabase/PostgREST/Postgres error object ({message, code, details, hint}) into an ApiError. */
export function toApiError(error) {
  if (error instanceof ApiError) return error;
  const { code, message = '', details } = error || {};

  if (code === 'P0001' && FUNCTION_ERRORS[message]) return FUNCTION_ERRORS[message]({ details });
  if (code === '23505') {
    const [apiCode, msg] = UNIQUE[constraintOf(message)] || ['DUPLICATE', 'A record with these details already exists'];
    return new ApiError(409, apiCode, msg);
  }
  if (code === '23503') return new ApiError(409, 'REFERENCED', 'This record is still referenced by other data, or points to something that does not exist');
  if (code === '23514') return new ApiError(400, 'VALIDATION_ERROR', `Invalid data (${constraintOf(message) || 'check constraint'})`);
  if (code === '23502') return new ApiError(400, 'VALIDATION_ERROR', 'A required value is missing');
  if (code === '22P02' || code === '22003' || code === '22007') return new ApiError(400, 'INVALID_INPUT', 'A value has an invalid format');
  if (code === 'PGRST116') return new ApiError(404, 'NOT_FOUND', 'Record not found');
  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|timeout/i.test(message)) return new ApiError(503, 'DB_UNAVAILABLE', 'The database is temporarily unreachable. Please try again.');
  if (code === 'PGRST301' || /JWT|apikey|permission denied|row-level security/i.test(message)) {
    console.error('Supabase authorisation problem – check SUPABASE_SERVICE_ROLE_KEY:', message);
    return new ApiError(500, 'DB_CONFIG', 'Server database configuration error');
  }
  console.error('Unmapped database error:', { code, message, details });
  return new ApiError(500, 'DB_ERROR', 'A database error occurred');
}

/** Awaits a supabase-js builder and throws a mapped ApiError on failure. Returns the full response ({data, count}). */
export async function run(builder) {
  let res;
  try { res = await builder; } catch (err) { throw toApiError({ message: err?.message || 'fetch failed' }); }
  if (res.error) throw toApiError(res.error);
  return res;
}
/** Shorthand returning only `data`. */
export const data = async (builder) => (await run(builder)).data;
