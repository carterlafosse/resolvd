// validate() middleware: replaces parsed parts, strips unknown keys, and passes Zod errors on.
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { validate } from '../../src/middleware/validate.js';

// Runs the middleware against a fake request and reports what it did.
function run(schemas, req) {
  let nextCalled = false;
  validate(schemas)(req, {}, () => {
    nextCalled = true;
  });
  return { req, nextCalled };
}

describe('validate', () => {
  it('replaces req.body with the parsed body and drops unknown keys', () => {
    const body = z.object({ name: z.string().trim() });
    const { req, nextCalled } = run({ body }, { body: { name: '  Ada ', role: 'admin' } });

    expect(nextCalled).toBe(true);
    expect(req.body).toEqual({ name: 'Ada' });
  });

  it('coerces params and puts the parsed query on req.validatedQuery', () => {
    const params = z.object({ id: z.coerce.number().int().positive() });
    const query = z.object({ role: z.enum(['admin', 'technician']).optional() });
    const raw = { role: 'admin', extra: 'x' };
    const { req } = run({ params, query }, { params: { id: '42' }, query: raw });

    expect(req.params).toEqual({ id: 42 });
    expect(req.validatedQuery).toEqual({ role: 'admin' });
    // The original query object is left alone (Express 5's req.query is read-only).
    expect(req.query).toBe(raw);
  });

  it('throws a ZodError (and never calls next) when input is invalid', () => {
    const body = z.object({ name: z.string().min(1) });

    expect(() => run({ body }, { body: { name: '' } })).toThrow(ZodError);
  });

  it('rejects a missing body when a body schema is given', () => {
    const body = z.object({ name: z.string() });

    expect(() => run({ body }, { body: undefined })).toThrow(ZodError);
  });
});
