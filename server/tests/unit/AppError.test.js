// AppError helpers: each returns the right status and default code, and accepts overrides.
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/AppError.js';

describe('AppError helpers', () => {
  it.each([
    ['badRequest', 400, 'BAD_REQUEST'],
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['notFound', 404, 'NOT_FOUND'],
    ['conflict', 409, 'CONFLICT'],
    ['tooManyRequests', 429, 'TOO_MANY_REQUESTS'],
    ['validation', 400, 'VALIDATION_ERROR'],
    ['unprocessable', 422, 'UNPROCESSABLE'],
    ['internal', 500, 'INTERNAL_ERROR'],
    ['serviceUnavailable', 503, 'SERVICE_UNAVAILABLE'],
  ])('%s() gives %i %s with a default message', (helper, status, code) => {
    const err = AppError[helper]();

    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toEqual(expect.any(String));
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.details).toBeUndefined();
  });

  it('takes (message, details, code) in that order', () => {
    const err = AppError.badRequest('Slug is taken', { field: 'slug' }, 'SLUG_TAKEN');

    expect(err.status).toBe(400);
    expect(err.message).toBe('Slug is taken');
    expect(err.details).toEqual({ field: 'slug' });
    expect(err.code).toBe('SLUG_TAKEN');
  });
});
