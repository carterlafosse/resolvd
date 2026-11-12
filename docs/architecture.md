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
8. Routers: `/api/health`, `/api/auth`, `/api/users`, `/api/categories`, `/api/tickets` (which mounts the comments router at `/api/tickets/:id/comments`), `/api/sla-policies`. Inside a router, protected routes run `authenticate`, then `requireRole(...)`, then `validate(...)`, then the controller.
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

**Allowed actions on the detail response.** `GET /api/tickets/:id` adds three fields for the viewer:
- `allowedTransitions`: `allowedTransitions({ ticket, user, now })` in `workflow.js` asks `canTransition` about every status and keeps the ones that pass.
- `canEdit`: the same `canEdit(user, ticket)` that `PATCH /:id` checks (staff until closed, the requester while open).
- `canComment`: the same "not closed" rule the comments endpoint checks.

The front end shows only these options instead of keeping its own copy of the workflow table. One copy of the rules means the buttons can't drift from what the API accepts (for example the 7-day reopen window, which depends on the server's clock). The API still checks every request, so these fields are for display, not security. Only the detail carries them: list rows and write responses don't, and the front end refetches the detail after a change.

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

### SLAs

`server/src/modules/sla/`. Each org has an `sla_policies` row per priority: minutes until the first response is due, and minutes until resolution is due. The defaults are critical 1 h / 4 h, high 4 h / 1 day, medium 8 h / 2 days, low 1 day / 5 days.

**Decisions:**
- **24/7 calendar time.** Nights, weekends and `on_hold` don't pause the clocks. Business hours would need a calendar per org (time zones, holidays); calendar time is simple to explain and to check by hand.
- **Deadlines are anchored to `created_at`.** Changing the priority recalculates both deadlines from the original `created_at`, so raising a ticket to critical doesn't give it a fresh hour, and lowering it doesn't restart the clock.
- **Deadlines are stored on the ticket** (`response_due_at`, `resolution_due_at`), not calculated from the current policy on every read. An admin editing a policy only affects tickets created afterwards and later priority changes; nobody's deadline moves under them, and old tickets are still judged by the promise made when they were opened. Stored deadlines can also be indexed and sorted on.
- **The response clock is met by the first public staff reply** (`first_response_at`). An internal note doesn't count: the requester hasn't heard anything. Resolving also counts as the first response if nobody replied before it, because only staff can resolve and "this is fixed" is a reply; otherwise a ticket resolved without a comment would show its response clock running, and breaching, after the work was done.
- **The resolution clock is met by `resolved_at`.** Reopening clears `resolved_at`, so the clock runs again against the same deadline.
- **At risk** means less than 25% of the clock's window is left. **Breached** means past the deadline while running, or completed late. A late resolution stays breached afterwards; it isn't "met".

**Pure functions** (`sla.js`, no database code, unit tested with fixed times):
- `computeDueDates(createdAt, policy)` returns `{ responseDueAt, resolutionDueAt }`.
- `clockState({ startAt, dueAt, completedAt, now })` returns `met`, `breached`, `at_risk`, `on_track` or `none` (no deadline).
- `slaSummary(ticket, now)` returns `{ response, resolution, overall }`, where `overall` is the more severe clock: breached > at_risk > on_track > met > none. A met response with the resolution still on track is `on_track`, because work remains.

**Wiring.**
- Creating a ticket inserts it, then sets the deadlines from the `created_at` the database returned and the org's policy, in the same transaction.
- A priority change (`PATCH /:id/priority`, or staff changing it through `PATCH /:id`) recalculates both deadlines and writes `response_due_at` / `resolution_due_at` events (old and new ISO timestamps) next to the `priority` event.
- Every ticket the API returns carries `sla: slaSummary(ticket, now)`. A list request uses one `now` for its filter and every row, so a row can't be filtered as at risk and summarised as breached.

**Queue filters** (`GET /api/tickets?sla=breached|at_risk`). `slaClockSql()` in `tickets.queries.js` writes the same rules as `clockState` in SQL, with the request's `now` as a parameter: breached if any clock is breached; at risk if no clock is breached and a running clock has less than 25% of its window left (`due - now < (due - created_at) * 0.25`). The filter returns exactly the tickets whose `sla.overall` is that value, and a test checks it over a queue with one ticket in each state.

