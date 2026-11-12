// Ticket status workflow: which status changes are allowed, for whom, and what they set. Pure, no DB.
//
// Kept free of database code so every rule can be unit tested with plain objects and a fixed
// `now`, and so the same answers can be reused anywhere (for example, to tell the front end
// which status buttons to show).

export const STAFF_ROLES = ['technician', 'admin'];

export function isStaff(user) {
  return STAFF_ROLES.includes(user.role);
}

// From each status, the statuses staff may move a ticket to. Closed is final.
export const TRANSITIONS = {
  open: ['in_progress', 'on_hold', 'resolved'],
  in_progress: ['on_hold', 'resolved', 'open'],
  on_hold: ['in_progress', 'resolved'],
  resolved: ['closed', 'open'],
  closed: [],
};

// The requester may answer a resolution: confirm the fix (close) or say it isn't fixed
// (reopen). Nothing else is theirs to change.
const REQUESTER_TRANSITIONS = {
  resolved: ['closed', 'open'],
};

// How long after resolution the requester can still reopen. After that, a new ticket is the
// right place for a problem that came back. Staff can reopen at any time.
export const REOPEN_WINDOW_DAYS = 7;
const REOPEN_WINDOW_MS = REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function allow() {
  return { ok: true, reason: null };
}

function deny(reason) {
  return { ok: false, reason };
}

// May `user` move `ticket` to status `to` at time `now`? Returns { ok, reason }, where reason is
// a message that can be shown to the user as is. The ticket only needs status, requester_id
// and resolved_at. Checking that the user can see the ticket at all is the caller's job.
export function canTransition({ ticket, to, user, now }) {
  const from = ticket.status;

  if (from === 'closed') {
    return deny('This ticket is closed. Please submit a new one.');
  }
  if (from === to) {
    return deny(`The ticket is already ${to}`);
  }
  if (!TRANSITIONS[from]?.includes(to)) {
    return deny(`A ticket can't move from ${from} to ${to}`);
  }
  if (isStaff(user)) return allow();

  const isRequester = ticket.requester_id === user.id;
  if (!isRequester || !REQUESTER_TRANSITIONS[from]?.includes(to)) {
    return deny('Only support staff can change the status of this ticket');
  }

  if (to === 'open') {
    const resolvedFor = now.getTime() - new Date(ticket.resolved_at).getTime();
    // Written as "not within" so a missing resolved_at (NaN) is refused, not allowed.
    if (!(resolvedFor <= REOPEN_WINDOW_MS)) {
      return deny(
        `Tickets can only be reopened within ${REOPEN_WINDOW_DAYS} days of being resolved. ` +
          'Please submit a new one.',
      );
    }
  }
  return allow();
}

// Every status `user` may move `ticket` to right now, by asking canTransition about each one.
// The ticket detail response sends this list so the front end shows exactly the moves the API
// would accept, instead of keeping its own copy of the rules. The current status is never in
// it, because moving to the same status is refused.
export function allowedTransitions({ ticket, user, now }) {
  return Object.keys(TRANSITIONS).filter((to) => canTransition({ ticket, to, user, now }).ok);
}

// The timestamp columns a status change sets or clears, keyed by the API field names used in
// tickets.queries.js (updateTicket). Resolving records when; reopening a resolved ticket clears
// it, so resolved_at always describes the current resolution; closing records when.
export function statusChangeEffects({ from, to, now }) {
  if (to === 'resolved') return { resolvedAt: now };
  if (from === 'resolved' && to === 'open') return { resolvedAt: null };
  if (to === 'closed') return { closedAt: now };
  return {};
}
