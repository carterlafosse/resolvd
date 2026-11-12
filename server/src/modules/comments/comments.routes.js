// Routes under /api/tickets/:id/comments: any signed-in user who can see the ticket.
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as controller from './comments.controller.js';
import { commentTicketParams, createCommentSchema } from './comments.schemas.js';

// mergeParams makes the parent route's :id visible here. Mounted inside the tickets router,
// after its authenticate middleware, so every request here already has req.user.
export const commentsRouter = Router({ mergeParams: true });

commentsRouter.get('/', validate({ params: commentTicketParams }), controller.list);
commentsRouter.post(
  '/',
  validate({ params: commentTicketParams, body: createCommentSchema }),
  controller.create,
);
