// Error handling: body-parser failures through the real app, and each error mapping via a small app.
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError } from '../../src/utils/AppError.js';

afterAll(() => pool.end());

describe('request body errors (real app)', () => {
  const app = createApp();

  it('maps malformed JSON to 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('maps a body over 100kb to 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/health')
      .send({ text: 'x'.repeat(110 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps an unsupported charset to 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('maps an unsupported content encoding to 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'not-a-real-encoding')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('errorHandler mappings', () => {
  // A throwaway app whose async routes throw each kind of error. This also proves Express 5
  // forwards rejected promises from async handlers to the error handler.
  function appThrowing(makeError) {
    const app = express();
    app.get('/boom', async () => {
      throw await makeError();
    });
    app.use(errorHandler);
    return app;
  }

  async function errorFor(makeError) {
    const res = await request(appThrowing(makeError)).get('/boom');
    return { status: res.status, body: res.body };
  }

  it('sends an AppError with its status, code, message and details', async () => {
    const result = await errorFor(() =>
      AppError.conflict('Ticket changed', { field: 'status' }, 'TICKET_CHANGED'),
    );

    expect(result).toEqual({
      status: 409,
      body: {
        error: { code: 'TICKET_CHANGED', message: 'Ticket changed', details: { field: 'status' } },
      },
    });
  });

  it('omits details when there are none', async () => {
    const { body } = await errorFor(() => AppError.forbidden());

    expect(body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do that' },
    });
  });

  it('maps a ZodError to 400 VALIDATION_ERROR with flattened details', async () => {
    const schema = z.object({ email: z.email(), title: z.string().min(5) });
    const { status, body } = await errorFor(() => {
      const parsed = schema.safeParse({ email: 'nope', title: 'abc' });
      return parsed.error;
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.formErrors).toEqual([]);
    expect(Object.keys(body.error.details.fieldErrors).sort()).toEqual(['email', 'title']);
  });

  it('maps a real Postgres 22P02 error to 400 INVALID_INPUT', async () => {
    const { status, body } = await errorFor(async () => {
      try {
        await pool.query("SELECT 'not-a-number'::int");
      } catch (err) {
        return err;
      }
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it.each([
    ['23505', 409, 'CONFLICT'],
    ['23503', 400, 'INVALID_REFERENCE'],
  ])('maps Postgres %s to %i %s', async (pgCode, status, code) => {
    // Shaped like a pg DatabaseError; the real constraint violations are tested in later phases.
    const result = await errorFor(() =>
      Object.assign(new Error('violates constraint'), { code: pgCode }),
    );

    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });

  it('hides the details of unexpected errors behind 500 INTERNAL_ERROR', async () => {
    const { status, body } = await errorFor(() => new Error('connection string with secrets'));

    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });
});
