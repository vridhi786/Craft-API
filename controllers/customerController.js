import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { safeFilterTerm } from '../utils/regex.js';
import { mapCustomer } from '../utils/mappers.js';

export const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  let q = supabase.from('customers').select('*', { count: 'exact' });
  const term = req.query.q ? safeFilterTerm(req.query.q) : '';
  if (term) {
    const digits = String(req.query.q).replace(/\D/g, '');
    q = q.or([`name.ilike.%${term}%`, `email.ilike.%${term}%`, ...(digits ? [`phone.like.%${digits}%`] : [])].join(','));
  }
  const { data, count } = await run(q.order('last_order_at', { ascending: false, nullsFirst: false }).range((page - 1) * limit, page * limit - 1));
  sendSuccess(res, { message: 'Customers retrieved', data: data.map(mapCustomer), meta: pageMeta(page, limit, count ?? 0) });
});

export const get = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
  const { data } = await run(supabase.from('customers').select('*').eq('id', req.params.id).maybeSingle());
  if (!data) throw ApiError.notFound('Customer not found');
  const customer = mapCustomer(data);
  const { data: orders } = await run(supabase.from('orders').select('id, order_id, status, total, created_at, payment_status').eq('customer_phone', customer.phone).order('created_at', { ascending: false }).limit(50));
  sendSuccess(res, { data: { ...customer, orders: orders.map((o) => ({ _id: o.id, id: o.id, orderId: o.order_id, status: o.status, total: Number(o.total), createdAt: o.created_at, paymentStatus: o.payment_status })) } });
});
