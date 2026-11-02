import { z } from 'zod';
import { uuid, requiredText, optionalText, imageInput } from './common.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and hyphens').max(80);

export const categoryCreateSchema = z.object({
  name: requiredText(80),
  slug: slug.optional(),
  description: optionalText(600),
  parent: uuid.nullable().optional(),
  image: imageInput.nullable().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(170),
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export const categoryDeleteQuery = z.object({
  archive: z.enum(['true', 'false']).optional(),
  reassignTo: uuid.optional(),
});
