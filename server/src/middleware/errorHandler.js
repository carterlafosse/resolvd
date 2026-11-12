// Final error handler: turns any thrown error into { error: { code, message, details? } }.
import { z, ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

// PostgreSQL error codes that come from bad client input rather than a server fault.
const PG_ERRORS = {
  23505: () => AppError.conflict('That record already exists'),
  23503: () =>
    AppError.badRequest('A referenced record does not exist', undefined, 'INVALID_REFERENCE'),
  '22P02': () => AppError.badRequest('A value has the wrong format', undefined, 'INVALID_INPUT'),
};

// Errors raised by express.json() (body-parser) before any route runs, keyed by their `type`.
// body-parser raises 415 only for an unsupported charset or content encoding.
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': () =>
    AppError.badRequest('Request body is not valid JSON', undefined, 'INVALID_JSON'),
  'entity.too.large': () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'),
  'charset.unsupported': () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body charset'),
  'encoding.unsupported': () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body encoding'),
};

function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return AppError.validation('Validation failed', z.flattenError(err));
  }
  if (typeof err?.type === 'string' && BODY_PARSER_ERRORS[err.type]) {
    return BODY_PARSER_ERRORS[err.type]();
  }
  if (typeof err?.code === 'string' && PG_ERRORS[err.code]) {
    return PG_ERRORS[err.code]();
  }
  // Anything unrecognised is a bug: the client gets a generic message, never internals.
  return AppError.internal();
}

// Express recognises error middleware only by its four parameters, so `next` must stay
// even though it's only used when the response has already started.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const appError = toAppError(err);

  if (appError.status >= 500) {
    // Log the original error (with stack) server-side; req.log carries the request id.
    (req.log ?? logger).error({ err }, 'Request failed');
  }

  const body = { code: appError.code, message: appError.message };
  if (appError.details !== undefined) body.details = appError.details;

  res.status(appError.status).json({ error: body });
}