**Policies admin.** `GET /api/sla-policies` (staff) lists the four policies, critical first. `PUT /api/sla-policies/:priority` (admin) takes `{ responseMinutes, resolutionMinutes }`: whole minutes from 5 to 90 days, response shorter than resolution (Zod, backed by the table's `CHECK`). It's an upsert, so PUT sets the policy whether or not the row exists.

## Database

PostgreSQL 18, written as raw SQL in numbered migrations (`server/db/migrations/`). `npm run migrate` applies each pending file and records it in `schema_migrations` inside one transaction, so a failed migration leaves nothing half-built. Committed migrations are never edited; fixes go in a new file.

### Tables

- `organizations`: one row per tenant (company, school or club), plus the per-org ticket counter.
- `users`: everyone who signs in, with their role (`end_user`, `technician`, `admin`) and lockout fields. Emails are unique across all orgs, ignoring case.
- `categories`: each org's ticket categories.
- `sla_policies`: each org's response and resolution targets, one row per priority.
- `tickets`: the helpdesk tickets, numbered per org (RES-1001, ...), with SLA deadlines stored on the row and, from migration 008, `response_breached_at` / `resolution_breached_at` (when the SLA job recorded each breach).
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
- `mark_sla_breaches()`: the SLA job checks every org at once with no org set, so under RLS it would see no tickets. See Background jobs.

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

### SLA breach checker

`server/src/jobs/slaChecker.js` runs every 5 minutes with node-cron. `server.js` starts it (except when `NODE_ENV=test`) and stops it on shutdown, before the pool closes.

Each run calls one database function, `mark_sla_breaches()` (migration 008), which records every new breach in every org and returns `(ticket_id, org_id, clock)` per breach. It runs two statements, response then resolution. Each is a CTE that does `UPDATE tickets SET <clock>_breached_at = NOW() WHERE <clock>_breached_at IS NULL AND <clock is breached> RETURNING ...` and, in the same statement, inserts an `sla_breach` event (`new_value` `response` or `resolution`, `actor_id` NULL, shown as "System") for each returned row. It's two statements because one statement can't update the same row twice: a ticket that breached both clocks would only get one of the two updates.

**Idempotent.** Running the check again changes nothing that's already recorded: the `breached_at IS NULL` condition skips any clock whose breach is already saved. That matters because the job runs on a timer. If a run is retried, overlaps another, or the server restarts in the middle, the worst case is that the next run finds the same breaches already marked and does nothing. Without it, every run would add another `sla_breach` event (and, from v2, another email) for the same breach. Even two runs at the same instant are safe: the second `UPDATE` waits for the first's row locks, re-checks `breached_at IS NULL`, and skips those rows. Tests run the check twice in a row and twice in parallel and expect one event.

**Why a SECURITY DEFINER function.** The API connects as `resolvd_app`, which only sees rows for the org set with `withOrg`. The job works across all orgs with no org set, so as `resolvd_app` it would see nothing. The function runs with the owner's rights for exactly this one job, with a pinned `search_path`, and only `resolvd_app` may execute it. The alternative, looping over every org with `withOrg`, would be one transaction per org every 5 minutes for the same result.

**Never crashes the server.** The scheduled wrapper, `runScheduledSlaCheck`, catches and logs any error (the next run tries again), and an overlap guard skips a run while the previous one is still going, so a slow database can't pile up connections. Tests call `runSlaCheck()` directly instead of waiting for the timer.

**Priority changes after a breach.** `*_breached_at` belongs to the deadline that was breached. If a priority change moves a deadline so it's no longer breached, the mark is cleared, so the job can record a breach of the new deadline later; if the new deadline has passed too, the mark stays and nothing is recorded twice. The old `sla_breach` event stays in the history either way.

Recording a breach updates the ticket row, so its `updated_at` changes (the `set_updated_at` trigger). That's deliberate: the ticket did change, and a client holding an older copy should reload before editing.

## Front end

React (Vite) in `client/`, with Mantine for components, React Router for pages and TanStack Query for server data.

### One origin

The browser only ever talks to the front end's own origin. In development Vite forwards `/api` to `http://localhost:4000` (`client/vite.config.js`); in production a Vercel rewrite forwards `/api` to Render (Phase 10). So:
- The `resolvd_token` cookie is a first-party cookie. Browsers that block third-party cookies (Safari, and Chrome's settings) still send it.
- There are no cross-origin requests, so no CORS preflights. The API's CORS setting is a fallback, not something the app relies on.

### Talking to the API

Every request goes through `client/src/api/client.js`: `api(path, { method, body, query })`.
- Paths are relative to `/api`; `credentials: 'include'` sends the cookie.
- Empty query values are left out and arrays are sent comma-separated (`status=open,on_hold`).
- Any failure becomes an `ApiError(status, code, message, details)`. The API's `{ error: { code, message, details } }` body is used as is. A response without that shape (for example the proxy's error page when the API isn't running) gets a generic message, and a request that never reached a server is status 0 `NETWORK_ERROR`.
- `error.fieldErrors` turns the API's `{ fieldErrors: { slug: ['...'] } }` into `{ slug: '...' }`, ready for a form.

The files `api/auth.js`, `tickets.js`, `users.js`, `categories.js` and `sla.js` are one-line wrappers per endpoint, so components never build URLs.

### Server state with TanStack Query

`client/src/main.jsx` creates one `QueryClient`:
- **Retries:** once, and only for network or 5xx errors. A 4xx answer would be the same the second time.
- **Refetch on window focus:** coming back to the tab refreshes stale data, so a queue left open doesn't go out of date.
- **Mutation errors** are shown in one place: a red notification with the API's message. Forms that put errors next to their fields (sign-in and sign-up) set `meta: { inlineErrors: true }` and skip it.
- **Expired sessions:** a 401 from any query (or any mutation without `inlineErrors`) removes all cached data and sets the session to signed out, which sends the user to `/login`.

Compared with `useEffect` + `fetch` in each component, the query cache gives shared data between components, loading and error states, request de-duplication, cancellation and refetching for free.

### The session

`client/src/auth/useAuth.js` holds the session in the `['me']` query (`GET /api/auth/me`):
- A 401 resolves the query to `null` ("not signed in") instead of an error, so it never triggers the global 401 handler.
- Sign-in and sign-up return `{ user, organization }`, the same shape as `/me`, so `startSession` puts the response straight into the cache.
- `startSession` and `endSession` both remove every other cached query first, so nothing loaded for one user is shown to the next one in the same tab.
- `logout()` calls the API first and only clears the session when that succeeds. If the API can't be reached, the cookie would still be in the browser, so the app doesn't pretend the user signed out.
- `isStaff` and `isAdmin` come from the role the API returned. The page never stores a role of its own.

### Routes and guards

| Path | Who |
| --- | --- |
| `/login`, `/register` | Public (a signed-in user is sent to `/tickets`) |
| `/`, `/tickets`, `/tickets/new`, `/tickets/:id` | Signed in, inside `AppLayout` |
| `/admin/users`, `/admin/categories`, `/admin/sla` | Admins |
| anything else | 404 page, inside the shell |

- `RequireAuth` shows a loader while `['me']` loads, an error with "Try again" if the API can't be reached, and otherwise redirects a signed-out visitor to `/login` with `state.from`, so signing in returns them to the page they asked for.
- `RequireRole` shows a "You don't have access" message.
- **Guards are only for a smooth experience.** Anyone can change the JavaScript in their own browser. The API checks the session and role on every request, so a bypassed guard only shows a page whose requests fail with 401 or 403.

### Layout and styling

- `AppLayout` is a Mantine `AppShell`: header with the brand, organization name, light/dark toggle and user menu (name, role, sign out); navbar with Tickets, New ticket and, for admins, an Admin section. Below the `sm` breakpoint the navbar collapses behind a burger button.
- Colour scheme follows the operating system until the user picks one; Mantine remembers the choice in `localStorage`.
- Labels and colours for statuses, priorities and roles live in `client/src/constants.js`, so every badge and select agrees.
- Every component has the same layout: a header comment, then `State`, `Data`, `Handlers` and `Render` sections. Styling is Mantine props first, with a small CSS module beside a component when needed.

### Sign-up form

- The URL name (slug) is suggested from the organization name (`features/auth/slug.js`: lowercase, accents removed, other characters become hyphens, at most 50 characters) until the user edits it. Clearing it turns the suggestion back on.
- The form checks the same rules as the API before sending. Sign-up is limited to 5 attempts per IP per hour and rejected attempts count, so a typo shouldn't use one up.
- Field errors from the API (for example "That URL name is taken") appear under the matching input.

### Ticket queue

`features/tickets/TicketQueuePage.jsx`, with the filter rules as pure functions in `queueFilters.js`.
- **Filters live in the URL** (`tab`, `status`, `priority`, `q`, `sort`, `order`, `page`, read with `useSearchParams`). A view can be bookmarked or shared, the back button undoes a filter change, and a refresh keeps the view. The URL is the only copy of the filters, so the page can't show one thing while requesting another. Unknown values fall back to the defaults, and any change except paging returns to page 1.
- **Tabs** are fixed views. Staff: My tickets, Unassigned, All open, Breached (each showing active statuses: open, in progress, on hold) and All tickets. End users: Open (including resolved, waiting for their confirmation) and Closed. The status filter narrows the tab's statuses.
- **Search** updates the box immediately and the URL 300 ms after typing stops (`useDebouncedCallback`), so typing "printer" sends one request, not seven.
- **Default sort:** staff by resolution deadline, soonest first; end users newest first. Sortable headers are the columns the API can sort.
- **`keepPreviousData`** keeps the current page on screen while the next one loads; skeletons only show on the first load.
- Below the `md` breakpoint the table becomes a list of cards, each one a single link.

### Ticket page

`TicketDetailPage` loads `GET /tickets/:id` and then `/activity`, and is made of `TicketHeader`, `ActivityFeed`, `CommentBox` and `TicketSidebar`.
- **Options come from the API.** The status select lists only `allowedTransitions`; end users on a resolved ticket get "Yes, it's fixed" and "Still having this issue" instead. Edit appears only with `canEdit`, and the reply box is disabled without `canComment`. The workflow rules live in one place (the API), so the page can't offer a move the API would refuse.
- **After any change, `invalidateQueries(['tickets'])`** marks every ticket query stale and refetches the ones on screen: the ticket (new status, deadlines and allowed actions), its activity feed and any queue. `useTicketMutation` does this for every ticket mutation and waits for the refetch before the control is usable again.
- **Edit conflicts:** the edit form sends the `updated_at` from when editing started as `expectedUpdatedAt`. A 409 shows "This ticket was changed by someone else" with a Reload button.
- Internal notes are yellow cards marked "Internal"; events are one-line sentences (`activityText.js`).
- A missing ticket (404, or 400 for a malformed id) shows a "Ticket not found" page.

### Admin pages

- **Users:** a table with a role select and an active switch per row, and an Add user modal. Your own row is locked (the API refuses self-demotion anyway). The API's errors, such as removing the last admin, appear as notifications, and the controls always show the saved value.
- **Categories:** add at the top, rename inline (Enter saves, Escape cancels).
- **SLA policies:** one row per priority, entered in hours or days and saved as minutes. The page notes that changes apply to new tickets and to priority changes, because deadlines are stored on each ticket.

### Polish

- Every page sets the tab title with `usePageTitle` ("RES-1042 · Resolvd").
- Icon-only buttons have an `aria-label` (theme toggle, menu, rename, save and cancel, pagination arrows).
- Relative dates ("3 hours ago") show the full date in a tooltip (`components/RelativeTime.jsx`).
- Custom colours use `light-dark()` in CSS modules, so internal notes, hover states and dividers work in both colour schemes.

### Tests

Vitest with jsdom and React Testing Library (`client/src/**/*.test.js(x)`). `fetch` is replaced per test, so no API is needed. They cover the API client's error parsing, the slug generator, the route guards and admin navigation, signing in and returning to the requested page, the sign-up form, the badges and SLA wording, the queue filters and the requests the queue sends, the new ticket form, the ticket page (allowed actions, internal notes, closed tickets, the 409 reload), the activity sentences, and the admin pages.

## Testing and CI

### Server tests

Vitest and Supertest against a real PostgreSQL database, `resolvd_test`. The database is never mocked: row-level security, composite foreign keys, row locks and constraint errors only behave like production in a real database.

- **Setup.** `server/.env.test` (from `.env.test.example`) points both connections at `resolvd_test`. `tests/globalSetup.js` runs once per run: it refuses any database whose name doesn't end in `_test` (the seed truncates every table), then runs the migrations and the seed. Test files run one at a time (`fileParallelism: false`) because they share the database.
- **Data.** The seed's Acme and Globex users are imported from `server/db/seeds/users.js`, so tests and seed can't disagree. Tests that need exact numbers (ticket numbers from 1001, an empty queue) sign up their own organization with `registerOrg()` or `setUpOrg()`. Tests that lock or deactivate accounts create their own users through the owner connection.
- **Unit tests** (`tests/unit/`) cover the pure rules: the workflow table, SLA clocks, pagination, search parsing, id limits, validation and errors. They need no database and run in milliseconds.
- **Integration tests** (`tests/integration/`) send real HTTP requests to `createApp()` for each module, and check the database through the owner connection where the API can't show the effect (events, lock counters).
- `npm run test:coverage` reports coverage (`server/coverage/index.html`). No minimum is enforced.

### The suites that guard the important promises

- **Isolation** (`isolation.test.js`). Signed in as Globex's admin, every endpoint that takes an id is called with Acme's ids. Each must return 404, identical to the answer for an id that doesn't exist, and the Acme rows must be unchanged. Globex's lists (every role, every page, searches for Acme's ticket number) contain no Acme rows, and assignment across organizations is refused in both directions.
- **Raw RLS.** The same file connects with `pg` as `resolvd_app` and queries the tables with no `WHERE organization_id` at all. With no org set, every tenant table is empty; inside a transaction that sets Acme, exactly Acme's rows appear (compared with the owner's count) and nothing of Globex's, even with `WHERE organization_id = <Globex>`; after the transaction, nothing again. Updates, deletes and inserts aimed at the other organization touch nothing or fail. Because these queries bypass the services, they prove the database enforces isolation on its own: a forgotten `WHERE` clause in a future query would still return only the caller's rows. Run as the owner role, these tests fail. A catalog check also requires RLS and the `org_isolation` policy on every table with an `organization_id` column.
- **Authorization sweep** (`authorization.test.js`). A table lists every route and the roles allowed to call it. The route list is read from the Express routers, so a new route fails the suite until it has a row. Every route is called without a session (401), and by every role: excluded roles get 403, allowed roles never get 401, 403 or 404. Ticket routes are also called by an end user who didn't request the ticket (404).
- **Concurrency** (`concurrency.test.js` and the workflow and user suites). Twenty tickets created at once get 1001 to 1020 with no gaps or duplicates; parallel status changes produce a consistent event history; two admins demoting each other can't leave the org without an admin.

### CI

`.github/workflows/ci.yml` runs on every push and pull request, in two jobs:

- **server:** a `postgres:18` service container; `db/setup.sql` creates the two roles and databases (the same script used locally, with throwaway passwords that exist only for that run); Node from `server/.nvmrc`; `npm ci`, `npm run lint`, `npm test` (which migrates and seeds `resolvd_test`).
- **client:** `npm ci`, `npm run lint`, `npm test`, `npm run build`.

CI catches what local runs can miss: a file that exists only on one machine, a dependency missing from `package-lock.json`, a migration that only works on an existing database (CI's is always fresh), differences between Windows and Linux (file name case, line endings), and forgetting to run the tests before pushing.

## Deployment
