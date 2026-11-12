// Routes under /api/auth: sign-up, login, logout and the current session.
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { loginSchema, registerOrgSchema } from './auth.schemas.js';

export const authRouter = Router();

// Much stricter than the general /api limit: slows password guessing from one IP across many
// accounts, while the per-account lockout covers many IPs guessing one account.
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

authRouter.post(
  '/register-organization',
  validate({ body: registerOrgSchema }),
  controller.registerOrganization,
);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);
