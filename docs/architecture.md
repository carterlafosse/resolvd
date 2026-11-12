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
8. Routers: `/api/health`, `/api/auth`, `/api/users`, `/api/categories`, `/api/tickets` (which mounts the comments router at `/api/tickets/:id/comments`). Inside a router, protected routes run `authenticate`, then `requireRole(...)`, then `validate(...)`, then the controller.
9. `notFound`, then `errorHandler`.

Feature code follows route → controller → service → queries.

- **`validate({ body, query, params })`** (`server/src/middleware/validate.js`) parses each part with Zod. The parsed values replace `req.body` and `req.params`; the parsed query goes on `req.validatedQuery` because Express 5's `req.query` is read-only. Zod object schemas drop keys they don't list, so a client can't sneak `role` or `organization_id` into a request (mass assignment).
- **Order matters:** `requireRole` runs before `validate`, so a caller without the role gets 403 whatever they send, rather than a validation error that would hint at the endpoint's shape.
- **Controllers** only read the request, call one service function and send the response.
- **Services** hold the rules (each service file lists them at the top) and open `withOrg`.
- **Queries** are plain SQL functions that take `client` first. Every query filters on `organization_id = current_org_id()`, and inserts set `organization_id = current_org_id()` in SQL, so the org always comes from the transaction's setting and never from request data.
- **Responses:** lists are `{ data: [...] }` (paginated lists add `pagination: { page, pageSize, total, totalPages }`); single records are the record itself; auth endpoints return `{ user, organization }`. Fields are snake_case as stored; request bodies are camelCase. Services open `withOrg(orgId, work)` from `server/src/db/withOrg.js`: one transaction on one pooled connection, with `app.current_org_id` set transaction-locally. Every tenant query inside uses the `client` it's handed, because `pool.query` would run on another connection with no org set and RLS would hide every row.

`withTransaction` (which `withOrg` uses) also handles a connection that dies mid-transaction:
- It rethrows the original error, not the failed `ROLLBACK`.
- It tells the pool to destroy the client rather than reuse it.
- While the client is checked out it listens for the client's `error` event. node-postgres only listens on idle clients, and an unhandled `error` on a checked-out client would crash the process.

### Errors

Anything thrown (or a rejected promise from an async handler, which Express 5 forwards automatically) reaches `errorHandler`, which always responds `{ error: { code, message, details? } }`:

| Source | Response |
| --- | --- |
| `AppError` | its own status, code, message and details |
| `ZodError` | 400 `VALIDATION_ERROR`, `details` = `z.flattenError(err)` (`formErrors`, `fieldErrors`) |
| body-parser | 400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` |
| Postgres `23505` / `23503` / `22P02` | 409 `CONFLICT` / 400 `INVALID_REFERENCE` / 400 `INVALID_INPUT` |
| anything else | 500 `INTERNAL_ERROR` with a generic message |

`AppError` has helpers with the signature `helper(message, details, code)`: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooManyRequests`, `validation`, `unprocessable`, `internal`, `serviceUnavailable`. They are meant to line up with ScreenGuide AI so the two projects can share error handling; that hasn't been confirmed against ScreenGuide's own `AppError` yet (see `docs/DECISIONS.md`). Only 5xx errors are logged, with the full error and the request id; the client never sees stack traces, SQL or connection details.

### Health

`GET /api/health` runs `SELECT 1` through the pool: `200 { status: 'ok', database: 'up' }`, or `503 { status: 'degraded', database: 'down' }`. The pool's 5-second connection timeout keeps this fast when Postgres is down. Render uses this endpoint as its health check.

### Tickets

`server/src/modules/tickets/`. The rules are listed at the top of `tickets.service.js`.

**Visibility.**
- End users see only tickets they requested; technicians and admins see every ticket in their org.
- The rule lives in `canView(user, ticket)`. The list and detail queries apply the same rule in SQL (`requester_id = $n`, added only for end users), so an end user's query never even loads another person's ticket.
- Anything the caller can't see is 404 "Ticket not found", exactly like an id that doesn't exist, so ids can't be probed. 403 is kept for "you can see it, but can't do this": an end user asking for critical priority, changing priority after creation, or editing a ticket that's no longer open.

