import { supabase } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { run } from '../utils/dbError.js';
import { calculateCouponDiscount } from '../utils/couponMath.js';
import { fromPaise } from '../utils/money.js';
import { mapCoupon, SELECT_COUPON } from '../utils/mappers.js';

const fail = (message, code = 'COUPON_INVALID') => new ApiError(400, code, message);

/**
 * Validates a coupon against the server-calculated cart. `lines` are priced lines from pricingService (each with
 * lineTotal and _categoryIds). Returns {coupon, discountPaise}; throws ApiError for any rule violation.
 * (The usage counter itself is incremented atomically inside create_order_tx.)
 */
export async function validateCoupon({ code, lines, subtotalPaise, phone, now = new Date() }) {
  const { data } = await run(supabase.from('coupons').select(SELECT_COUPON).eq('code', String(code).trim().toUpperCase()).maybeSingle());
  const coupon = data ? mapCoupon(data) : null;
  if (!coupon || !coupon.isActive) throw fail('This coupon code is not valid');
  if (coupon.startsAt && new Date(coupon.startsAt) > now) throw fail('This coupon is not active yet', 'COUPON_NOT_STARTED');
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) throw fail('This coupon has expired', 'COUPON_EXPIRED');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw fail('This coupon has reached its usage limit', 'COUPON_EXHAUSTED');
  if (coupon.minCartAmount && subtotalPaise < Math.round(coupon.minCartAmount * 100)) {
    throw fail(`Add items worth ₹${fromPaise(Math.round(coupon.minCartAmount * 100) - subtotalPaise)} more to use this coupon`, 'COUPON_MIN_CART');
  }
  if (coupon.perCustomerLimit && phone) {
    const { count } = await run(supabase.from('orders').select('id', { count: 'exact', head: true }).eq('coupon_code', coupon.code).eq('customer_phone', phone).neq('status', 'cancelled'));
    if ((count ?? 0) >= coupon.perCustomerLimit) throw fail('You have already used this coupon the maximum number of times', 'COUPON_CUSTOMER_LIMIT');
  }

  const restricted = coupon.products.length > 0 || coupon.categories.length > 0;
  const productSet = new Set(coupon.products);
  const categorySet = new Set(coupon.categories);
  const eligiblePaise = lines.reduce((sum, l) => {
    const ok = !restricted || productSet.has(l.productId) || (l._categoryIds || []).some((c) => categorySet.has(c));
    return ok ? sum + Math.round(l.lineTotal * 100) : sum;
  }, 0);
  if (eligiblePaise === 0) throw fail('This coupon does not apply to the items in your cart', 'COUPON_NOT_APPLICABLE');

  return { coupon, discountPaise: calculateCouponDiscount(coupon, eligiblePaise) };
}
