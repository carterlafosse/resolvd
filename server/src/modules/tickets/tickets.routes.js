// Routes under /api/tickets: any signed-in user; the service decides what each role may see and do.
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './tickets.controller.js';
import {
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
