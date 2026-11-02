import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { safeFilterTerm } from '../utils/regex.js';
import { STATUS_LABELS } from '../utils/orderStatus.js';
import { mapOrder, SELECT_ORDER, SELECT_ORDER_LIST } from '../utils/mappers.js';
import { buildQuote, publicQuote } from '../services/pricingService.js';
import { createOrder, toOrderSummary, changeStatus, cancelOrder, fetchOrderById, fetchOrderByOrderId } from '../services/orderService.js';
import { customerWhatsAppUrl } from '../services/whatsappService.js';
import { getSettings } from '../services/settingsService.js';
import { idempotencyKeySchema } from '../validators/orderValidator.js';

/* ---------- public ---------- */
export const quote = asyncHandler(async (req, res) => {
  const q = await buildQuote({ items: req.body.items, couponCode: req.body.couponCode, phone: req.body.phone });
  sendSuccess(res, { message: 'Price quote calculated', data: publicQuote(q) });
});

export const create = asyncHandler(async (req, res) => {
  const rawKey = req.get('idempotency-key');
  let key;
  if (rawKey) {
    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0].message, 'INVALID_IDEMPOTENCY_KEY');
    key = parsed.data;
  }
  const { order, duplicate } = await createOrder(req.body, key);
  sendSuccess(res, {
    status: duplicate ? 200 : 201,
    message: duplicate ? 'Order was already created' : 'Order created. Send it on WhatsApp to get it confirmed.',
    data: { ...toOrderSummary(order), duplicate },
  });
});

/** Minimal tracking data. Requires order ID + the phone number used on the order; a mismatch looks identical to "not found". */
export const track = asyncHandler(async (req, res) => {
  const { data } = await run(supabase.from('orders').select(SELECT_ORDER).eq('order_id', req.params.orderId.toUpperCase()).eq('customer_phone', req.query.phone).maybeSingle());
  if (!data) throw ApiError.notFound('No order found for these details. Check the order ID and phone number.', 'ORDER_NOT_FOUND');
  const order = mapOrder(data);
  sendSuccess(res, {
    data: {
      orderId: order.orderId, status: order.status, statusLabel: STATUS_LABELS[order.status], createdAt: order.createdAt,
      history: order.statusHistory.map((h) => ({ status: h.status, label: STATUS_LABELS[h.status], at: h.at })),
      items: order.items.map((i) => ({ name: i.name, variantLabel: i.variantLabel, quantity: i.quantity })),
      total: order.total, paymentStatus: order.paymentStatus,
      note: order.status === 'pending_confirmation' ? 'We will confirm your order on WhatsApp. Pending until then.' : undefined,
    },
  });
});

/* ---------- admin ---------- */
function applyListFilters(qb, q) {
  if (q.status) qb = qb.eq('status', q.status);
  if (q.paymentStatus) qb = qb.eq('payment_status', q.paymentStatus);
  if (q.from) qb = qb.gte('created_at', q.from.toISOString());
  if (q.to) qb = qb.lte('created_at', new Date(q.to.getTime() + (q.to.getUTCHours() === 0 && q.to.getUTCMinutes() === 0 ? 86_399_999 : 0)).toISOString());
  if (q.q) {
    const term = safeFilterTerm(q.q);                 // only letters/digits/space/@/- reach the .or() string: no filter injection
    const digits = q.q.replace(/\D/g, '');
    if (term) qb = qb.or([`order_id.ilike.%${term}%`, `customer_name.ilike.%${term}%`, ...(digits.length >= 4 ? [`customer_phone.like.%${digits}%`] : [])].join(','));
  }
  return qb;
}

export const adminList = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const qb = applyListFilters(supabase.from('orders').select(SELECT_ORDER_LIST, { count: 'exact' }), req.query)
    .order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const { data, count } = await run(qb);
  sendSuccess(res, { message: 'Orders retrieved', data: data.map(mapOrder), meta: pageMeta(page, limit, count ?? 0) });
});

async function findOrder(idOrOrderId) {
  const order = isUuid(idOrOrderId) ? await fetchOrderById(idOrOrderId) : await fetchOrderByOrderId(String(idOrOrderId).toUpperCase());
  if (!order) throw ApiError.notFound('Order not found');
  return order;
}

export const adminGet = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  const settings = await getSettings();
  sendSuccess(res, { data: { ...order, statusLabel: STATUS_LABELS[order.status], whatsappCustomerUrl: customerWhatsAppUrl(order, settings.brandName) } });
});

export const adminSetStatus = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  const from = order.status;
  const updated = await changeStatus(order, { status: req.body.status, note: req.body.note, by: req.admin.email });
  await audit(req, 'order.status', 'Order', order.id, { orderId: order.orderId, from, to: updated.status });
  sendSuccess(res, { message: `Order marked ${STATUS_LABELS[updated.status]}`, data: updated });
});

export const adminAddNote = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  await run(supabase.from('order_notes').insert({ order_id: order.id, note: req.body.note, by_actor: req.admin.email }));
  await audit(req, 'order.note', 'Order', order.id);
  sendSuccess(res, { message: 'Note added', data: (await fetchOrderById(order.id)).adminNotes });
});

export const adminCancel = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  const updated = await cancelOrder(order, { reason: req.body.reason, by: req.admin.email });
  await audit(req, 'order.cancel', 'Order', order.id, { orderId: order.orderId });
  sendSuccess(res, { message: 'Order cancelled and stock restored', data: updated });
});

export const adminSetPayment = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.id);
  const { paymentStatus, amountCollected } = req.body;
  if (amountCollected > order.total) throw ApiError.badRequest('Collected amount cannot exceed the order total', 'INVALID_AMOUNT');
  if (paymentStatus === 'unpaid' && amountCollected > 0) throw ApiError.badRequest('Unpaid orders cannot have a collected amount', 'INVALID_AMOUNT');
  const collected = paymentStatus === 'paid' ? order.total : paymentStatus === 'unpaid' ? 0 : amountCollected;
  await run(supabase.from('orders').update({ payment_status: paymentStatus, amount_collected: collected }).eq('id', order.id));
  await audit(req, 'order.payment', 'Order', order.id, { paymentStatus, amountCollected: collected });
  sendSuccess(res, { message: 'Payment record updated', data: await fetchOrderById(order.id) });
});

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

export const adminExport = asyncHandler(async (req, res) => {
  const qb = applyListFilters(supabase.from('orders').select(SELECT_ORDER), req.body).order('created_at', { ascending: false }).limit(5000);
  const orders = (await run(qb)).data.map(mapOrder);
  const header = ['Order ID', 'Date', 'Status', 'Payment', 'Customer', 'Phone', 'City', 'State', 'PIN', 'Items', 'Subtotal', 'Discount', 'Shipping', 'Total', 'Collected', 'Coupon', 'Notes'];
  const rows = orders.map((o) => [
    o.orderId, new Date(o.createdAt).toISOString(), STATUS_LABELS[o.status], o.paymentStatus, o.customer.name, o.customer.phone, o.address.city, o.address.state, o.address.pincode,
    o.items.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`).join('; '),
    o.subtotal, o.discount, o.shippingCharge, o.total, o.amountCollected, o.couponCode || '', o.customerNotes || '',
  ]);
  await audit(req, 'order.export', 'Order', undefined, { count: rows.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send(`\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}`);
});
