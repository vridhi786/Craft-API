import { supabase } from '../config/supabase.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { run } from '../utils/dbError.js';
import { crudFactory, pickColumns } from './crudFactory.js';
import { mapOffer, SELECT_OFFER } from '../utils/mappers.js';

const FIELDS = { title: 'title', description: 'description', image: 'image', startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active', couponCode: 'coupon_code' };

export const adminOffers = crudFactory({
  table: 'offers', label: 'Offer', select: SELECT_OFFER, map: mapOffer, fieldMap: FIELDS, searchCols: ['title'],
  toRow: (b) => pickColumns(b, FIELDS),
  links: [{ table: 'offer_products', owner: 'offer_id', other: 'product_id', key: 'products' }, { table: 'offer_categories', owner: 'offer_id', other: 'category_id', key: 'categories' }],
});

export const publicOffers = asyncHandler(async (_req, res) => {
  const now = new Date().toISOString();
  const { data } = await run(
    supabase.from('offers').select(SELECT_OFFER).eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('created_at', { ascending: false }).limit(20)
  );
  sendSuccess(res, { message: 'Offers retrieved', data: data.map(mapOffer) });
});
