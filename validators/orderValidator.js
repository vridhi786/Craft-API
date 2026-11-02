import { z } from 'zod';
import { uuid, requiredText, optionalText, text, pagination } from './common.js';
import { normalizeIndianPhone } from '../utils/phone.js';
import { ORDER_STATUSES } from '../utils/orderStatus.js';

const phone = z.string().min(1, 'Mobile number is required').max(20).refine((p) => normalizeIndianPhone(p), 'Enter a valid 10-digit Indian mobile number').transform((p) => normalizeIndianPhone(p));
const optionalPhone = z.preprocess((v) => (v === '' || v === null ? undefined : v), phone.optional());

export const cartItem = z.object({
  productId: uuid,
  variantId: uuid.nullish(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(20, 'Maximum 20 per item'),
  customizations: z.record(z.string().max(60), z.string().max(1100)).default({}),
});

export const quoteSchema = z.object({
  items: z.array(cartItem).min(1, 'Your cart is empty').max(30),
  couponCode: z.string().trim().max(30).optional(),
  phone: optionalPhone,
});

export const createOrderSchema = z.object({
  customer: z.object({
    name: requiredText(80),
    phone,
    whatsapp: optionalPhone,
    email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email('Enter a valid email').max(120).optional()),
  }),
  address: z.object({
    line1: requiredText(150),
    line2: optionalText(150),
    city: requiredText(60),
    state: requiredText(60),
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
    landmark: optionalText(100),
  }),
  items: z.array(cartItem).min(1, 'Your cart is empty').max(30),
  couponCode: z.string().trim().max(30).optional(),
  customerNotes: optionalText(1000),
  giftMessage: optionalText(500),
  expectedTotal: z.number().nonnegative().optional(),
});

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8-100 URL-safe characters');

export const trackQuery = z.object({ phone });

export const orderListQuery = z.object({
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(80).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(['unpaid', 'partially_paid', 'paid']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const statusSchema = z.object({ status: z.enum(ORDER_STATUSES), note: optionalText(300) });
export const notesSchema = z.object({ note: requiredText(1000) });
export const cancelSchema = z.object({ reason: requiredText(300) });
export const paymentSchema = z.object({ paymentStatus: z.enum(['unpaid', 'partially_paid', 'paid']), amountCollected: z.number().nonnegative().max(10_000_000) });
export const exportSchema = orderListQuery.omit({ page: true, limit: true });
