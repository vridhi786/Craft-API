import { z } from 'zod';
import { uuid, requiredText, optionalText, money, nullableDate, imageInput, httpsUrl, text, pagination } from './common.js';

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().max(300).optional());
const emptyOrUrl = z.union([z.literal(''), z.string().url().max(400)]);

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Code: 3-30 letters, numbers, dash or underscore'),
  description: optionalText(200),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().positive().max(10_000_000),
  minCartAmount: money.optional(),
  maxDiscount: money.nullable().optional(),
  startsAt: nullableDate,
  expiresAt: nullableDate,
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  products: z.array(uuid).max(100).optional(),
  categories: z.array(uuid).max(50).optional(),
  isActive: z.boolean().optional(),
});
export const couponUpdateSchema = couponSchema.partial();
export const couponValidateSchema = z.object({
  code: z.string().trim().min(1).max(30),
  items: z.array(z.object({ productId: uuid, variantId: uuid.nullish(), quantity: z.number().int().min(1).max(20), customizations: z.record(z.string(), z.string()).default({}) })).min(1).max(30),
  phone: z.string().max(20).optional(),
});

export const offerSchema = z.object({
  title: requiredText(120),
  description: optionalText(500),
  image: imageInput.nullable().optional(),
  startsAt: nullableDate,
  endsAt: nullableDate,
  isActive: z.boolean().optional(),
  couponCode: z.string().trim().toUpperCase().max(30).optional(),
  products: z.array(uuid).max(100).optional(),
  categories: z.array(uuid).max(50).optional(),
});
export const offerUpdateSchema = offerSchema.partial();

export const bannerSchema = z.object({
  title: requiredText(120),
  description: optionalText(300),
  image: imageInput,
  mobileImage: z.object({ url: httpsUrl, publicId: z.string().optional() }).nullable().optional(),
  ctaLabel: optionalText(40),
  linkUrl: optionalUrl,
  product: uuid.nullable().optional(),
  category: uuid.nullable().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  startsAt: nullableDate,
  endsAt: nullableDate,
  isActive: z.boolean().optional(),
});
export const bannerUpdateSchema = bannerSchema.partial();

export const reviewCreateSchema = z.object({
  orderId: z.string().trim().min(5).max(40),
  phone: z.string().min(10).max(20),
  productId: uuid,
  rating: z.number().int().min(1).max(5),
  title: optionalText(100),
  text: requiredText(1500),
});
export const reviewModerateSchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
export const reviewListQuery = z.object({ ...pagination, product: uuid.optional(), status: z.enum(['pending', 'approved', 'rejected']).optional(), limit: z.coerce.number().int().min(1).max(50).default(12) });

export const inventoryAdjustSchema = z
  .object({
    productId: uuid,
    variantId: uuid.optional(),
    delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    reason: requiredText(200),
  })
  .refine((v) => (v.delta === undefined) !== (v.stock === undefined), { message: 'Provide either "delta" or "stock"' });

export const settingsSchema = z
  .object({
    brandName: requiredText(80),
    tagline: optionalText(120),
    logoUrl: emptyOrUrl,
    faviconUrl: emptyOrUrl,
    contactEmail: z.union([z.literal(''), z.string().email().max(120)]),
    businessPhone: optionalText(30),
    whatsappNumber: z.string().regex(/^(\d{10,15})?$/, 'Digits only, international format, e.g. 919876543210'),
    address: optionalText(300),
    social: z.object({ instagram: emptyOrUrl, facebook: emptyOrUrl, youtube: emptyOrUrl, pinterest: emptyOrUrl }).partial(),
    hero: z.object({ title: optionalText(120), subtitle: optionalText(240), image: emptyOrUrl, imageAlt: optionalText(160), primaryCtaLabel: optionalText(30), secondaryCtaLabel: optionalText(30) }).partial(),
    announcement: z.object({ enabled: z.boolean(), text: optionalText(200), link: z.union([z.literal(''), z.string().max(300)]) }).partial(),
    footerText: optionalText(300),
    shipping: z.object({ flatRate: money, freeShippingThreshold: money, note: optionalText(300) }).partial(),
    coupons: z.object({ enabled: z.boolean() }).partial(),
    display: z.object({ productsPerPage: z.number().int().min(4).max(48), showReviews: z.boolean(), showWhatsappInquiry: z.boolean(), showLowStockCount: z.boolean() }).partial(),
    seo: z.object({ defaultTitle: optionalText(70), defaultDescription: optionalText(170), ogImage: emptyOrUrl }).partial(),
    maintenance: z.object({ enabled: z.boolean(), message: optionalText(300) }).partial(),
  })
  .partial();
