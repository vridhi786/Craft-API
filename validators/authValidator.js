import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Enter a valid email').max(120),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(200),
});

export const passwordPolicy = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Use upper-case, lower-case letters and a number');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: passwordPolicy,
});
