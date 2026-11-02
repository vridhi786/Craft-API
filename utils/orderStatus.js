export const ORDER_STATUSES = [
  'pending_confirmation', 'confirmed', 'processing', 'ready_to_ship', 'shipped', 'out_for_delivery', 'delivered', 'cancelled',
];

export const STATUS_LABELS = {
  pending_confirmation: 'Pending Confirmation',
  confirmed: 'Confirmed',
  processing: 'Processing',
  ready_to_ship: 'Ready to Ship',
  shipped: 'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const TRANSITIONS = {
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['ready_to_ship', 'cancelled'],
  ready_to_ship: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
export const isCancellable = (status) => canTransition(status, 'cancelled');
