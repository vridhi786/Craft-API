import { supabase } from '../config/supabase.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { mapAdjustment } from '../utils/mappers.js';
import { adjustStock, listInventory } from '../services/inventoryService.js';

export const list = asyncHandler(async (req, res) => {
  const level = ['low', 'out'].includes(req.query.level) ? req.query.level : undefined;
  sendSuccess(res, { message: 'Inventory retrieved', data: await listInventory({ level }) });
});

export const adjust = asyncHandler(async (req, res) => {
  const { productId, variantId, delta, stock, reason } = req.body;
  const result = await adjustStock({ productId, variantId, delta, stock, reason, adminEmail: req.admin.email });
  await audit(req, 'inventory.adjust', 'Product', productId, { from: result.previousStock, to: result.newStock, reason });
  sendSuccess(res, { message: 'Stock updated', data: result });
});

export const history = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  let q = supabase.from('inventory_adjustments').select('*', { count: 'exact' });
  if (isUuid(req.query.productId)) q = q.eq('product_id', req.query.productId);
  const { data, count } = await run(q.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1));
  sendSuccess(res, { data: data.map(mapAdjustment), meta: pageMeta(page, limit, count ?? 0) });
});
