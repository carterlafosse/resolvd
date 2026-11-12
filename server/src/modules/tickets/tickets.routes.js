// Routes under /api/tickets: any signed-in user; the service decides what each role may see and do.
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './tickets.controller.js';
import { createTicketSchema } from './tickets.schemas.js';

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);

ticketsRouter.post('/', validate({ body: createTicketSchema }), controller.create);
