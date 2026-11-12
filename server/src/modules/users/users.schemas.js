// Zod schemas for the users endpoints (admin user management and a user's own account).
import { z } from 'zod';
import { idParams } from '../../utils/idSchemas.js';
import { emailSchema, passwordSchema, personNameSchema } from '../auth/auth.schemas.js';

const roleSchema = z.enum(['end_user', 'technician', 'admin']);
// Optional; null or an empty string clears it.
const departmentSchema = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .transform((d) => d || null);

const atLeastOneField = [
  (body) => Object.keys(body).length > 0,
  'Provide at least one field to update',
];

export const userIdParams = idParams;

export const listUsersQuery = z.object({
  role: roleSchema.optional(),
  // Query strings are always text, so "true"/"false" become a boolean here.
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const createUserSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: roleSchema,
  department: departmentSchema.optional(),
  // A temporary password the admin passes on; the user changes it with PATCH /users/me.
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    name: personNameSchema.optional(),
    role: roleSchema.optional(),
    department: departmentSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(...atLeastOneField);

export const updateMeSchema = z
  .object({
    name: personNameSchema.optional(),
    emailNotifications: z.boolean().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine(...atLeastOneField)
  // Someone at an unlocked computer shouldn't be able to take over the account.
  .refine((body) => body.newPassword === undefined || body.currentPassword !== undefined, {
    message: 'Enter your current password to set a new one',
    path: ['currentPassword'],
  });
