// Zod schemas for database ids, shared by every module so each id is checked the same way.
import { z } from 'zod';

// Every id column is a PostgreSQL INT (SERIAL). A larger number would reach Postgres and fail
// with "value out of range" (22003), which surfaces as a 500. Capping here makes it a 400.
export const PG_INT_MAX = 2147483647;

// For path and query parameters, which always arrive as text: "42" -> 42.
export const idParam = z.coerce.number().int().positive().max(PG_INT_MAX);

// For ids in JSON bodies, which must already be numbers.
export const idValue = z.number().int().positive().max(PG_INT_MAX);

// { id } from /:id routes.
export const idParams = z.object({ id: idParam });
