// Builds express-rate-limit middleware with the settings every Resolvd limiter shares.
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

// Counts requests per client IP (req.ip, which relies on the app's trust proxy setting).
export function createRateLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    // Standard RateLimit / RateLimit-Policy headers, without the legacy X-RateLimit-* ones.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Send 429s through the error handler so they share the standard error shape.
    handler: (req, res, next) => next(AppError.tooManyRequests(message)),
  });
}
