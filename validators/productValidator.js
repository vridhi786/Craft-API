import { z } from 'zod';
import { uuid, requiredText, optionalText, text, money, nullableMoney, intQty, imageInput, pagination, boolQuery } from './common.js';

const variant = z.object({
  _id: uuid.optional(),
  label: requiredText(80),
  sku: optionalText(40),
  price: nullableMoney,
  discountPrice: nullableMoney,
  stock: intQty.optional(),
  lowStockThreshold: intQty.optional(),
  isActive: z.boolean().optional(),
});

const customField = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,38}$/, 'Key must be lowercase letters, numbers or underscore, starting with a letter'),
  label: requiredText(80),
  type: z.enum(['text', 'textarea', 'select', 'photo', 'message']).default('text'),
  required: z.boolean().default(false),
  options: z.array(requiredText(80)).max(30).default([]),
  maxLength: z.number().int().min(1).max(1000).default(200),
  helpText: optionalText(200),
}).refine((f) => f.type !== 'select' || f.options.length > 0, { message: 'Select fields need at least one option', path: ['options'] });

const keywords = z.union([z.array(text(40)), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split(','))).transform((a) => [...new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 30));

export const productCreateSchema = z.object({
  name: requiredText(140),
  sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, 'SKU may only contain letters, numbers, dot, dash, underscore'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  shortDescription: optionalText(300),
  description: optionalText(6000),
  specifications: z.array(z.object({ label: requiredText(60), value: requiredText(200) })).max(30).optional(),
  category: uuid,
  subcategory: uuid.nullable().optional(),
  childCategory: uuid.nullable().optional(),
  images: z.array(imageInput).max(10).optional(),
  price: money,
  discountPrice: nullableMoney,
  stock: intQty.optional(),
  lowStockThreshold: intQty.optional(),
  trackInventory: z.boolean().optional(),
  variants: z.array(variant).max(50).optional(),
  customFields: z.array(customField).max(10).optional(),
  isFeatured: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
  keywords: keywords.optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(170),
  shippingInfo: optionalText(400),
  isActive: z.boolean().optional(),
});

export const productUpdateSchema = productCreateSchema.partial();

export const productStatusSchema = z.object({ isActive: z.boolean() });

export const productStockSchema = z
  .object({
    variantId: uuid.optional(),
    delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    stock: intQty.optional(),
    reason: requiredText(200),
  })
  .refine((v) => (v.delta === undefined) !== (v.stock === undefined), { message: 'Provide either "delta" or "stock"' });

export const productListQuery = z.object({
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(12),
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'popular', 'name']).default('newest'),
  category: z.string().max(100).optional(),
  q: z.string().max(100).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: boolQuery,
  featured: boolQuery,
  bestseller: boolQuery,
  newArrival: boolQuery,
  ids: z.string().max(1000).optional(),
  // admin-only filters (ignored by public endpoints)
  status: z.enum(['active', 'inactive', 'archived', 'all']).optional(),
  stockLevel: z.enum(['low', 'out']).optional(),
});

export const searchQuery = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(100), limit: z.coerce.number().int().min(1).max(50).default(8), page: z.coerce.number().int().min(1).default(1), sort: productListQuery.shape.sort });
