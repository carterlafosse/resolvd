// Builds the Express app (middleware, routers, error handling) without listening, so tests can use it.
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { docsRouter } from './docs.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { notFound } from './middleware/notFound.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  // One proxy (Render's load balancer) sits in front of the API in production. Trusting it
  // makes req.ip the real client IP (from X-Forwarded-For), which rate limiting depends on.
  app.set('trust proxy', 1);

  // Mounted before helmet: helmet's default Content-Security-Policy blocks Swagger UI's
  // scripts and styles, and the docs page holds no user data that needs those headers.
  app.use('/api/docs', docsRouter);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  app.use(
    pinoHttp({
      logger,
      // A fresh id per request ties together every log line for it, and the response header
      // lets someone reporting a problem quote the id.
      genReqId: (req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', createRateLimiter({ windowMs: 60 * 1000, limit: 300 }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
