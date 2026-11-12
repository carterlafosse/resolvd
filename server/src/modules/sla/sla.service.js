// SLA business rules: the deadlines a ticket gets from its org's policy, and managing the policies.
import { withOrg } from '../../db/withOrg.js';
import { computeDueDates } from './sla.js';
import * as queries from './sla.queries.js';

// Rules:
// - Each org has one policy per priority: response and resolution times in minutes.
// - Staff can read the policies (they work against them); only admins change them (the routes
//   check both).
// - Times are 5 minutes to 90 days, and the response must be due before the resolution
//   (sla.schemas.js, backed by a CHECK in the database).
// - A policy change applies to tickets created afterwards and to later priority changes.
//   Existing tickets keep the deadlines stored on them, so nobody's deadline moves under them.

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

// GET /api/sla-policies
export function listPolicies(user) {
  return withOrg(user.orgId, (client) => queries.listPolicies(client));
}

// PUT /api/sla-policies/:priority
export function updatePolicy(user, priority, times) {
  return withOrg(user.orgId, (client) => queries.upsertPolicy(client, priority, times));
}
