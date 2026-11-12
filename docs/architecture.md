# Resolvd architecture

How Resolvd is designed and why. Each phase adds to the relevant section.

## Overview

## Request flow

The API is an Express 5 app built by `createApp()` in `server/src/app.js`; `server/src/server.js` only listens and handles shutdown, so tests can use the app without opening a port.

Every request passes through this middleware, in order:

1. `trust proxy` (1 hop): in production, Render's load balancer sits in front, so `req.ip` comes from `X-Forwarded-For`. Rate limiting needs the real client IP.
2. Swagger UI at `/api/docs`, mounted **before** helmet because helmet's Content-Security-Policy would block Swagger UI's scripts and styles.
3. `helmet()`: security headers (CSP, no MIME sniffing, frame protection, and so on).
4. `cors`: only `CLIENT_ORIGIN` may call the API from a browser, with cookies (`credentials: true`).
5. `pino-http`: one log line per request, with a fresh UUID request id also returned in the `X-Request-Id` header. 4xx responses log as `warn`, 5xx as `error`.
6. `express.json({ limit: '100kb' })` and `cookieParser()`.
7. A general rate limit on `/api`: 300 requests per minute per IP.
8. Routers (`/api/health` so far; later phases add authentication and feature modules).
9. `notFound`, then `errorHandler`.

Feature code follows route → controller → service → queries. Services open `withOrg(orgId, work)` from `server/src/db/withOrg.js`: one transaction on one pooled connection, with `app.current_org_id` set transaction-locally. Every tenant query inside uses the `client` it's handed, because `pool.query` would run on another connection with no org set and RLS would hide every row.

### Errors

Anything thrown (or a rejected promise from an async handler, which Express 5 forwards automatically) reaches `errorHandler`, which always responds `{ error: { code, message, details? } }`:

| Source | Response |
| --- | --- |
| `AppError` | its own status, code, message and details |
| `ZodError` | 400 `VALIDATION_ERROR`, `details` = `z.flattenError(err)` (`formErrors`, `fieldErrors`) |
| body-parser | 400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` |
| Postgres `23505` / `23503` / `22P02` | 409 `CONFLICT` / 400 `INVALID_REFERENCE` / 400 `INVALID_INPUT` |
| anything else | 500 `INTERNAL_ERROR` with a generic message |

`AppError` has helpers with the signature `helper(message, details, code)`: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooManyRequests`, `validation`, `unprocessable`, `internal`, `serviceUnavailable`. These match ScreenGuide AI so the two projects can share error handling. Only 5xx errors are logged, with the full error and the request id; the client never sees stack traces, SQL or connection details.

### Health

`GET /api/health` runs `SELECT 1` through the pool: `200 { status: 'ok', database: 'up' }`, or `503 { status: 'degraded', database: 'down' }`. The pool's 5-second connection timeout keeps this fast when Postgres is down. Render uses this endpoint as its health check.

## Database

PostgreSQL 18, written as raw SQL in numbered migrations (`server/db/migrations/`). `npm run migrate` applies each pending file and records it in `schema_migrations` inside one transaction, so a failed migration leaves nothing half-built. Committed migrations are never edited; fixes go in a new file.

### Tables

- `organizations`: one row per tenant (company, school or club), plus the per-org ticket counter.
- `users`: everyone who signs in, with their role (`end_user`, `technician`, `admin`) and lockout fields. Emails are unique across all orgs, ignoring case.
- `categories`: each org's ticket categories.
- `sla_policies`: each org's response and resolution targets, one row per priority.
- `tickets`: the helpdesk tickets, numbered per org (RES-1001, ...), with SLA deadlines stored on the row.
- `ticket_comments`: public replies and internal staff notes on a ticket.
- `ticket_events`: the audit log, one row per change to a ticket. A NULL actor means the system made the change.
- `schema_migrations`: which migration files have been applied.

### Two database roles

| Role | Used by | Can do |
| --- | --- | --- |
| `resolvd_owner` | migrations, seeds | Owns every table and function |
| `resolvd_app` | the running API | Read and write rows only, and only through row-level security |

Row-level security doesn't apply to a table's owner, so if the API connected as the owner, RLS would do nothing. The API therefore connects as `resolvd_app`, which owns nothing. This is also least privilege: `resolvd_app` can't create, alter or drop tables, read `schema_migrations`, or insert organizations. A bug or a stolen API connection can't damage the schema.

### Row-level security

Every tenant table has a policy named `org_isolation`: `organization_id = current_org_id()`, used both to filter rows (`USING`) and to check writes (`WITH CHECK`). `current_org_id()` reads the `app.current_org_id` setting, which the API's `withOrg()` helper sets with `set_config(..., true)` at the start of each transaction. The `true` makes it transaction-local, so it can't leak to the next request that reuses the pooled connection.

If the setting is missing, `current_org_id()` is NULL, `organization_id = NULL` is never true, and **no rows are visible**. Forgetting to set the org fails closed, not open. `organizations` has its own policy, `org_self` (`id = current_org_id()`), so an org can only see its own row. `docs/rls-demo.sql` demonstrates all of this.

This is the second layer of tenant isolation. The first is that every service query also scopes by the signed-in user's org.

### Composite foreign keys

Each tenant table has `UNIQUE (organization_id, id)`, and references to other tenant rows include the org: for example `FOREIGN KEY (organization_id, category_id) REFERENCES categories (organization_id, id)`. A plain `category_id` foreign key would accept another org's category id. The composite one makes the database reject any ticket, comment or event that points at a row in a different organization. With the default `MATCH SIMPLE`, a NULL `category_id`, `assignee_id` or `actor_id` skips the check, which allows uncategorized and unassigned tickets and system events.

### SECURITY DEFINER functions

These run with the owner's rights, so they bypass RLS. Each does one narrow job that can't work under RLS. All use `SET search_path = public` so a caller can't substitute look-alike objects, and only `resolvd_app` may execute them.

- `auth_find_user_by_email(email)`: login has to find the user before it knows their org, and with no org set RLS would hide every user. Returns only what login needs.
- `auth_record_login_failure(user_id, max_attempts, lock_minutes)`: adds 1 to the failure count and locks the account at the limit. It's called on its own rather than inside the login transaction, because that transaction rolls back when login fails and would undo the count.
- `create_organization(name, slug)`: during sign-up the new org doesn't exist yet, so there's no org to set, and `resolvd_app` has no INSERT permission on `organizations`.

### Indexes

Besides primary keys and unique constraints: `users_email_lower_idx` (case-insensitive unique email), and on `tickets` the indexes `(organization_id, status)` and `(organization_id, assignee_id)` for queue filters. There is also a **partial** index on `(organization_id, resolution_due_at)` covering only tickets that aren't resolved or closed, because only open work has a deadline to check, so the index stays small. Comments and events are indexed on `(ticket_id, created_at)` for the activity feed.

## Security

- **Config fails fast.** `server/src/config/env.js` validates environment variables with Zod at startup and exits with a list of the bad keys (names and rules only, never values). `JWT_SECRET` must be at least 32 characters.
- **No internals in responses.** Unexpected errors become a generic 500; details go only to the server log.
- **No secrets in logs.** The logger redacts `Cookie`, `Authorization` and `Set-Cookie` headers.
- **Headers, CORS and rate limiting** as listed under Request flow.
- **Graceful shutdown.** On `SIGTERM` (Render deploys) or `SIGINT` (Ctrl+C) the server stops accepting connections, lets in-flight requests finish, closes the pool and exits, with a 10-second fallback.

## Background jobs

## Front end

## Deployment
