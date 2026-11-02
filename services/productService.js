import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { run } from '../utils/dbError.js';
import { escapeLike } from '../utils/regex.js';
import { slugify } from '../utils/slugify.js';
import { isUuid } from '../utils/ids.js';
import { mapProduct, mapCategory, SELECT_PRODUCT } from '../utils/mappers.js';
import { unitPrice, productAvailability, variantAvailability, hasActiveVariants, availableStock } from '../utils/pricing.js';

const catView = (c) => (c && c.name ? { id: c.id, name: c.name, slug: c.slug } : null);

/** Finds a slug not yet used in `table` (adds -2, -3 … when needed). One query, no loop of round-trips. */
export async function uniqueSlug(table, base, excludeId) {
  const root = slugify(base) || 'item';
  let q = supabase.from(table).select('slug').like('slug', `${escapeLike(root)}%`).limit(500);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await run(q);
  const taken = new Set(data.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i += 1) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now()}`;
}

/** Validates the Category → Subcategory → Child chain. Returns normalised ids (null for unused levels). */
export async function resolveCategoryChain({ category, subcategory, childCategory }) {
  const find = async (id, level, parent) => {
    let q = supabase.from('categories').select('id').eq('id', id).eq('level', level).eq('is_archived', false);
    if (parent) q = q.eq('parent_id', parent);
    return (await run(q.maybeSingle())).data;
  };
  const cat = await find(category, 1);
  if (!cat) throw ApiError.badRequest('Selected category does not exist', 'INVALID_CATEGORY');
  let sub = null;
  let child = null;
  if (subcategory) {
    sub = await find(subcategory, 2, cat.id);
    if (!sub) throw ApiError.badRequest('Subcategory does not belong to the selected category', 'INVALID_SUBCATEGORY');
  }
  if (childCategory) {
    if (!sub) throw ApiError.badRequest('Choose a subcategory before choosing a child category', 'INVALID_CHILD_CATEGORY');
    child = await find(childCategory, 3, sub.id);
    if (!child) throw ApiError.badRequest('Child category does not belong to the selected subcategory', 'INVALID_CHILD_CATEGORY');
  }
  return { category_id: cat.id, subcategory_id: sub?.id ?? null, child_category_id: child?.id ?? null };
}

export function presentVariant(product, v) {
  const p = unitPrice(product, v);
  return {
    id: v.id, label: v.label, price: p.price, mrp: p.discountPercent > 0 ? p.mrp : null, discountPercent: p.discountPercent,
    availability: variantAvailability(product, v), maxQuantity: Math.min(20, availableStock(product, v)), isActive: v.isActive,
  };
}

/** Public/shopper-safe representation: never exposes exact stock counts or internal flags. */
export function presentPublicProduct(p) {
  const activeVariants = hasActiveVariants(p) ? p.variants.filter((v) => v.isActive !== false) : [];
  const base = unitPrice(p);
  const variantViews = activeVariants.map((v) => presentVariant(p, v));
  const priceFrom = variantViews.length ? Math.min(...variantViews.map((v) => v.price)) : base.price;
  const hasDiscount = !variantViews.length && base.discountPercent > 0;
  return {
    id: p.id, name: p.name, slug: p.slug, sku: p.sku, shortDescription: p.shortDescription, description: p.description,
    specifications: p.specifications || [],
    images: (p.images || []).map((i) => ({ url: i.url, alt: i.alt || p.name })),
    price: variantViews.length ? priceFrom : base.price,
    mrp: hasDiscount ? base.mrp : null,
    discountPercent: hasDiscount ? base.discountPercent : 0,
    hasVariantPricing: variantViews.length > 0 && new Set(variantViews.map((v) => v.price)).size > 1,
    availability: productAvailability(p),
    maxQuantity: variantViews.length ? 20 : Math.min(20, availableStock(p)),
    variants: variantViews,
    customFields: p.customFields || [],
    category: catView(p.category), subcategory: catView(p.subcategory), childCategory: catView(p.childCategory),
    isFeatured: p.isFeatured, isBestseller: p.isBestseller, isNewArrival: p.isNewArrival,
    shippingInfo: p.shippingInfo, seoTitle: p.seoTitle, seoDescription: p.seoDescription, createdAt: p.createdAt,
  };
}

export function presentAdminProduct(p) {
  const short = (c) => (c && c.name ? { id: c.id, name: c.name } : c);
  return { ...p, availability: productAvailability(p), effectivePrice: unitPrice(p).price, category: short(p.category), subcategory: short(p.subcategory), childCategory: short(p.childCategory) };
}

const SORTS = {
  newest: [['created_at', false]],
  oldest: [['created_at', true]],
  price_asc: [['min_price', true], ['id', true]],
  price_desc: [['min_price', false], ['id', true]],
  popular: [['sold_count', false], ['created_at', false]],
  name: [['name', true]],
};

/** Resolves a category id/slug to a mapped category (public callers only see active, non-archived ones). */
export async function findCategoryByIdOrSlug(idOrSlug, { publicOnly = true } = {}) {
  let q = supabase.from('categories').select('*');
  q = isUuid(idOrSlug) ? q.eq('id', idOrSlug) : q.eq('slug', String(idOrSlug).toLowerCase());
  if (publicOnly) q = q.eq('is_active', true).eq('is_archived', false);
  const { data } = await run(q.maybeSingle());
  return data ? mapCategory(data) : null;
}

// NOTE: must stay synchronous – supabase-js query builders are thenables, so returning one from an async function would execute it early.
function applyFilters(qb, q, { publicOnly, categoryId }) {
  if (publicOnly) qb = qb.eq('is_active', true).eq('is_archived', false);
  else {
    const status = q.status || 'all';
    if (status === 'active') qb = qb.eq('is_active', true).eq('is_archived', false);
    else if (status === 'inactive') qb = qb.eq('is_active', false).eq('is_archived', false);
    else if (status === 'archived') qb = qb.eq('is_archived', true);
    else qb = qb.eq('is_archived', false);
  }
  if (categoryId) qb = qb.or(`category_id.eq.${categoryId},subcategory_id.eq.${categoryId},child_category_id.eq.${categoryId}`); // DB-sourced UUID
  if (q.q) qb = qb.ilike('search_text', `%${escapeLike(q.q.trim().toLowerCase())}%`);
  if (q.ids) {
    const ids = q.ids.split(',').map((s) => s.trim()).filter(isUuid).slice(0, 50);
    qb = qb.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  if (q.minPrice !== undefined) qb = qb.gte('min_price', q.minPrice);
  if (q.maxPrice !== undefined) qb = qb.lte('min_price', q.maxPrice);
  if (q.inStock) qb = qb.neq('stock_status', 'out_of_stock');
  if (q.featured) qb = qb.eq('is_featured', true);
  if (q.bestseller) qb = qb.eq('is_bestseller', true);
  if (q.newArrival) qb = qb.eq('is_new_arrival', true);
  if (!publicOnly && q.stockLevel) qb = qb.eq('track_inventory', true).eq('stock_status', q.stockLevel === 'out' ? 'out_of_stock' : 'low_stock');
  return qb;
}

export async function listProducts(q, { publicOnly = true } = {}) {
  let categoryId;
  if (q.category) {
    const cat = await findCategoryByIdOrSlug(q.category, { publicOnly });
    if (!cat) return { items: [], total: 0 };
    categoryId = cat.id;
  }
  let qb = applyFilters(supabase.from('products').select(SELECT_PRODUCT, { count: 'exact' }), q, { publicOnly, categoryId });
  for (const [col, asc] of SORTS[q.sort] || SORTS.newest) qb = qb.order(col, { ascending: asc });
  const from = (q.page - 1) * q.limit;
  const { data, count } = await run(qb.range(from, from + q.limit - 1));
  return { items: data.map(mapProduct), total: count ?? 0 };
}

export async function getProductBy(column, value, { publicOnly = false } = {}) {
  let q = supabase.from('products').select(SELECT_PRODUCT).eq(column, value);
  if (publicOnly) q = q.eq('is_active', true).eq('is_archived', false);
  const { data } = await run(q.maybeSingle());
  return data ? mapProduct(data) : null;
}