**Ticket numbers.**
- Each org numbers its own tickets from 1001 (`organizations.next_ticket_number`), shown as `display_id` `RES-1001`, built in SQL.
- A number is claimed with one statement: `UPDATE organizations SET next_ticket_number = next_ticket_number + 1 ... RETURNING next_ticket_number - 1`.
- The `UPDATE` locks the org row until the transaction commits, so tickets created at the same moment queue up and each gets a different number. A separate `SELECT` then `UPDATE` would let two requests read the same value.

**The list query** (`GET /api/tickets`) is built from optional filters without ever putting request data into SQL text:
- `buildTicketFilters` adds fixed SQL fragments such as `t.status = ANY($2::ticket_status[])`. Each value is pushed into the parameter array, and only its placeholder goes into the SQL.
- `sort` and `order` are checked by the Zod enum, then mapped through a whitelist (`SORT_COLUMNS`) to fixed column names. Column names can't be parameters, so they must come from our own code. `sort=title;DROP TABLE tickets` fails validation with 400.
- `ORDER BY <col> <dir> NULLS LAST, t.id DESC`: tickets without a deadline sort last, and the id breaks ties so pages never overlap or skip rows.
- `COUNT(*) OVER()` returns the number of matching rows on every row, computed before `LIMIT`/`OFFSET`, so one query gives both the page and the total. A page past the end has no rows to carry it, so that rare case runs a separate count.
- Search matches `title ILIKE '%text%'` (with `%`, `_` and `\` escaped so they match literally), or the exact ticket number when the text is `RES-1003`, `res-1003` or `1003`.
- Priority sorts by severity because `ticket_priority` is an enum, and enums sort in declaration order.
- Joined names (`category_name`, `requester_name`, `assignee_name`) save the front end a lookup per row. Queue rows leave out `description`.

**Updates** (`PATCH /api/tickets/:id`):
- `loadTicketForUpdate` locks the row (`SELECT ... FOR UPDATE OF t`) and returns 404 unless `canView`. Phase 5's status, assignment, priority and comment services start the same way.
- With the lock, concurrent edits run one after another, and each sees the previous result. A test fires three edits at once and checks that each title event's old value is the previous event's new value.
- Optimistic locking: the client may send `expectedUpdatedAt` (the `updated_at` it loaded). If the row has changed since, the API answers 409 instead of silently overwriting someone else's edit. The lock covers changes at the same instant; this covers someone editing a copy they loaded minutes ago.
- Only fields whose value really changes are written. Each one gets a `ticket_events` row (old and new value as text, category by name) in the same transaction, so the history can't disagree with the ticket.

### Workflow, assignment and comments

**Status workflow** (`server/src/modules/tickets/workflow.js`). The rules are pure functions with no database code:
- `canTransition({ ticket, to, user, now })` returns `{ ok, reason }`. `now` is passed in rather than read inside, so the 7-day reopen window is tested with a fixed clock.
- `statusChangeEffects({ from, to, now })` says which timestamps a move sets: resolving sets `resolved_at`, reopening a resolved ticket clears it, closing sets `closed_at`.
- Because they're pure, every row of the workflow table is unit tested in milliseconds, and Phase 8 can call `canTransition` for each status to tell the front end which buttons to show.

| From | Staff may move to | The requester may move to |
| --- | --- | --- |
| open | in_progress, on_hold, resolved | (nothing) |
| in_progress | on_hold, resolved, open | (nothing) |
| on_hold | in_progress, resolved | (nothing) |
| resolved | closed, open | closed (confirm the fix); open within 7 days of `resolved_at` |
| closed | (final) | (final) |

A refused move is 400 `INVALID_TRANSITION` with the reason as the message. The plan asks for 400 here (not 403) because the reason, not the role, is what the user needs to read: "Tickets can only be reopened within 7 days..." explains more than "Forbidden".

**Every write follows the same steps** (status, assignment, priority, comments):
1. `loadTicketForUpdate` locks the ticket row with `SELECT ... FOR UPDATE` and returns 404 unless the caller can see it.
2. The rules are checked against that locked row.
3. The change and its `ticket_events` rows are written in the same transaction.

The lock is what keeps history consistent under concurrency. Two requests changing the same ticket queue up: the second waits for the first to commit, then reads the new status. Without it, both could read `in_progress`, both decide `resolved` is allowed, and the log would show two `in_progress -> resolved` events. The tests send the same move five times at once (exactly one succeeds, one event), and two competing moves (each event starts where the previous one ended, and the final status matches the last event).

**Automatic status moves** reuse `writeStatusChange`, which writes the status and its event without checking who may make the move:
- Assigning an `open` ticket moves it to `in_progress`, recorded as the person who assigned it.
- A public reply from the requester on an `on_hold` ticket moves it to `in_progress`, recorded as the requester. On hold usually means "waiting for the requester", so their reply is how they ask for work to resume. They can't make that move through `PATCH /status`, because it's a staff move there.

**Assignment.** Staff only (`requireRole`). The assignee must be an active technician or admin in the same org. The lookup uses `SELECT ... FOR SHARE` on that user, so an admin can't deactivate or demote them until the assignment commits. The `assignee` event stores **names**, not ids (`Unassigned` for none). The history can be shown without joining to `users`, and it records who the ticket went to as they were named at the time, even if the user is later renamed or deactivated. `ticket_events` also has a single `old_value`/`new_value` text pair for every kind of change, so a name fits the same shape as a status or priority.

**Comments** (`server/src/modules/comments/`, mounted at `/api/tickets/:id/comments`):
- Internal notes are staff-only. End users never receive them: the comments query has `AND ($2 OR NOT is_internal)`, so they're filtered in SQL. A JavaScript filter after the query could be forgotten on a new code path; a note that never leaves the database can't leak.
- End users can't post internal notes (403). Nobody comments on a closed ticket (400): a problem that comes back gets a new ticket.
- The first **public** staff comment sets `first_response_at` (Phase 6's response SLA). An internal note doesn't count, because the requester hasn't heard anything. The ticket row is locked while commenting, so two simultaneous replies can't both count as the first.

**History endpoints.**
- `GET /:id/events` lists the audit log newest first, with `actor_name` (`System` when `actor_id` is NULL). End users see only `created` and `status` events (`PUBLIC_EVENT_FIELDS`), filtered in SQL.
- `GET /:id/activity` is the feed for the ticket page. One `UNION ALL` query merges comments and events into one shape (`type, id, actor_name, body, field, old_value, new_value, is_internal, created_at`), oldest first, with the same visibility filters. Events written in one transaction share a timestamp, so ties sort comments before events, then by id. A reply therefore appears before the status change it caused.

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

Every tenant table has a policy named `org_isolation`: `organization_id = current_org_id()`, used both to filter rows (`USING`) and to check writes (`WITH CHECK`). `current_org_id()` reads the `app.current_org_id` setting, which the API's `withOrg()` helper sets with `set_config(..., true)` at the start of each transaction. The `true` makes it transaction-local, so it can't leak to the next request that reuses the pooled connection. `setOrg` refuses anything but a positive integer and throws before querying, so a bug can never run a transaction with a missing or malformed org.

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

### Sessions

Login and sign-up set a cookie named `resolvd_token` holding a JWT `{ sub: userId, org: orgId }` signed with `JWT_SECRET` (HS256, 8 hours). Both names are shared with ScreenGuide AI.

| Cookie flag | Why |
| --- | --- |
| `httpOnly` | Page JavaScript can't read it, so an XSS bug can't steal the session (unlike a token in `localStorage`). |
| `secure` (production) | Only sent over HTTPS. |
| `sameSite: 'lax'` | Not sent on cross-site POST/PATCH requests, which blocks CSRF from other websites. Normal links into the app still carry it. |
| `path: '/'`, `maxAge` 8 h | Matches the token's lifetime. Logout clears it with the same options, because browsers only delete a cookie when they match. |

`authenticate` (`server/src/middleware/auth.js`) handles every protected request:
1. It verifies the token, accepting only HS256.
2. It loads the user **from the database** inside `withOrg(payload.org)`.
3. It rejects the request with 401 if that user is missing or inactive.
4. It sets `req.user = { id, orgId, role, name, email }`.

The role is never read from the token. Demoting or deactivating someone therefore takes effect on their very next request, even though their cookie is still valid. The cost is one indexed lookup per request.

`requireRole(...roles)` returns 403 when the role isn't allowed. It's used only where the caller can see the thing but can't act on it. Records in another org, or ones the caller isn't allowed to see, are 404, so their existence isn't revealed.

### Login and lockout

1. **Find the user.** `auth_find_user_by_email` (SECURITY DEFINER) runs on the pool, because the user's org isn't known yet.
2. **Unknown email or inactive account:** `bcrypt.compare` still runs, against a dummy hash generated at startup, then the API returns 401 `INVALID_CREDENTIALS`. Every "no" takes about the same ~250 ms, so timing doesn't reveal which emails are registered.
3. **Locked** (`locked_until` in the future): 401 `ACCOUNT_LOCKED`. This is checked before the password, so guesses made during the lock can never succeed.
4. **Wrong password:** `auth_record_login_failure(id, 5, 15)` runs as its own autocommit statement, then 401 `INVALID_CREDENTIALS`. The fifth failure locks the account for 15 minutes and resets the counter.
   - **Why it runs on its own:** if the counter were updated inside the transaction that then throws the 401, the rollback would undo it and the lockout would never trigger.
5. **Correct password:** inside `withOrg`, reset the counter and lock, set `last_login_at`, and issue the cookie.

Two limits work together:
- The **per-account lockout** stops many IPs guessing one account.
- The **per-IP login rate limit** (10 attempts per 15 minutes) stops one IP guessing across many accounts.

Sign-up has its own per-IP limit of 5 attempts per hour (rejected ones count too), because each real sign-up creates an organization and runs bcrypt.

### Passwords

- Hashed with bcryptjs at cost 12.
- Rules: 10 to 72 characters (and at most 72 bytes, because bcrypt ignores anything after that), with at least one letter and one number.
- Login itself checks only that a password was sent; the rules are not revealed at login.
- Hashing happens before a transaction opens, so slow bcrypt work doesn't hold a pooled connection.
- `password_hash` is never selected into an API response: queries use an explicit column list.

### Users and admins

- Technicians can list users, but only see `id, name, role` (for assignment). Admins see full records.
- An admin can't demote or deactivate themselves.
- The org always keeps at least one active admin. Any change to a role or active flag first locks **every active admin row in id order** (`SELECT ... FOR UPDATE`), then the target row.
  - **Why:** two admins demoting each other at the same moment must run one after the other, so the second sees the first's change and is refused (`LAST_ADMIN`).
  - Locking only the target row wouldn't stop this, because each request would lock a different row.
  - Locking in a fixed order means two requests can't deadlock.

### Other protections

- **Config fails fast.** `server/src/config/env.js` validates environment variables with Zod at startup and exits with a list of the bad keys (names and rules only, never values). `JWT_SECRET` must be at least 32 characters.
- **No internals in responses.** Unexpected errors become a generic 500; details go only to the server log.
- **No secrets in logs.** The logger redacts `Cookie`, `Authorization` and `Set-Cookie` headers.
- **Headers, CORS and rate limiting** as listed under Request flow.
- **Graceful shutdown.** On `SIGTERM` (Render deploys) or `SIGINT` (Ctrl+C) the server stops accepting connections, lets in-flight requests finish, closes the pool and exits, with a 10-second fallback.

## Background jobs

## Front end

## Deployment
