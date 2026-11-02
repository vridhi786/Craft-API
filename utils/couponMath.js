import { percentOfPaise } from './money.js';

/** Pure discount calculation (all amounts in paise). Eligibility checks happen in the caller. */
export function calculateCouponDiscount({ type, value, maxDiscount }, eligiblePaise) {
  if (eligiblePaise <= 0) return 0;
  let discount = type === 'percentage' ? percentOfPaise(eligiblePaise, value) : Math.round(value * 100);
  if (type === 'percentage' && maxDiscount && maxDiscount > 0) discount = Math.min(discount, Math.round(maxDiscount * 100));
  return Math.max(0, Math.min(discount, eligiblePaise));
}
