// Zod schemas for ticket comments: the ticket id in the path and the new comment body.
import { z } from 'zod';
import { idParams } from '../../utils/idSchemas.js';

export const commentTicketParams = idParams;

export const createCommentSchema = z.object({
  // Trimmed so a comment of only spaces counts as empty.
  body: z.string().trim().min(1).max(5000),
  // Internal notes are visible to staff only. Only staff may write them (the service checks).
  isInternal: z.boolean().default(false),
});
