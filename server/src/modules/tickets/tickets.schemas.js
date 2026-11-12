// Zod schemas for the tickets endpoints: create, update, the id parameter and the list query.
import { z } from 'zod';

// Same order as the database enums (declaration order is what ORDER BY sorts by).
export const TICKET_STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Ids are PostgreSQL INT columns. Anything above the INT maximum would make Postgres raise
// "value out of range" (a 500), so it's rejected here as a 400 instead.
const PG_INT_MAX = 2147483647;
const idSchema = z.coerce.number().int().positive().max(PG_INT_MAX);

const statusSchema = z.enum(TICKET_STATUSES);
const prioritySchema = z.enum(TICKET_PRIORITIES);

// Trimmed so whitespace can't pad a value past the minimum length.
const titleSchema = z.string().trim().min(5).max(200);
const descriptionSchema = z.string().trim().min(10).max(5000);
// null means "no category" (clears it on update).
const categoryIdSchema = z.number().int().positive().max(PG_INT_MAX).nullable();

export const ticketIdParams = z.object({ id: idSchema });

export const createTicketSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: prioritySchema.default('medium'),
  categoryId: categoryIdSchema.optional(),
});

// Built from the same field schemas rather than createTicketSchema.partial(), because
// partial() would keep priority's default and silently set every updated ticket to medium.
export const updateTicketSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    priority: prioritySchema.optional(),
    categoryId: categoryIdSchema.optional(),
    // The ticket's updated_at as the client last saw it. If someone else has changed the
    // ticket since, the update is refused with 409 instead of overwriting their change.
    expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (body) => ['title', 'description', 'priority', 'categoryId'].some((f) => body[f] !== undefined),
    'Provide at least one field to update',
  );

// "open,in_progress" -> ['open', 'in_progress'], each checked against the enum.
function commaList(itemSchema) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(itemSchema).nonempty());
}

// Query strings are always text, so numbers are coerced and lists are split here.
export const listTicketsQuery = z.object({
  status: commaList(statusSchema).optional(),
  priority: commaList(prioritySchema).optional(),
  // "me", "unassigned", or a user id.
  assignee: z
    .union([z.enum(['me', 'unassigned']), z.string().regex(/^\d+$/).pipe(idSchema)])
    .optional(),
  categoryId: idSchema.optional(),
  // An empty search box sends "", which means no search.
  search: z
    .string()
    .trim()
    .max(100)
    .transform((s) => s || undefined)
    .optional(),
  // Accepted now; the SLA filters are applied from Phase 6, when tickets get deadlines.
  sla: z.enum(['breached', 'at_risk']).optional(),
  // Only these names are accepted; the query maps each one to a fixed column.
  sort: z.enum(['created_at', 'updated_at', 'priority', 'resolution_due_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  // Capped so (page - 1) * pageSize can't overflow Postgres's OFFSET.
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
