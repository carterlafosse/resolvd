// Routes under /api/sla-policies: staff can read the org's SLA policies; admins change them.
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { STAFF_ROLES } from '../tickets/workflow.js';
import * as controller from './sla.controller.js';
import { priorityParams, updatePolicySchema } from './sla.schemas.js';

export const slaPoliciesRouter = Router();

slaPoliciesRouter.use(authenticate);

slaPoliciesRouter.get('/', requireRole(...STAFF_ROLES), controller.list);
slaPoliciesRouter.put(
  '/:priority',
  requireRole('admin'),
  validate({ params: priorityParams, body: updatePolicySchema }),
  controller.update,
);
