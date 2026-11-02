import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { mapProduct, SELECT_PRODUCT } from '../utils/mappers.js';
import { adjustStock } from '../services/inventoryService.js';
import { uniqueSlug, resolveCategoryChain, listProducts, getProductBy, presentPublicProduct, presentAdminProduct } from '../services/productService.js';

const needId = (id) => { if (!isUuid(id)) throw ApiError.badRequest('Invalid product id', 'INVALID_ID'); };
const notAvailable = () => ApiError.notFound('This product is not available', 'PRODUCT_NOT_FOUND');

async function sendList(res, req, publicOnly, presenter) {
  const { items, total } = await listProducts(req.query, { publicOnly });
  sendSuccess(res, { message: 'Products retrieved successfully', data: items.map(presenter), meta: pageMeta(req.query.page, req.query.limit, total) });
}

/* ---------- public ---------- */
export const publicList = asyncHandler((req, res) => sendList(res, req, true, presentPublicProduct));
export const publicSearch = asyncHandler((req, res) => sendList(res, req, true, presentPublicProduct));
const flagged = (flag) => asyncHandler(async (req, res) => { req.query = { ...req.query, [flag]: true }; await sendList(res, req, true, presentPublicProduct); });
export const publicFeatured = flagged('featured');
export const publicBestsellers = flagged('bestseller');
export const publicNewArrivals = flagged('newArrival');

export const publicGetById = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const p = await getProductBy('id', req.params.id, { publicOnly: true });
  if (!p) throw notAvailable();
  sendSuccess(res, { message: 'Product retrieved successfully', data: presentPublicProduct(p) });
});

export const publicGetBySlug = asyncHandler(async (req, res) => {
  const p = await getProductBy('slug', req.params.slug.toLowerCase(), { publicOnly: true });
  if (!p) throw notAvailable();
  sendSuccess(res, { message: 'Product retrieved successfully', data: presentPublicProduct(p) });
});

export const publicRelated = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const p = await getProductBy('id', req.params.id, { publicOnly: true });
  if (!p) throw notAvailable();
  const same = p.subcategoryId ? `subcategory_id.eq.${p.subcategoryId},category_id.eq.${p.categoryId}` : `category_id.eq.${p.categoryId}`;
  const { data } = await run(
    supabase.from('products').select(SELECT_PRODUCT).neq('id', p.id).eq('is_active', true).eq('is_archived', false).or(same)
      .order('sold_count', { ascending: false }).order('created_at', { ascending: false }).limit(8)
  );
  sendSuccess(res, { data: data.map((r) => presentPublicProduct(mapProduct(r))) });
});

/* ---------- admin ---------- */
export const adminList = asyncHandler((req, res) => sendList(res, req, false, presentAdminProduct));

export const adminGet = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const p = await getProductBy('id', req.params.id);
  if (!p) throw ApiError.notFound('Product not found');
  sendSuccess(res, { data: presentAdminProduct(p) });
});

const FIELD_MAP = {
  name: 'name', shortDescription: 'short_description', description: 'description', specifications: 'specifications', images: 'images',
  price: 'price', discountPrice: 'discount_price', lowStockThreshold: 'low_stock_threshold', trackInventory: 'track_inventory', customFields: 'custom_fields',
  isFeatured: 'is_featured', isBestseller: 'is_bestseller', isNewArrival: 'is_new_arrival', keywords: 'keywords', seoTitle: 'seo_title',
  seoDescription: 'seo_description', shippingInfo: 'shipping_info', isActive: 'is_active',
};
const toRow = (b) => { const row = {}; for (const [k, col] of Object.entries(FIELD_MAP)) if (b[k] !== undefined) row[col] = b[k]; return row; };
const toVariantPayload = (variants) => variants.map((v) => ({
  id: v._id || null, label: v.label, sku: v.sku ?? null, price: v.price ?? null, discount_price: v.discountPrice ?? null,
  stock: v.stock ?? 0, low_stock_threshold: v.lowStockThreshold ?? null, is_active: v.isActive !== false,
}));

