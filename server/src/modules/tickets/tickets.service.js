// Tickets business rules: who can see, create and edit tickets, and the change history they leave.
import { withOrg } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { buildPagination, toLimitOffset } from '../../utils/pagination.js';
import { fieldError } from '../../utils/pgErrors.js';
import { slaSummary, withSla } from '../sla/sla.js';
import { dueDatesFor } from '../sla/sla.service.js';
import * as queries from './tickets.queries.js';
import { allowedTransitions, canTransition, isStaff, statusChangeEffects } from './workflow.js';

// Rules (all enforced here; tickets.queries.js only runs SQL):
// - End users see only tickets they requested. Technicians and admins see every ticket in
//   their organization.
// - A ticket the caller can't see is "not found" (404 "Ticket not found"), never 403, so its
//   existence isn't revealed. Another organization's ticket is not found the same way.
// - End users may set priority low, medium or high. Critical is for staff only (403).
// - Ticket numbers are per organization, starting at 1001, and shown as display_id "RES-1001".
// - The requester may edit title, description and category while the ticket is open. Staff
//   may edit those and the priority at any status except closed. Nobody edits a closed ticket.
// - Every change writes ticket_events rows (one per changed field) in the same transaction,
//   and creating a ticket writes a "created" event.
// - An update can carry expectedUpdatedAt; if the ticket changed since then, it's refused
//   with 409 so one person's edit never silently overwrites another's.
// - Status changes follow the workflow in workflow.js (who may move a ticket from which
//   status to which). A refused move is 400 INVALID_TRANSITION with the workflow's reason.
//   Resolving sets resolved_at, reopening a resolved ticket clears it, closing sets closed_at.
// - Only staff assign tickets and change priority (the routes return 403 to end users).
//   The assignee must be an active technician or admin in the org (400 otherwise). The
//   assignee event stores names ("Unassigned" for none). Assigning an open ticket moves it
//   to in_progress and writes that status event too.
// - Nothing about a closed ticket can change (400 TICKET_CLOSED).
// - History: staff see every event; end users see only "created" and "status" events
//   (PUBLIC_EVENT_FIELDS), filtered in SQL. The activity feed applies the same rule to events
//   and hides internal notes from end users, like the comments endpoint.
// - Every write locks the ticket row first (loadTicketForUpdate), so concurrent changes to one
//   ticket run one after another and their events form one consistent history.
// - SLA (rules in sla/sla.js): a new ticket gets response and resolution deadlines from its
//   org's policy for its priority, counted from created_at, in the same transaction. A
//   priority change (PATCH /:id or /:id/priority) recalculates both from created_at and
//   writes a response_due_at and a resolution_due_at event for each deadline that moved.
//   A breach the SLA job recorded is cleared if the new deadline isn't breached.
// - Resolving a ticket counts as the first response if no public staff reply came first.
// - Every ticket returned (list and detail) carries sla: { response, resolution, overall }.
// - The detail (GET /:id) also carries allowedTransitions, canEdit and canComment for the
//   viewer, computed by the same functions the write paths use.

// isStaff lives in workflow.js (no database imports) and is re-exported for the other modules.
export { isStaff };

// The visibility rule in one place. The list and detail queries apply the same rule in SQL
// (requesterIdFilter), so a ticket an end user can't see is never even loaded.
export function canView(user, ticket) {
  return isStaff(user) || ticket.requester_id === user.id;
}

// For queries: the requester to filter on, or null when the caller sees every ticket.
export function requesterIdFilter(user) {
  return isStaff(user) ? null : user.id;
}

export function ticketNotFound() {
  return AppError.notFound('Ticket not found');
}

// Ticket numbers are INT columns; more than 9 digits could overflow, and no org gets that far.
const TICKET_NUMBER = /^(?:RES-)?(\d{1,9})$/i;

