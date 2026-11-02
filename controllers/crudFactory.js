import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess, pageMeta } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { run } from '../utils/dbError.js';
import { isUuid } from '../utils/ids.js';
import { safeFilterTerm } from '../utils/regex.js';

/** Copies the listed API keys (camelCase) to DB columns (snake_case), skipping keys that were not sent (partial updates). */
export const pickColumns = (body, fieldMap) => {
  const row = {};
  for (const [key, col] of Object.entries(fieldMap)) if (body[key] !== undefined) row[col] = body[key];
  return row;
};

/**
 * Generic admin CRUD over one table (+ optional many-to-many link tables), used by coupons, offers and banners.
 * spec: { table, label, select, map, fieldMap, links?: [{table, owner, other, key}], searchCols?, order? }
 */
export function crudFactory(spec) {
  const { table, label, select, map, fieldMap, links = [], searchCols = [], order = [['created_at', false]] } = spec;
  const need = (id) => { if (!isUuid(id)) throw ApiError.badRequest('Invalid id', 'INVALID_ID'); };

  const load = async (id) => {
    const { data } = await run(supabase.from(table).select(select).eq('id', id).maybeSingle());
    if (!data) throw ApiError.notFound(`${label} not found`);
    return map(data);
  };
  const replaceLinks = async (id, body) => {
    for (const l of links) {
      if (body[l.key] === undefined) continue;
      await run(supabase.from(l.table).delete().eq(l.owner, id));
      const ids = [...new Set(body[l.key])];
      if (ids.length) await run(supabase.from(l.table).insert(ids.map((other) => ({ [l.owner]: id, [l.other]: other }))));
    }
  };

  return {
    list: asyncHandler(async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      let q = supabase.from(table).select(select, { count: 'exact' });
      const term = req.query.q ? safeFilterTerm(req.query.q) : '';
      if (term && searchCols.length) q = q.or(searchCols.map((c) => `${c}.ilike.%${term}%`).join(','));
      if (req.query.active === 'true' || req.query.active === 'false') q = q.eq('is_active', req.query.active === 'true');
      for (const [col, asc] of order) q = q.order(col, { ascending: asc });
      const { data, count } = await run(q.range((page - 1) * limit, page * limit - 1));
      sendSuccess(res, { message: `${label}s retrieved`, data: data.map(map), meta: pageMeta(page, limit, count ?? 0) });
    }),
    get: asyncHandler(async (req, res) => { need(req.params.id); sendSuccess(res, { data: await load(req.params.id) }); }),
    create: asyncHandler(async (req, res) => {
      const { data: row } = await run(supabase.from(table).insert(spec.toRow(req.body)).select('id').single());
      try { await replaceLinks(row.id, req.body); } catch (err) { await supabase.from(table).delete().eq('id', row.id); throw err; }
      await audit(req, `${label.toLowerCase()}.create`, label, row.id);
      sendSuccess(res, { status: 201, message: `${label} created`, data: await load(row.id) });
    }),
    update: asyncHandler(async (req, res) => {
      need(req.params.id);
      const row = spec.toRow(req.body);
      if (Object.keys(row).length) {
        const { data } = await run(supabase.from(table).update(row).eq('id', req.params.id).select('id').maybeSingle());
        if (!data) throw ApiError.notFound(`${label} not found`);
      } else await load(req.params.id);
      await replaceLinks(req.params.id, req.body);
      await audit(req, `${label.toLowerCase()}.update`, label, req.params.id);
      sendSuccess(res, { message: `${label} updated`, data: await load(req.params.id) });
    }),
    remove: asyncHandler(async (req, res) => {
      need(req.params.id);
      const { data } = await run(supabase.from(table).delete().eq('id', req.params.id).select('id').maybeSingle());
      if (!data) throw ApiError.notFound(`${label} not found`);
      await audit(req, `${label.toLowerCase()}.delete`, label, req.params.id);
      sendSuccess(res, { message: `${label} deleted` });
    }),
  };
}
