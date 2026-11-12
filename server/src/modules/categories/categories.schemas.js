// Zod schemas for the categories endpoints.
import { z } from 'zod';

export const categoryIdParams = z.object({ id: z.coerce.number().int().positive() });

// Used for both create and rename: a category only has a name to set.
export const categoryBodySchema = z.object({ name: z.string().trim().min(1).max(100) });
