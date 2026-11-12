// Zod schemas for the categories endpoints.
import { z } from 'zod';
import { idParams } from '../../utils/idSchemas.js';

export const categoryIdParams = idParams;

// Used for both create and rename: a category only has a name to set.
export const categoryBodySchema = z.object({ name: z.string().trim().min(1).max(100) });
