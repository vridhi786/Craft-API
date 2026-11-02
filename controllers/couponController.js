import { sendSuccess } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { crudFactory, pickColumns } from './crudFactory.js';
import { mapCoupon, SELECT_COUPON } from '../utils/mappers.js';
import { buildQuote, publicQuote } from '../services/pricingService.js';

const FIELDS = { code: 'code', description: 'description', type: 'type', value: 'value', minCartAmount: 'min_cart_amount', maxDiscount: 'max_discount', startsAt: 'starts_at', expiresAt: 'expires_at', usageLimit: 'usage_limit', perCustomerLimit: 'per_customer_limit', isActive: 'is_active' };

export const adminCoupons = crudFactory({
  table: 'coupons', label: 'Coupon', select: SELECT_COUPON, map: mapCoupon, fieldMap: FIELDS, searchCols: ['code', 'description'],
  toRow: (b) => pickColumns(b, FIELDS),
  links: [{ table: 'coupon_products', owner: 'coupon_id', other: 'product_id', key: 'products' }, { table: 'coupon_categories', owner: 'coupon_id', other: 'category_id', key: 'categories' }],
});

/** Public: validates a coupon against a server-priced cart and returns the discount it would give. */
export const validateCouponPublic = asyncHandler(async (req, res) => {
  const { code, items, phone } = req.body;
  const quote = await buildQuote({ items, couponCode: code, phone: phone || undefined, strictCoupon: true });
  const q = publicQuote(quote);
  sendSuccess(res, { message: 'Coupon applied', data: { coupon: q.coupon, discount: q.discount, subtotal: q.subtotal, shippingCharge: q.shippingCharge, total: q.total } });
});
