// Routes under /api/tickets: any signed-in user; the service decides what each role may see and do.
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './tickets.controller.js';
import { STAFF_ROLES } from './workflow.js';
import {
  assignmentSchema,
  changePrioritySchema,
  changeStatusSchema,
  createTicketSchema,
  listTicketsQuery,
  ticketIdParams,
  updateTicketSchema,
} from './tickets.schemas.js';

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);

ticketsRouter.get('/', validate({ query: listTicketsQuery }), controller.list);
ticketsRouter.post('/', validate({ body: createTicketSchema }), controller.create);
ticketsRouter.get('/:id', validate({ params: ticketIdParams }), controller.get);
ticketsRouter.patch(
  '/:id',
  validate({ params: ticketIdParams, body: updateTicketSchema }),
  controller.update,
);

// Any signed-in user: the workflow decides who may make each move (requesters can confirm or
// reopen a resolved ticket).
ticketsRouter.patch(
  '/:id/status',
  validate({ params: ticketIdParams, body: changeStatusSchema }),
  controller.changeStatus,
);

// Staff only. requireRole runs before validate, so an end user gets 403 whatever they send.
const staffOnly = requireRole(...STAFF_ROLES);

ticketsRouter.patch(
  '/:id/assignment',
  staffOnly,
  validate({ params: ticketIdParams, body: assignmentSchema }),
  controller.assign,
);
ticketsRouter.post(
  '/:id/assign-to-me',
  staffOnly,
  validate({ params: ticketIdParams }),
  controller.assignToMe,
);
ticketsRouter.patch(
  '/:id/priority',
  staffOnly,
  validate({ params: ticketIdParams, body: changePrioritySchema }),
  controller.changePriority,
);
