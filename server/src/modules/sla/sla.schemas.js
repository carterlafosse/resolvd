// Zod schemas for the SLA policy endpoints.
import { z } from 'zod';
import { TICKET_PRIORITIES } from '../tickets/tickets.schemas.js';

export const MIN_SLA_MINUTES = 5;
export const MAX_SLA_MINUTES = 90 * 24 * 60; // 90 days

const minutesSchema = z.number().int().min(MIN_SLA_MINUTES).max(MAX_SLA_MINUTES);

// PUT /sla-policies/:priority. An unknown priority is a 400 like any other bad input.
export const priorityParams = z.object({ priority: z.enum(TICKET_PRIORITIES) });

// Both times are required: PUT replaces the policy. The response must come before the
// resolution (the database has the same CHECK); the error is attached to resolutionMinutes so
// the form can show it there.
export const updatePolicySchema = z
  .object({ responseMinutes: minutesSchema, resolutionMinutes: minutesSchema })
  .refine((policy) => policy.responseMinutes < policy.resolutionMinutes, {
    message: 'The resolution time must be longer than the response time',
    path: ['resolutionMinutes'],
  });
