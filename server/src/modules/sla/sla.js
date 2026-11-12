// SLA rules as pure functions: deadlines from a policy, and the state of each SLA clock at a moment.
//
// The rules (also in docs/architecture.md):
// - Time is 24/7 calendar time. Nights, weekends and on_hold don't pause the clocks.
// - Both deadlines are counted from the ticket's created_at and stored on the ticket, so editing a
//   policy only affects new tickets and later priority changes.
// - The response clock is met by the first public staff reply (first_response_at). Resolving
//   a ticket also counts as the first response if nobody replied before (the status service
//   records it). The resolution clock is met by resolved_at.
// - A clock completed after its deadline is breached, not met: it was late.
// - A running clock is at risk when less than 25% of its window is left.
//
// No database code here, so every rule is unit tested with fixed times. tickets.queries.js
// (the sla= list filters) and migration 008 (mark_sla_breaches) apply the same rules in SQL.

const MINUTE_MS = 60 * 1000;

// "At risk" means less than this share of the clock's window is left.
export const AT_RISK_SHARE = 0.25;

// Least to most severe. A ticket's overall state is its more severe clock.
const SEVERITY = ['none', 'met', 'on_track', 'at_risk', 'breached'];

// The pg driver returns Dates and JSON carries ISO strings; both become milliseconds.
function toMs(value) {
  return value == null ? null : new Date(value).getTime();
}

// policy: { responseMinutes, resolutionMinutes }, as in DEFAULT_SLA_POLICIES.
export function computeDueDates(createdAt, policy) {
  const start = toMs(createdAt);
  return {
    responseDueAt: new Date(start + policy.responseMinutes * MINUTE_MS),
    resolutionDueAt: new Date(start + policy.resolutionMinutes * MINUTE_MS),
  };
}

// One clock: started at startAt, due at dueAt, stopped at completedAt (null while running).
// Returns 'none' (no deadline), 'met', 'breached', 'at_risk' or 'on_track'.
// Boundaries: completing exactly at the deadline is met; a running clock is breached only
// once now is past the deadline.
export function clockState({ startAt, dueAt, completedAt, now }) {
  const due = toMs(dueAt);
  if (due === null) return 'none';

  const completed = toMs(completedAt);
  if (completed !== null) return completed <= due ? 'met' : 'breached';

  const current = toMs(now);
  if (current > due) return 'breached';

  const window = due - toMs(startAt);
  return due - current < window * AT_RISK_SHARE ? 'at_risk' : 'on_track';
}

// Whichever state is more severe: breached > at_risk > on_track > met > none.
function moreSevere(a, b) {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
}

// Both clocks of a ticket row (snake_case columns as returned by the queries) and the overall
// state. A met response with a resolution still on track is on_track overall: the ticket
// still has work left, so "met" would hide it.
export function slaSummary(ticket, now = new Date()) {
  const startAt = ticket.created_at;
  const response = clockState({
    startAt,
    dueAt: ticket.response_due_at,
    completedAt: ticket.first_response_at,
    now,
  });
  const resolution = clockState({
    startAt,
    dueAt: ticket.resolution_due_at,
    completedAt: ticket.resolved_at,
    now,
  });
  return { response, resolution, overall: moreSevere(response, resolution) };
}

// The ticket as the API returns it: its columns plus the sla summary.
export function withSla(ticket, now = new Date()) {
  return { ...ticket, sla: slaSummary(ticket, now) };
}