// The search box matches titles containing the text, or a ticket number typed as
// "RES-1003", "res-1003" or "1003".
// %, _ and \ are escaped so they match literally: searching "100%" shouldn't match everything.
export function parseTicketSearch(search) {
  const text = search.trim();
  const escaped = text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const numberMatch = TICKET_NUMBER.exec(text);
  return {
    titlePattern: `%${escaped}%`,
    ticketNumber: numberMatch ? Number(numberMatch[1]) : null,
  };
}

export function assertCanSetPriority(user, priority) {
  if (priority === 'critical' && !isStaff(user)) {
    throw AppError.forbidden('Only support staff can set critical priority');
  }
}

// A categoryId that doesn't exist in the org (or belongs to another org) is a field error the
// form can show, not a 404: the ticket itself is what the request is about.
async function categoryNameOrError(client, categoryId) {
  const name = await queries.findCategoryName(client, categoryId);
  if (name === null) {
    throw AppError.validation('Category not found', fieldError('categoryId', 'Category not found'));
  }
  return name;
}

// POST /api/tickets
export function createTicket(user, { title, description, priority, categoryId }) {
  assertCanSetPriority(user, priority);

  return withOrg(user.orgId, async (client) => {
    if (categoryId != null) await categoryNameOrError(client, categoryId);

    const ticketNumber = await queries.claimTicketNumber(client);
    const { id: ticketId, created_at: createdAt } = await queries.insertTicket(client, {
      ticketNumber,
      title,
      description,
      priority,
      categoryId,
      requesterId: user.id,
    });
    // Deadlines count from the created_at the database just stored, so they line up exactly.
    // Setting them is part of creating the ticket, so it writes no event of its own.
    await queries.updateTicket(client, ticketId, await dueDatesFor(client, priority, createdAt));
    // new_value records the starting status, so the status history begins at creation.
    await queries.insertEvent(client, {
      ticketId,
      actorId: user.id,
      field: 'created',
      newValue: 'open',
    });

    return findTicketWithSla(client, ticketId);
  });
}

// A ticket as every endpoint returns it: the row plus its SLA summary as of now.
async function findTicketWithSla(client, ticketId, options) {
  const ticket = await queries.findTicketById(client, ticketId, options);
  return ticket && withSla(ticket);
}

// Deadlines are stored as timestamps; events store text, so they record ISO strings.
function isoOrNull(date) {
  return date === null ? null : new Date(date).toISOString();
}

// A new priority means new deadlines, recalculated from created_at with the org's policy for
// that priority (the original start time stays, so changing priority never resets the clock).
// Returns the column changes and one event per deadline that actually moved.
async function deadlineChangesFor(client, ticket, priority, now = new Date()) {
  const { responseDueAt, resolutionDueAt } = await dueDatesFor(client, priority, ticket.created_at);
  const changes = { responseDueAt, resolutionDueAt };

  // A breach recorded by the SLA job belongs to the old deadline. If the new deadline hasn't
  // been breached (for example, critical lowered to low), clear the mark so the job can
  // record a breach of the new deadline if it passes. If the new deadline is breached too,
  // the mark stays, so the same breach isn't recorded twice. The old sla_breach event stays
  // in the history either way.
  const sla = slaSummary(
    { ...ticket, response_due_at: responseDueAt, resolution_due_at: resolutionDueAt },
    now,
  );
  if (ticket.response_breached_at !== null && sla.response !== 'breached') {
    changes.responseBreachedAt = null;
  }
  if (ticket.resolution_breached_at !== null && sla.resolution !== 'breached') {
    changes.resolutionBreachedAt = null;
  }

  const events = [];
  for (const [field, oldValue, newValue] of [
    ['response_due_at', ticket.response_due_at, responseDueAt],
    ['resolution_due_at', ticket.resolution_due_at, resolutionDueAt],
  ]) {
    if (isoOrNull(oldValue) !== isoOrNull(newValue)) {
      events.push({ field, oldValue: isoOrNull(oldValue), newValue: isoOrNull(newValue) });
    }
  }
  return { changes, events };
}

