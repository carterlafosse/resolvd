// Tickets business rules: who can see, create and edit tickets, and the change history they leave.
import { withOrg } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { buildPagination, toLimitOffset } from '../../utils/pagination.js';
import { fieldError } from '../../utils/pgErrors.js';
import * as queries from './tickets.queries.js';

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

const STAFF_ROLES = ['technician', 'admin'];

export function isStaff(user) {
  return STAFF_ROLES.includes(user.role);
}

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
    const ticketId = await queries.insertTicket(client, {
      ticketNumber,
      title,
      description,
      priority,
      categoryId,
      requesterId: user.id,
    });
    // new_value records the starting status, so the status history begins at creation.
    await queries.insertEvent(client, {
      ticketId,
      actorId: user.id,
      field: 'created',
      newValue: 'open',
    });

    return queries.findTicketById(client, ticketId);
  });
}

// Every service that changes a ticket starts here: lock the row, then 404 unless the caller
// can see it. Phase 5's status, assignment, priority and comment services reuse this.
export async function loadTicketForUpdate(client, user, ticketId) {
  const ticket = await queries.lockTicket(client, ticketId);
  if (!ticket || !canView(user, ticket)) throw ticketNotFound();
  return ticket;
}

// GET /api/tickets/:id. The visibility rule is in the query's WHERE clause.
export function getTicket(user, ticketId) {
  return withOrg(user.orgId, async (client) => {
    const ticket = await queries.findTicketById(client, ticketId, {
      requesterId: requesterIdFilter(user),
    });
    if (!ticket) throw ticketNotFound();
    return ticket;
  });
}

// Who may edit this ticket's details right now (the ticket is already known to be visible).
function assertCanEdit(user, ticket) {
  if (ticket.status === 'closed') {
    throw AppError.badRequest(
      "This ticket is closed and can't be edited",
      undefined,
      'TICKET_CLOSED',
    );
  }
  // 403, not 404: the requester can see the ticket, they just can't edit it at this stage.
  if (!isStaff(user) && ticket.status !== 'open') {
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

    return queries.findTicketById(client, ticketId);
  });
}

// GET /api/tickets: one page of the caller's queue, filtered, searched and sorted.
export function listTickets(user, query) {
  const { status, priority, assignee, categoryId, search, sort, order, page, pageSize } = query;
  // query.sla is accepted by the schema but applied from Phase 6, when tickets get deadlines.

  const filters = {
    requesterId: requesterIdFilter(user),
    statuses: status,
    priorities: priority,
    unassigned: assignee === 'unassigned',
    assigneeId: assignee === 'me' ? user.id : typeof assignee === 'number' ? assignee : null,
    categoryId,
    ...(search ? parseTicketSearch(search) : {}),
  };

  return withOrg(user.orgId, async (client) => {
    const { rows, total } = await queries.listTickets(client, filters, {
      sort,
      order,
      ...toLimitOffset({ page, pageSize }),
    });
    return { data: rows, pagination: buildPagination({ page, pageSize, total }) };
  });
}
