// SLA business rules: the deadlines a ticket gets from its org's policy.
import { computeDueDates } from './sla.js';
import * as queries from './sla.queries.js';

// Deadlines for a ticket of this priority created at createdAt, from the org's current policy.
// Runs inside the caller's withOrg transaction (ticket create and priority change), so the
// deadlines are written in the same transaction as the change that caused them.
// Every org gets all four policies at sign-up and they can be edited but not deleted, so a
// missing policy shouldn't happen. If it does, the ticket simply has no deadlines (SLA "none")
// rather than failing to save.
export async function dueDatesFor(client, priority, createdAt) {
  const policy = await queries.findPolicy(client, priority);
  if (!policy) return { responseDueAt: null, resolutionDueAt: null };
  return computeDueDates(createdAt, policy);
}
