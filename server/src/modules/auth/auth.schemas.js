// Zod schemas for sign-up and login, plus the email/name/password rules the users module reuses.
import { z } from 'zod';

// Trim and lowercase before checking the format, so " Ada@Example.com " is stored as
// "ada@example.com" and matches the case-insensitive unique index on users.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(255));

export const personNameSchema = z.string().trim().min(1).max(100);

// bcrypt only uses the first 72 bytes of a password; anything after that would be silently
// ignored. Non-ASCII characters take several bytes, so the byte length is checked as well.
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'Password is too long')
  .refine((p) => /[A-Za-z]/.test(p), 'Password must contain a letter')
  .refine((p) => /[0-9]/.test(p), 'Password must contain a number');

export const registerOrgSchema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,50}$/, 'Use 3 to 50 lowercase letters, numbers or hyphens'),
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

// Login only checks that something was sent: listing the password rules here would tell an
// attacker what the real passwords look like.
export const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});
