import { supabase } from '../config/supabase.js';
import { deleteImage } from '../config/cloud-storage.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { safeFilterTerm } from '../utils/regex.js';
import { mapCategory } from '../utils/mappers.js';
import { uniqueSlug, findCategoryByIdOrSlug, listProducts, presentPublicProduct } from '../services/productService.js';
import { pageMeta } from '../utils/ApiResponse.js';

const present = (c, extra = {}) => ({
  id: c.id, name: c.name, slug: c.slug, description: c.description, image: c.image?.url ? { url: c.image.url, alt: c.image.alt || c.name } : null,
  level: c.level, parent: c.parent, displayOrder: c.displayOrder, isActive: c.isActive, isArchived: c.isArchived,
  seoTitle: c.seoTitle, seoDescription: c.seoDescription, ...extra,
});

async function productCounts(publicOnly) {
  const { data } = await run(supabase.rpc('category_product_counts', { p_public: publicOnly }));
  return new Map(data.map((r) => [r.category_id, Number(r.n)]));
}

/** Public: nested tree of active categories. */
export const publicTree = asyncHandler(async (_req, res) => {
  const [{ data }, counts] = await Promise.all([
    run(supabase.from('categories').select('*').eq('is_active', true).eq('is_archived', false).order('display_order').order('name')),
    productCounts(true),
  ]);
  const nodes = new Map(data.map((r) => { const c = mapCategory(r); return [c.id, { ...present(c, { productCount: counts.get(c.id) || 0 }), children: [] }]; }));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent ? nodes.get(node.parent) : null;
    if (parent) parent.children.push(node);
    else if (!node.parent) roots.push(node);
  }
  res.set('Cache-Control', 'public, max-age=60');
  sendSuccess(res, { message: 'Categories retrieved', data: roots });
});

export const publicGet = asyncHandler(async (req, res) => {
  const cat = await findCategoryByIdOrSlug(req.params.id);
  if (!cat) throw ApiError.notFound('Category not found');
  const { data: kids } = await run(supabase.from('categories').select('*').eq('parent_id', cat.id).eq('is_active', true).eq('is_archived', false).order('display_order').order('name'));
  const breadcrumb = [];
  let cur = cat;
  while (cur.parent) {
    const { data } = await run(supabase.from('categories').select('*').eq('id', cur.parent).maybeSingle());
    if (!data) break;
    cur = mapCategory(data);
    breadcrumb.unshift({ id: cur.id, name: cur.name, slug: cur.slug });
  }
  sendSuccess(res, { data: { ...present(cat), children: kids.map((k) => present(mapCategory(k))), breadcrumb } });
});

export const publicProducts = asyncHandler(async (req, res) => {
  const cat = await findCategoryByIdOrSlug(req.params.slug);
  if (!cat) throw ApiError.notFound('Category not found');
  const { items, total } = await listProducts({ ...req.query, category: cat.id });
  sendSuccess(res, { message: 'Products retrieved', data: items.map(presentPublicProduct), meta: pageMeta(req.query.page, req.query.limit, total) });
});

/** Admin: flat list with counts. `forcedLevel` is set by the subcategory / child-category routers. */
export const adminList = (forcedLevel) =>
  asyncHandler(async (req, res) => {
    const level = forcedLevel || (req.query.level ? parseInt(req.query.level, 10) : null);
    let q = supabase.from('categories').select('*').order('level').order('display_order').order('name');
    if (level) q = q.eq('level', level);
    if (isUuid(req.query.parent)) q = q.eq('parent_id', req.query.parent);
    if (req.query.archived !== 'true') q = q.eq('is_archived', false);
    const term = req.query.q ? safeFilterTerm(req.query.q) : '';
    if (term) q = q.ilike('name', `%${term}%`);
    const [{ data }, counts, { data: kids }] = await Promise.all([
      run(q), productCounts(false),
      run(supabase.from('categories').select('parent_id').eq('is_archived', false).not('parent_id', 'is', null)),
    ]);
    const childCounts = new Map();
    kids.forEach((k) => childCounts.set(k.parent_id, (childCounts.get(k.parent_id) || 0) + 1));
    // Parent names via a second query (avoids PostgREST self-relationship embedding ambiguity).
    const parentIds = [...new Set(data.map((r) => r.parent_id).filter(Boolean))];
    const parents = new Map();
    if (parentIds.length) (await run(supabase.from('categories').select('id,name,level').in('id', parentIds))).data.forEach((p) => parents.set(p.id, p));
    sendSuccess(res, {
      message: 'Categories retrieved',
      data: data.map((r) => present(mapCategory(r), {
        parent: parents.has(r.parent_id) ? { id: r.parent_id, name: parents.get(r.parent_id).name, level: parents.get(r.parent_id).level } : null,
        productCount: counts.get(r.id) || 0, childCount: childCounts.get(r.id) || 0,
      })),
    });
  });

export const adminGet = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
  const { data } = await run(supabase.from('categories').select('*').eq('id', req.params.id).maybeSingle());
  if (!data) throw ApiError.notFound('Category not found');
  sendSuccess(res, { data: present(mapCategory(data)) });
});

