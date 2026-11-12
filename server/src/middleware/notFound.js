// Catch-all for unmatched routes; hands a 404 to the error handler so the shape stays consistent.
import { AppError } from '../utils/AppError.js';

export function notFound(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));
}
