// Comments business rules: who sees internal notes, who may comment, and what a comment changes.
import { withOrg } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import {
  assertNotClosed,
  loadTicketForRead,
  loadTicketForUpdate,
  recordFirstResponse,
  writeStatusChange,
} from '../tickets/tickets.service.js';
import { isStaff } from '../tickets/workflow.js';
import * as queries from './comments.queries.js';

// Rules (all enforced here; comments.queries.js only runs SQL):
// - Anyone who can see the ticket can read its comments (same 404 rule as the ticket).
// - Internal notes are for staff: end users never receive them (filtered in SQL) and can't
//   write them (403).
// - Nobody comments on a closed ticket (400): a problem that comes back gets a new ticket.
// - The first public comment by staff sets the ticket's first_response_at (if not set yet).
//   Internal notes don't count: the requester hasn't heard anything.
// - A public reply from the requester on an on_hold ticket moves it back to in_progress, with
//   a status event, because on hold usually means "waiting for the requester".

// GET /api/tickets/:id/comments
export function listComments(user, ticketId) {
  return withOrg(user.orgId, async (client) => {
    await loadTicketForRead(client, user, ticketId);
    const data = await queries.listComments(client, ticketId, { includeInternal: isStaff(user) });
    return { data };
  });
}

// POST /api/tickets/:id/comments
export function addComment(user, ticketId, { body, isInternal }) {
  // Checked before loading the ticket: it depends only on the role, so it reveals nothing.
  if (isInternal && !isStaff(user)) {
    throw AppError.forbidden('Only support staff can add internal notes');
  }

  return withOrg(user.orgId, async (client) => {
    // Locked because the comment may change the ticket (first response, status), and two
    // replies at once must not both think they are the first.
    const ticket = await loadTicketForUpdate(client, user, ticketId);
    assertNotClosed(ticket, 'This ticket is closed. Please submit a new one.');

    const comment = await queries.insertComment(client, {
      ticketId,
      authorId: user.id,
      body,
      isInternal,
    });

    if (!isInternal && isStaff(user)) {
      await recordFirstResponse(client, ticket, comment.created_at);
    }

    // The requester can't make this move through PATCH /status (it's a staff move); replying
    // is how they ask for work to resume, so the reply makes it for them, recorded as theirs.
    if (!isInternal && ticket.requester_id === user.id && ticket.status === 'on_hold') {
      await writeStatusChange(client, {
        ticket,
        to: 'in_progress',
        actorId: user.id,
        now: new Date(),
      });
    }

    return comment;
  });
}
