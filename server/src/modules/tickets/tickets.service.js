// Tickets business rules: who can see, create and edit tickets, and the change history they leave.
import { AppError } from '../../utils/AppError.js';

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
