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
