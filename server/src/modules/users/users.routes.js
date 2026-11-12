// Routes under /api/users: listing for staff, management for admins, and a user's own account.
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './users.controller.js';
import {
  createUserSchema,
  listUsersQuery,
  updateMeSchema,
  updateUserSchema,
  userIdParams,
} from './users.schemas.js';

export const usersRouter = Router();

usersRouter.use(authenticate);

// requireRole runs before validate, so a caller without the role gets 403 whatever they send.
usersRouter.get(
  '/',
  requireRole('technician', 'admin'),
  validate({ query: listUsersQuery }),
  controller.list,
);
usersRouter.post(
  '/',
  requireRole('admin'),
  validate({ body: createUserSchema }),
  controller.create,
);
// Before /:id so "me" is never treated as a user id.
usersRouter.patch('/me', validate({ body: updateMeSchema }), controller.updateMe);
usersRouter.patch(
  '/:id',
  requireRole('admin'),
  validate({ params: userIdParams, body: updateUserSchema }),
  controller.update,
);
