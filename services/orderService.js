import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { run } from '../utils/dbError.js';
import { generateOrderId } from '../utils/generateOrderId.js';
import { canTransition, STATUS_LABELS } from '../utils/orderStatus.js';
import { mapOrder, SELECT_ORDER } from '../utils/mappers.js';
import { buildQuote, publicQuote } from './pricingService.js';

/* ---------- reads ---------- */
async function fetchOrder(column, value) {
  const { data } = await run(supabase.from('orders').select(SELECT_ORDER).eq(column, value).maybeSingle());
  return data ? mapOrder(data) : null;
}
export const fetchOrderById = (id) => fetchOrder('id', id);
export const fetchOrderByOrderId = (orderId) => fetchOrder('order_id', orderId);
export const fetchOrderByKey = (key) => fetchOrder('idempotency_key', key);

/** Safe summary returned to the shopper who created the order. */
export function toOrderSummary(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    createdAt: order.createdAt,
    customer: { name: order.customer.name, phone: order.customer.phone },
    address: order.address,
    items: order.items.map((i) => ({ name: i.name, variantLabel: i.variantLabel, customizations: i.customizations, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, image: i.image })),
    subtotal: order.subtotal, discount: order.discount, shippingCharge: order.shippingCharge, total: order.total,
    couponCode: order.couponCode, customerNotes: order.customerNotes, giftMessage: order.giftMessage,
  };
}

/**
 * Creates an order. Everything that must be all-or-nothing (coupon use, order, items, stock reservation, history,
 * customer upsert) happens inside ONE Postgres transaction (create_order_tx). A repeated Idempotency-Key returns the original order.
 */
export async function createOrder(payload, idempotencyKey) {
  if (idempotencyKey) {
    const existing = await fetchOrderByKey(idempotencyKey);
    if (existing) return { order: existing, duplicate: true };
  }

  const quote = await buildQuote({ items: payload.items, couponCode: payload.couponCode, phone: payload.customer.phone, strictCoupon: true });
  if (quote.maintenance) throw new ApiError(503, 'MAINTENANCE', quote.maintenance);
  if (quote.issues.length) throw new ApiError(409, 'CART_INVALID', quote.issues[0].message, { issues: quote.issues, quote: publicQuote(quote) });
  if (payload.expectedTotal !== undefined && Math.abs(payload.expectedTotal - quote.total) > 0.001) {
    throw new ApiError(409, 'PRICE_CHANGED', 'Prices or offers have changed since you added these items. Please review the updated total.', { quote: publicQuote(quote) });
  }

  const items = quote.lines.map((l) => ({
    product_id: l.productId, variant_id: l.variantId, name: l.name, sku: l.sku, slug: l.slug, image: l.image, variant_label: l.variantLabel,
    customizations: l.customizations, quantity: l.quantity, mrp: l.mrp, unit_price: l.unitPrice, line_total: l.lineTotal, tracked: !l.untracked,
  }));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const order = {
      order_id: generateOrderId(), idempotency_key: idempotencyKey || null,
      customer_name: payload.customer.name, customer_phone: payload.customer.phone, customer_whatsapp: payload.customer.whatsapp || null, customer_email: payload.customer.email || null,
      address: payload.address, subtotal: quote.subtotal, discount: quote.discount, shipping_charge: quote.shippingCharge, total: quote.total,
      coupon_code: quote.coupon?.code || null, coupon_id: quote._couponDoc?.id || null,
      customer_notes: payload.customerNotes || null, gift_message: payload.giftMessage || null,
    };
    try {
      const { data: newId } = await run(supabase.rpc('create_order_tx', { p_order: order, p_items: items }));
      return { order: await fetchOrderById(newId), duplicate: false };
    } catch (err) {
      if (err.code === 'DUPLICATE_ORDER' && idempotencyKey) {          // concurrent double-submit: the other request won
        const existing = await fetchOrderByKey(idempotencyKey);
        if (existing) return { order: existing, duplicate: true };
      }
      if (err.code === 'DUPLICATE' && attempt < 2) continue;           // order reference collision: generate a new one
      throw err;
    }
  }
  throw new ApiError(500, 'ORDER_FAILED', 'Could not create the order. Please try again.');
}

export async function cancelOrder(order, { reason, by }) {
  await run(supabase.rpc('cancel_order_tx', { p_id: order.id, p_reason: reason, p_by: by }));
  return fetchOrderById(order.id);
}

export async function changeStatus(order, { status, note, by }) {
  if (status === 'cancelled') return cancelOrder(order, { reason: note || 'Cancelled by admin', by });
  if (!canTransition(order.status, status)) {
    throw ApiError.conflict(`Cannot move an order from "${STATUS_LABELS[order.status]}" to "${STATUS_LABELS[status]}"`, 'INVALID_TRANSITION');
  }
  await run(supabase.rpc('set_order_status_tx', { p_id: order.id, p_status: status, p_note: note || null, p_by: by }));
  return fetchOrderById(order.id);
}