export const adminCreate = asyncHandler(async (req, res) => {
  const body = req.body;
  const chain = await resolveCategoryChain(body);
  const row = { ...toRow(body), ...chain, sku: body.sku.toUpperCase(), slug: body.slug || (await uniqueSlug('products', body.name)), stock: body.stock ?? 0 };
  const { data: created } = await run(supabase.from('products').insert(row).select('id').single());   // duplicate SKU/slug → 409 via constraint mapping
  if (body.variants?.length) {
    try { await run(supabase.rpc('sync_product_variants', { p_product: created.id, p_variants: toVariantPayload(body.variants.map(({ _id, ...v }) => v)) })); }
    catch (err) { await supabase.from('products').delete().eq('id', created.id); throw err; }   // don't leave a half-created product
  }
  await audit(req, 'product.create', 'Product', created.id, { sku: row.sku });
  sendSuccess(res, { status: 201, message: 'Product created', data: presentAdminProduct(await getProductBy('id', created.id)) });
});

export const adminUpdate = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const current = await getProductBy('id', req.params.id);
  if (!current) throw ApiError.notFound('Product not found');
  const { category, subcategory, childCategory, variants, slug, sku } = req.body;
  const row = toRow(req.body);       // `stock` is deliberately never updated here: stock changes go through the audited inventory RPC

  if (category !== undefined || subcategory !== undefined || childCategory !== undefined) {
    Object.assign(row, await resolveCategoryChain({
      category: category ?? current.categoryId,
      subcategory: subcategory === undefined ? current.subcategoryId : subcategory,
      childCategory: childCategory === undefined ? current.childCategoryId : childCategory,
    }));
  }
  if (slug && slug !== current.slug) row.slug = slug;
  if (sku && sku.toUpperCase() !== current.sku) row.sku = sku.toUpperCase();

  if (Object.keys(row).length) await run(supabase.from('products').update(row).eq('id', current.id));
  if (variants) await run(supabase.rpc('sync_product_variants', { p_product: current.id, p_variants: toVariantPayload(variants) }));
  await audit(req, 'product.update', 'Product', current.id);
  sendSuccess(res, { message: 'Product updated', data: presentAdminProduct(await getProductBy('id', current.id)) });
});

export const adminSetStatus = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const { data } = await run(supabase.from('products').update({ is_active: req.body.isActive }).eq('id', req.params.id).select('id, is_active').maybeSingle());
  if (!data) throw ApiError.notFound('Product not found');
  await audit(req, req.body.isActive ? 'product.activate' : 'product.deactivate', 'Product', data.id);
  sendSuccess(res, { message: req.body.isActive ? 'Product activated' : 'Product deactivated', data: { id: data.id, isActive: data.is_active } });
});

export const adminSetStock = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const result = await adjustStock({ productId: req.params.id, variantId: req.body.variantId, delta: req.body.delta, stock: req.body.stock, reason: req.body.reason, adminEmail: req.admin.email });
  await audit(req, 'product.stock', 'Product', req.params.id, { from: result.previousStock, to: result.newStock, reason: req.body.reason });
  sendSuccess(res, { message: 'Stock updated', data: result });
});

/** DELETE archives (soft delete) so historical orders stay intact. ?permanent=true is super-admin only and refused if ordered. */
export const adminDelete = asyncHandler(async (req, res) => {
  needId(req.params.id);
  const product = await getProductBy('id', req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (req.query.permanent === 'true') {
    if (req.admin.role !== 'super_admin') throw ApiError.forbidden('Only a super admin can permanently delete products');
    const { count } = await run(supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id));
    if (count) throw ApiError.conflict('This product appears in past orders. Archive it instead.', 'HAS_ORDERS');
    await run(supabase.from('products').delete().eq('id', product.id));
    await audit(req, 'product.delete', 'Product', product.id);
    return sendSuccess(res, { message: 'Product permanently deleted' });
  }
  await run(supabase.from('products').update({ is_archived: true, is_active: false }).eq('id', product.id));
  await audit(req, 'product.archive', 'Product', product.id);
  return sendSuccess(res, { message: 'Product archived' });
});
