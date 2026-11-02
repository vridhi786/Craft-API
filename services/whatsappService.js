import { STATUS_LABELS } from '../utils/orderStatus.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** wa.me link. `number` must be international digits only (e.g. 919876543210). */
export function buildWhatsAppUrl(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Message an admin sends to the customer from the order screen (status update / confirmation). */
export function buildCustomerUpdateMessage(order, brandName = 'The Crafters Workshop') {
  const lines = [
    `Hello ${order.customer.name}, this is ${brandName}.`,
    '',
    `Your order ${order.orderId} is now: ${STATUS_LABELS[order.status] || order.status}.`,
    `Order total: ${inr(order.total)}`,
  ];
  if (order.status === 'confirmed') lines.push('', 'Please reply here if you would like to change anything.');
  lines.push('', 'Thank you for shopping with us!');
  return lines.join('\n');
}

export function customerWhatsAppUrl(order, brandName) {
  const number = order.customer.whatsapp || order.customer.phone;
  const digits = String(number).replace(/\D/g, '');
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return buildWhatsAppUrl(intl, buildCustomerUpdateMessage(order, brandName));
}