// Every service that changes a ticket starts here: lock the row, then 404 unless the caller
// can see it. Phase 5's status, assignment, priority and comment services reuse this.
export async function loadTicketForUpdate(client, user, ticketId) {
  const ticket = await queries.lockTicket(client, ticketId);
  if (!ticket || !canView(user, ticket)) throw ticketNotFound();
  return ticket;
}

// For endpoints that only read a ticket's comments or history: 404 unless the caller can see
// the ticket. No lock, because nothing is changed.
export async function loadTicketForRead(client, user, ticketId) {
  const ticket = await queries.findTicketAccess(client, ticketId);
  if (!ticket || !canView(user, ticket)) throw ticketNotFound();
  return ticket;
}

// GET /api/tickets/:id. The visibility rule is in the query's WHERE clause.
// The detail also says what this viewer may do with the ticket, worked out from the same rules
// the write endpoints enforce, so the front end never needs its own copy of them.
export function getTicket(user, ticketId) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await findTicketWithSla(client, ticketId, {
      requesterId: requesterIdFilter(user),
    });
    if (!ticket) throw ticketNotFound();
    return { ...ticket, ...allowedActions(user, ticket) };
  });
}

// Closed is final: nobody edits, assigns, reprioritizes or comments on a closed ticket.
// Shared by every write path; each passes the message that fits its action.
export function assertNotClosed(ticket, message = "This ticket is closed and can't be changed") {
  if (ticket.status === 'closed') throw AppError.badRequest(message, undefined, 'TICKET_CLOSED');
}

// May this (visible) ticket's title, description and category be edited by `user` right now?
// Staff: any status but closed. The requester: only while it's open.
export function canEdit(user, ticket) {
  if (ticket.status === 'closed') return false;
  return isStaff(user) || ticket.status === 'open';
}

// May `user` comment on this (visible) ticket? Anyone who can see it, until it's closed.
// Internal notes are a separate, staff-only choice made when posting.
export function canComment(ticket) {
  return ticket.status !== 'closed';
}

// What the ticket detail tells the front end about this viewer's options.
export function allowedActions(user, ticket, now = new Date()) {
  return {
    allowedTransitions: allowedTransitions({ ticket, user, now }),
    canEdit: canEdit(user, ticket),
    canComment: canComment(ticket),
  };
}

// Who may edit this ticket's details right now (the ticket is already known to be visible).
function assertCanEdit(user, ticket) {
  assertNotClosed(ticket, "This ticket is closed and can't be edited");
  // 403, not 404: the requester can see the ticket, they just can't edit it at this stage.
  if (!canEdit(user, ticket)) {
    throw AppError.forbidden(
      'You can only edit your ticket while it is open. Add a comment instead.',
    );
  }
}

// The editable fields: request field -> the ticket column it changes and the event's field name.
const EDITABLE_FIELDS = [
  { field: 'title', column: 'title' },
  { field: 'description', column: 'description' },
  { field: 'priority', column: 'priority' },
  { field: 'categoryId', column: 'category_id', event: 'category' },
];

