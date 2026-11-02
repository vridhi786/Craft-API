import { z } from 'zod';
import { cleanText } from '../utils/sanitizeInput.js';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id').transform((s) => s.toLowerCase());
export const text = (max = 200) => z.string().max(max * 2).transform(cleanText).refine((s) => s.length <= max, `Must be at most ${max} characters`);
export const requiredText = (max = 200) => text(max).refine((s) => s.length > 0, 'This field is required');
export const optionalText = (max = 200) => text(max).optional();
export const money = z.number().finite().nonnegative().max(10_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Use at most 2 decimal places');
export const nullableMoney = money.nullable().optional();
export const intQty = z.number().int().nonnegative().max(1_000_000);
export const bool = z.boolean();
export const httpsUrl = z.string().url().max(600).refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Must be an https URL');
export const imageInput = z.object({ url: httpsUrl, publicId: z.string().max(200).optional(), alt: optionalText(160) });
export const date = z.coerce.date();
export const nullableDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());

export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
};
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true').optional();
