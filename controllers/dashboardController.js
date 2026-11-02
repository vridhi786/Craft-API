import { supabase } from '../config/supabase.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { run } from '../utils/dbError.js';
import { mapAudit } from '../utils/mappers.js';
import { listInventory } from '../services/inventoryService.js';

export const stats = asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - days * 86_400_000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  const [{ data: s }, inventory, { data: recent }, { data: activity }] = await Promise.all([
    run(supabase.rpc('dashboard_stats', { p_from: from.toISOString(), p_to: to.toISOString() })),   // all counts/sums computed inside Postgres
    listInventory(),
    run(supabase.from('orders').select('id, order_id, customer_name, total, status, created_at').order('created_at', { ascending: false }).limit(6)),
    run(supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(8)),
  ]);
  const c = s.byStatus || {};
  const inProgress = ['confirmed', 'processing', 'ready_to_ship', 'shipped', 'out_for_delivery'].reduce((sum, k) => sum + (c[k] || 0), 0);
  const gross = Number(s.period.gross);
  const collected = Number(s.period.collected);

  sendSuccess(res, {
    data: {
      period: { from, to },
      orders: {
        total: Object.values(c).reduce((a, b) => a + b, 0), pending: c.pending_confirmation || 0, confirmed: c.confirmed || 0,
        inProgress, completed: c.delivered || 0, cancelled: c.cancelled || 0,
      },
      // Gross order value = non-cancelled orders placed in the period (NOT money received).
      // Collected = amounts an admin has recorded as received. There is no payment gateway in this version.
      revenue: { ordersInPeriod: s.period.orders, grossOrderValue: gross, collected, outstanding: Math.max(0, gross - collected) },
      products: { total: s.products.total, active: s.products.active, lowStock: s.products.low, outOfStock: s.products.out },
      customers: s.customers,
      lowStockItems: inventory.filter((r) => r.status !== 'in_stock').slice(0, 8),
      recentOrders: recent.map((o) => ({ _id: o.id, id: o.id, orderId: o.order_id, customer: { name: o.customer_name }, total: Number(o.total), status: o.status, createdAt: o.created_at })),
      recentActivity: activity.map(mapAudit),
    },
  });
});
