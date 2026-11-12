// Routes under /api/categories: any signed-in user can list; admins add and rename.
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './categories.controller.js';
import { categoryBodySchema, categoryIdParams } from './categories.schemas.js';

export const categoriesRouter = Router();

categoriesRouter.use(authenticate);

categoriesRouter.get('/', controller.list);
categoriesRouter.post(
  '/',
  requireRole('admin'),
  validate({ body: categoryBodySchema }),
  controller.create,
);
categoriesRouter.patch(
  '/:id',
  requireRole('admin'),
  validate({ params: categoryIdParams, body: categoryBodySchema }),
  controller.rename,
);