async function resolveParent(parentId, forcedLevel) {
  if (!parentId) {
    if (forcedLevel && forcedLevel > 1) throw ApiError.badRequest(forcedLevel === 2 ? 'A subcategory needs a parent category' : 'A child category needs a parent subcategory', 'PARENT_REQUIRED');
    return { parent_id: null, level: 1 };
  }
  const { data: parent } = await run(supabase.from('categories').select('id, level').eq('id', parentId).eq('is_archived', false).maybeSingle());
  if (!parent) throw ApiError.badRequest('Parent category not found', 'INVALID_PARENT');
  if (parent.level >= 3) throw ApiError.badRequest('Categories can be nested at most three levels deep', 'MAX_DEPTH');
  const level = parent.level + 1;
  if (forcedLevel && forcedLevel !== level) throw ApiError.badRequest(`Parent must be a level-${forcedLevel - 1} item`, 'INVALID_PARENT_LEVEL');
  return { parent_id: parent.id, level };
}

const toRow = (b) => {
  const row = {};
  const map = { name: 'name', description: 'description', displayOrder: 'display_order', isActive: 'is_active', seoTitle: 'seo_title', seoDescription: 'seo_description' };
  for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) row[col] = b[k];
  return row;
};

export const adminCreate = (forcedLevel) =>
  asyncHandler(async (req, res) => {
    const { slug, parent: parentId, image } = req.body;
    const parent = await resolveParent(parentId, forcedLevel);
    const row = { ...toRow(req.body), ...parent, slug: slug || (await uniqueSlug('categories', req.body.name)), ...(image ? { image } : {}) };
    const { data } = await run(supabase.from('categories').insert(row).select('*').single());   // duplicate name/slug → 409 via constraint mapping
    await audit(req, 'category.create', 'Category', data.id, { level: data.level });
    sendSuccess(res, { status: 201, message: 'Category created', data: present(mapCategory(data)) });
  });

const countDependents = async (id) => {
  const [kids, prods] = await Promise.all([
    run(supabase.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id)),
    run(supabase.from('products').select('id', { count: 'exact', head: true }).or(`category_id.eq.${id},subcategory_id.eq.${id},child_category_id.eq.${id}`)),
  ]);
  return { childCount: kids.count ?? 0, productCount: prods.count ?? 0 };
};

export const adminUpdate = (forcedLevel) =>
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
    const { data: current } = await run(supabase.from('categories').select('*').eq('id', req.params.id).maybeSingle());
    if (!current || (forcedLevel && current.level !== forcedLevel)) throw ApiError.notFound('Category not found');
    const { slug, parent: parentId, image } = req.body;
    const row = toRow(req.body);

    if (parentId !== undefined && String(parentId || '') !== String(current.parent_id || '')) {
      const dep = await countDependents(current.id);
      if (dep.childCount || dep.productCount) throw ApiError.conflict('Move or reassign its subcategories and products before changing the parent', 'HAS_DEPENDENTS');
      if (parentId === current.id) throw ApiError.badRequest('A category cannot be its own parent', 'INVALID_PARENT');
      Object.assign(row, await resolveParent(parentId, current.level === 1 && !parentId ? 1 : forcedLevel));
    }
    if (slug && slug !== current.slug) row.slug = slug;
    if (image === null) { await deleteImage(current.image?.publicId); row.image = null; }
    else if (image) row.image = image;

    const { data } = await run(supabase.from('categories').update(row).eq('id', current.id).select('*').single());
    await audit(req, 'category.update', 'Category', current.id);
    sendSuccess(res, { message: 'Category updated', data: present(mapCategory(data)) });
  });

/** Deleting a category that still has subcategories or products requires an explicit choice: archive, or reassign. */
export const adminDelete = (forcedLevel) =>
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID');
    const { data: doc } = await run(supabase.from('categories').select('*').eq('id', req.params.id).maybeSingle());
    if (!doc || (forcedLevel && doc.level !== forcedLevel)) throw ApiError.notFound('Category not found');
    const { childCount, productCount } = await countDependents(doc.id);
    const { archive, reassignTo } = req.query;

    if (childCount === 0 && productCount === 0) {
      await run(supabase.from('categories').delete().eq('id', doc.id));
      await deleteImage(doc.image?.publicId);
      await audit(req, 'category.delete', 'Category', doc.id);
      return sendSuccess(res, { message: 'Category deleted' });
    }

    if (archive === 'true') {
      const { data: n } = await run(supabase.rpc('archive_category_tree', { p_id: doc.id }));
      await audit(req, 'category.archive', 'Category', doc.id, { affected: n });
      return sendSuccess(res, { message: `Archived ${n} categor${n === 1 ? 'y' : 'ies'}. Products stay in the catalogue.` });
    }

    if (reassignTo) {
      const { data: moved } = await run(supabase.rpc('reassign_category_tx', { p_from: doc.id, p_to: reassignTo })); // atomic; validates level/target
      await deleteImage(doc.image?.publicId);
      await audit(req, 'category.reassign_delete', 'Category', doc.id, { to: reassignTo, ...moved });
      return sendSuccess(res, { message: `Moved ${moved.children} subcategories and ${moved.products} products, then deleted.` });
    }

    throw ApiError.conflict(
      `"${doc.name}" contains ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'} and ${productCount} product${productCount === 1 ? '' : 's'}. Archive it, or reassign its contents to another category.`,
      'HAS_DEPENDENTS',
      { childCount, productCount, options: ['archive=true', 'reassignTo=<categoryId>'] }
    );
  });
