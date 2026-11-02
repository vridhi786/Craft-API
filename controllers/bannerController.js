import { supabase } from '../config/supabase.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { run } from '../utils/dbError.js';
import { crudFactory, pickColumns } from './crudFactory.js';
import { mapBanner, SELECT_BANNER } from '../utils/mappers.js';

const FIELDS = { title: 'title', description: 'description', image: 'image', mobileImage: 'mobile_image', ctaLabel: 'cta_label', linkUrl: 'link_url', product: 'product_id', category: 'category_id', displayOrder: 'display_order', startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active' };

export const adminBanners = crudFactory({
  table: 'banners', label: 'Banner', select: SELECT_BANNER, map: mapBanner, fieldMap: FIELDS, searchCols: ['title'],
  order: [['display_order', true], ['created_at', false]],
  toRow: (b) => pickColumns(b, FIELDS),
});

export const publicBanners = asyncHandler(async (_req, res) => {
  const now = new Date().toISOString();
  const { data } = await run(
    supabase.from('banners').select(SELECT_BANNER).eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('display_order', { ascending: true }).order('created_at', { ascending: false }).limit(10)
  );
  sendSuccess(res, { message: 'Banners retrieved', data: data.map(mapBanner) });
});
