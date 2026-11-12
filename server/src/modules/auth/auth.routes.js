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

// Each sign-up creates an organization and runs bcrypt, so one IP can only do it a few
// times an hour. Every request counts, including rejected ones.
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'Too many sign-up attempts. Try again in an hour.',
});

authRouter.post(
  '/register-organization',
  registerLimiter,
  validate({ body: registerOrgSchema }),
  controller.registerOrganization,
);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);
