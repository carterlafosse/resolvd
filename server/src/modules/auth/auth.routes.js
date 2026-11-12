// Routes under /api/auth: sign-up, login, logout and the current session.
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { registerOrgSchema } from './auth.schemas.js';

export const authRouter = Router();

authRouter.post(
  '/register-organization',
  validate({ body: registerOrgSchema }),
  controller.registerOrganization,
);
