// AppError: an expected error carrying the HTTP status and code the error handler sends to clients.
// Helper names and signatures are meant to line up with ScreenGuide AI's AppError so the two
// codebases can share error handling later. They have not been confirmed identical yet; known
// differences and open questions are listed in docs/DECISIONS.md (Phase 2).
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details, code = 'BAD_REQUEST') {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', details, code = 'UNAUTHORIZED') {
    return new AppError(401, code, message, details);
  }

  static forbidden(message = 'You do not have permission to do that', details, code = 'FORBIDDEN') {
    return new AppError(403, code, message, details);
  }

  static notFound(message = 'Not found', details, code = 'NOT_FOUND') {
    return new AppError(404, code, message, details);
  }

  static conflict(message = 'Conflict', details, code = 'CONFLICT') {
    return new AppError(409, code, message, details);
  }

  static tooManyRequests(
    message = 'Too many requests. Try again later.',
    details,
    code = 'TOO_MANY_REQUESTS',
  ) {
    return new AppError(429, code, message, details);
  }

  // Input that fails a schema. 400, like Zod errors, so clients handle one validation code.
  static validation(message = 'Validation failed', details, code = 'VALIDATION_ERROR') {
    return new AppError(400, code, message, details);
  }

  // Well-formed input that breaks a business rule the request can't satisfy.
  static unprocessable(message = 'Unprocessable request', details, code = 'UNPROCESSABLE') {
    return new AppError(422, code, message, details);
  }

  static internal(message = 'Something went wrong', details, code = 'INTERNAL_ERROR') {
    return new AppError(500, code, message, details);
  }

  static serviceUnavailable(
    message = 'Service temporarily unavailable',
    details,
    code = 'SERVICE_UNAVAILABLE',
  ) {
    return new AppError(503, code, message, details);
  }
}
