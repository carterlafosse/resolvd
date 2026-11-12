// Pure helpers for SLA display: the badge wording and which clock a queue row shows.
import { SLA_STATES } from '../constants.js';
import { shortDuration } from '../dates.js';

// "Due in 2h", "At risk, 25m left", "Breached 1h ago", "Met" or "No SLA". `now` is a parameter
// so the wording can be tested with a fixed clock.
export function slaLabel(state, dueAt, now = new Date()) {
  if (!dueAt || state === 'none') return SLA_STATES.none.label;
  const span = shortDuration(dueAt, now);
  if (state === 'breached') return `Breached ${span} ago`;
  if (state === 'at_risk') return `At risk, ${span} left`;
  if (state === 'on_track') return `Due in ${span}`;
  return SLA_STATES.met.label;
}

// A ticket has two clocks, but a queue row has room for one badge. It shows the clock that
// decided sla.overall (the more severe one); if both are in that state, the earlier deadline
// is the more urgent.
export function overallClock(ticket) {
  const overall = ticket.sla?.overall ?? 'none';
  const clocks = [
    { name: 'Response', state: ticket.sla?.response, dueAt: ticket.response_due_at },
    { name: 'Resolution', state: ticket.sla?.resolution, dueAt: ticket.resolution_due_at },
  ].filter((clock) => clock.state === overall);
  clocks.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  return clocks[0] ?? { name: null, state: 'none', dueAt: null };
}
