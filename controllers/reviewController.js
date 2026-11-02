import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { normalizeIndianPhone } from '../utils/phone.js';
import { mapReview } from '../utils/mappers.js';
import { getSettings } from '../services/settingsService.js';
import { fetchOrderByOrderId } from '../services/orderService.js';

const PUBLIC_COLUMNS = 'id, product_id, customer_name, rating, title, text, status, created_at'; // never selects customer_phone
const present = (r) => { const m = mapReview(r); return { id: m.id, product: m.product, customerName: m.customerName, rating: m.rating, title: m.title, text: m.text, createdAt: m.createdAt }; };

/** A review requires a delivered order containing the product, verified by order ID + phone. Reviews start as "pending". */
export const create = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.display.showReviews) throw ApiError.forbidden('Reviews are currently disabled', 'REVIEWS_DISABLED');
  const phone = normalizeIndianPhone(req.body.phone);
  const order = phone ? await fetchOrderByOrderId(req.body.orderId.toUpperCase()) : null;
  if (!order || order.customer.phone !== phone || order.status !== 'delivered' || !order.items.some((i) => i.product === req.body.productId)) {
    throw new ApiError(403, 'REVIEW_NOT_ALLOWED', 'We could not verify a delivered order for this product with these details.');
  }
  await run(supabase.from('reviews').insert({   // unique(order_id, product_id) → 409 REVIEW_EXISTS
    product_id: req.body.productId, order_id: order.id, customer_name: order.customer.name.split(' ')[0], customer_phone: phone,
    rating: req.body.rating, title: req.body.title || '', text: req.body.text,
  }));
  sendSuccess(res, { status: 201, message: 'Thank you! Your review will appear once approved.' });
});

export const publicList = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.display.showReviews) return sendSuccess(res, { data: [], meta: pageMeta(1, 1, 0) });
  const { page, limit, product } = req.query;
  let list = supabase.from('reviews').select(PUBLIC_COLUMNS, { count: 'exact' }).eq('status', 'approved');
  let ratings = supabase.from('reviews').select('rating').eq('status', 'approved').limit(5000);
  if (product) { list = list.eq('product_id', product); ratings = ratings.eq('product_id', product); }
  const [{ data, count }, { data: rs }] = await Promise.all([run(list.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1)), run(ratings)]);
  const avg = rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : null;
  sendSuccess(res, { data: data.map(present), meta: { ...pageMeta(page, limit, count ?? 0), averageRating: avg } });
});

export const adminList = asyncHandler(async (req, res) => {
  const { page, limit, status, product } = req.query;
  let q = supabase.from('reviews').select(`${PUBLIC_COLUMNS.replace('product_id, ', '')}, product:products(id,name,slug)`, { count: 'exact' });
  if (status) q = q.eq('status', status);
  if (product) q = q.eq('product_id', product);
  const { data, count } = await run(q.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1));
  sendSuccess(res, { data: data.map((r) => ({ ...present(r), product: mapReview(r).product, status: r.status })), meta: pageMeta(page, limit, count ?? 0) });
});

export const moderate = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
  const { data } = await run(supabase.from('reviews').update({ status: req.body.status }).eq('id', req.params.id).select('id, status').maybeSingle());
  if (!data) throw ApiError.notFound('Review not found');
  await audit(req, 'review.moderate', 'Review', data.id, { status: data.status });
  sendSuccess(res, { message: `Review ${data.status}`, data: { id: data.id, status: data.status } });
});

export const remove = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
  const { data } = await run(supabase.from('reviews').delete().eq('id', req.params.id).select('id').maybeSingle());
  if (!data) throw ApiError.notFound('Review not found');
  await audit(req, 'review.delete', 'Review', data.id);
  sendSuccess(res, { message: 'Review deleted' });
});
