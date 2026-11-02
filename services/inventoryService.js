import { supabase } from '../config/supabase.js';
import { run } from '../utils/dbError.js';

/** Manual stock change (relative `delta` or absolute `stock`) with history. One atomic Postgres function: no lost updates, never negative. */
export async function adjustStock({ productId, variantId, delta, stock, reason, adminEmail }) {
  const { data } = await run(supabase.rpc('adjust_stock_tx', {
    p_product: productId, p_variant: variantId ?? null, p_delta: delta ?? null, p_set: stock ?? null, p_reason: reason, p_admin: adminEmail ?? null,
  }));
  return { previousStock: data.previous, newStock: data.new };
}

/** Flat inventory rows (product- or variant-level) with status, from the `inventory_view` view. */
export async function listInventory({ level } = {}) {
  let q = supabase.from('inventory_view').select('*').order('stock', { ascending: true }).limit(2000);
  if (level) q = q.eq('status', level === 'low' ? 'low_stock' : 'out_of_stock');
  const { data } = await run(q);
  return data.map((r) => ({
    productId: r.product_id, variantId: r.variant_id || undefined, name: r.name, variant: r.variant || undefined, sku: r.sku,
    stock: r.stock, threshold: r.threshold, status: r.status, isActive: r.is_active,
  }));
}