// PATCH /api/tickets/:id
export function updateTicket(user, ticketId, { expectedUpdatedAt, ...requested }) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await loadTicketForUpdate(client, user, ticketId);

    // Checked first: a decision made from an outdated copy of the ticket isn't meaningful.
    // updated_at is compared in milliseconds because that's the precision JSON dates carry.
    if (
      expectedUpdatedAt !== undefined &&
      new Date(expectedUpdatedAt).getTime() !== ticket.updated_at.getTime()
    ) {
      throw AppError.conflict('This ticket was changed by someone else. Reload and try again.');
    }

    assertCanEdit(user, ticket);

    // Only fields whose value actually differs count as changes; resending the current
    // value is not an edit and writes no event.
    const changes = {};
    const events = [];
    for (const { field, column, event = field } of EDITABLE_FIELDS) {
      const newValue = requested[field];
      if (newValue === undefined || newValue === ticket[column]) continue;
      changes[field] = newValue;
      events.push({ field: event, oldValue: ticket[column], newValue });
    }

    if (changes.priority !== undefined) {
      // The requester picks a priority when creating the ticket; after that it's staff's call.
      if (!isStaff(user)) {
        throw AppError.forbidden('Only support staff can change the priority');
      }
      assertCanSetPriority(user, changes.priority);

      // Same recalculation as changePriority, so both ways of changing priority agree.
      const deadlines = await deadlineChangesFor(client, ticket, changes.priority);
      Object.assign(changes, deadlines.changes);
      events.push(...deadlines.events);
    }

    // Categories are recorded by name in the history, which stays readable after a rename.
    const categoryEvent = events.find((e) => e.field === 'category');
    if (categoryEvent) {
      categoryEvent.oldValue = ticket.category_name;
      categoryEvent.newValue =
        changes.categoryId === null ? null : await categoryNameOrError(client, changes.categoryId);
    }

    if (events.length > 0) {
      await queries.updateTicket(client, ticketId, changes);
      for (const e of events) {
        await queries.insertEvent(client, { ticketId, actorId: user.id, ...e });
      }
    }

    return findTicketWithSla(client, ticketId);
  });
}

// Moves a locked ticket to a new status: sets the workflow's timestamps and writes the status
// event. It doesn't check who may do this; callers check canTransition first, or (for the
// automatic moves after assigning or a requester's reply) are the rule themselves.
// Updates `ticket` in place so later steps in the same transaction see the new status.
export async function writeStatusChange(client, { ticket, to, actorId, now }) {
  const from = ticket.status;
  await queries.updateTicket(client, ticket.id, {
    status: to,
    ...statusChangeEffects({ from, to, now }),
  });
  await queries.insertEvent(client, {
    ticketId: ticket.id,
    actorId,
    field: 'status',
    oldValue: from,
    newValue: to,
  });
  ticket.status = to;
}

// Records when staff first replied publicly, which stops the SLA response clock: the first
// public staff comment, or resolving the ticket if that came first. Only the first counts,
// so a ticket that already has one is left alone. The comment or status event is itself the
// record, so no separate event is written.
export async function recordFirstResponse(client, ticket, at) {
  if (ticket.first_response_at !== null) return;
  await queries.updateTicket(client, ticket.id, { firstResponseAt: at });
  ticket.first_response_at = at;
}

// PATCH /api/tickets/:id/status
export function changeStatus(user, ticketId, { status }) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await loadTicketForUpdate(client, user, ticketId);

    // One clock for the decision and the timestamps it writes.
    const now = new Date();
    const check = canTransition({ ticket, to: status, user, now });
    if (!check.ok) throw AppError.badRequest(check.reason, undefined, 'INVALID_TRANSITION');

    await writeStatusChange(client, { ticket, to: status, actorId: user.id, now });
    // Only staff can resolve (workflow.js), and telling the requester "this is fixed" is a
    // response. Without this, a ticket resolved before anyone commented would show its
    // response clock running on, and later breaching, after the work was already done.
    if (status === 'resolved') await recordFirstResponse(client, ticket, now);
    return findTicketWithSla(client, ticketId);
  });
}

// Assignment events record names, not ids, so the history still reads correctly after a
// user is renamed and needs no lookup to display.
const UNASSIGNED = 'Unassigned';

// PATCH /api/tickets/:id/assignment and POST /api/tickets/:id/assign-to-me (staff only; the
// route checks the role). assigneeId null unassigns.
export function assignTicket(user, ticketId, assigneeId) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await loadTicketForUpdate(client, user, ticketId);
    assertNotClosed(ticket);

    // Assigning to the current assignee is not a change: no event, no status move.
    if (assigneeId === ticket.assignee_id) return findTicketWithSla(client, ticketId);

    let assigneeName = UNASSIGNED;
    if (assigneeId !== null) {
      const assignee = await queries.findAssignableUser(client, assigneeId);
      if (!assignee) {
        const message = 'Tickets can only be assigned to an active technician or admin';
        throw AppError.validation(message, fieldError('assigneeId', message));
      }
      assigneeName = assignee.name;
    }

    await queries.updateTicket(client, ticketId, { assigneeId });
    await queries.insertEvent(client, {
      ticketId,
      actorId: user.id,
      field: 'assignee',
      oldValue: ticket.assignee_name ?? UNASSIGNED,
      newValue: assigneeName,
    });

    // Someone now owns a ticket nobody had started, so the work has begun. open ->
    // in_progress is a staff move in the workflow, and only staff reach this service.
    if (assigneeId !== null && ticket.status === 'open') {
      await writeStatusChange(client, {
        ticket,
        to: 'in_progress',
        actorId: user.id,
        now: new Date(),
      });
    }

    return findTicketWithSla(client, ticketId);
  });
}

// PATCH /api/tickets/:id/priority (staff only; the route checks the role).
// Recalculates the SLA deadlines from created_at for the new priority.
export function changePriority(user, ticketId, { priority }) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await loadTicketForUpdate(client, user, ticketId);
    assertNotClosed(ticket);

    if (priority !== ticket.priority) {
      const deadlines = await deadlineChangesFor(client, ticket, priority);
      await queries.updateTicket(client, ticketId, { priority, ...deadlines.changes });
      const events = [
        { field: 'priority', oldValue: ticket.priority, newValue: priority },
        ...deadlines.events,
      ];
      for (const e of events) {
        await queries.insertEvent(client, { ticketId, actorId: user.id, ...e });
      }
    }

    return findTicketWithSla(client, ticketId);
  });
}

// The only history end users see: when their ticket was created and how its status moved.
// Assignment, priority and edits are the support team's working detail.
export const PUBLIC_EVENT_FIELDS = ['created', 'status'];

function historyVisibility(user) {
  return { includeAll: isStaff(user), publicFields: PUBLIC_EVENT_FIELDS };
}

// GET /api/tickets/:id/events: newest first.
export function listEvents(user, ticketId) {
  return withOrg(user.orgId, async (client) => {
    await loadTicketForRead(client, user, ticketId);
    return { data: await queries.listEvents(client, ticketId, historyVisibility(user)) };
  });
}

// GET /api/tickets/:id/activity: comments and events in one feed, oldest first.
export function getActivity(user, ticketId) {
  return withOrg(user.orgId, async (client) => {
    await loadTicketForRead(client, user, ticketId);
    return { data: await queries.listActivity(client, ticketId, historyVisibility(user)) };
  });
}

// GET /api/tickets: one page of the caller's queue, filtered, searched and sorted.
export function listTickets(user, query) {
  const { status, priority, assignee, categoryId, search, sla, sort, order, page, pageSize } =
    query;

  // One clock for the whole request: the sla filter and every row's sla summary are judged
  // at the same moment, so a row can't be filtered as at_risk but summarised as breached.
  const now = new Date();

  const filters = {
    requesterId: requesterIdFilter(user),
    statuses: status,
    priorities: priority,
    unassigned: assignee === 'unassigned',
    assigneeId: assignee === 'me' ? user.id : typeof assignee === 'number' ? assignee : null,
    categoryId,
    ...(search ? parseTicketSearch(search) : {}),
    sla,
    now,
  };

  return withOrg(user.orgId, async (client) => {
    const { rows, total } = await queries.listTickets(client, filters, {
      sort,
      order,
      ...toLimitOffset({ page, pageSize }),
    });
    return {
      data: rows.map((ticket) => withSla(ticket, now)),
      pagination: buildPagination({ page, pageSize, total }),
    };
  });
}
