# Decisions

Choices made while building Resolvd that the build plan (`RESOLVD_PLAN.md`) did not dictate, newest phase last.

## Phase 0: Skeleton

- **Fixed the `migrate` script path.** `server/package.json` had `node sripts/migrate.js`; corrected to `node scripts/migrate.js` as the plan specifies.
- **`SEED_PASSWORD` added to `.env.example` now.** The plan's Phase 0 key list omits it, but Phase 1 needs it and asks for it as a placeholder. Adding it now means `server/.env` copied in Phase 0 already has every key Phase 1 uses. Keys for later phases (for example `TRUST_PROXY_HOPS`, `EMAIL_MODE`) are added in the phase that introduces them.
- **ESLint ignores `node_modules/`, `coverage/` and `dist/`.** Linting covers only our own source.
- **Dev-only `npm audit` advisories left as is.** `npm audit` (including dev dependencies) reports 4 moderate advisories in ESLint 10's `minimatch` dependency. The only automatic fix is a forced downgrade to ESLint 9. They only affect the local lint tool, not the running API (`npm audit --omit=dev` is clean), so we wait for an upstream fix.
- **`.gitkeep` only in folders that already existed.** Folders for modules the plan creates later (`health`, `organizations`, `sla`, `scripts/lib`) are created when their phase starts.

## Phase 1: Database, migrations and row-level security

- **`setup.sql` stops early with a clear message if `-v owner_pw` or `-v app_pw` is missing**, instead of psql's cryptic syntax error. If a role already exists, its password is left alone (the script only creates what's missing).
- **Shared `scripts/lib/loadEnv.js`.** Both `migrate.js` and `seed.js` need the same `.env` / `.env.test` loading, so it lives in one file. Real environment variables still win over the file.
- **Migration and seed runners print a clear message and exit 1 on failure** rather than a raw stack trace. A missing `MIGRATION_DATABASE_URL` is reported by name.
- **`auth_record_login_failure` returns `VOID`.** Login returns the same 401 either way, so the caller doesn't need the new count.
- **Every table with `updated_at` gets the `set_updated_at` trigger**, including `categories` and `sla_policies` (the plan only spelled it out for some tables).
- **Seed data shape.** `db/seeds/users.js` exports `SEED_ORGS` (names and slugs) and `USERS` keyed by org, then by a handle that names the role: `admin`, `tech1`, `tech2`, `user1` to `user3` (for example `USERS.acme.tech1.email`). That reads more clearly in tests than array indexes.
- **The seed hashes `SEED_PASSWORD` once and reuses the hash** for all 12 users. They all share the demo password anyway, and it saves 11 slow bcrypt runs every time tests reseed.
- **The seed refuses to run when `NODE_ENV=production`,** because it truncates every organization.
- **The seed inserts organizations directly** instead of calling `create_organization()`. It connects as the owner, so the SECURITY DEFINER function isn't needed.

## Phase 2: Express server foundation

- **Error handling matches ScreenGuide AI (Carter's instruction).** This replaces three details of the plan's 2.4, so the two codebases stay compatible:
  - `AppError` has ten helpers, all with the signature `helper(message, details, code)` and a default message and code: `badRequest` (400 `BAD_REQUEST`), `unauthorized` (401 `UNAUTHORIZED`), `forbidden` (403 `FORBIDDEN`), `notFound` (404 `NOT_FOUND`), `conflict` (409 `CONFLICT`), `tooManyRequests` (429 `TOO_MANY_REQUESTS`), `validation` (400 `VALIDATION_ERROR`), `unprocessable` (422 `UNPROCESSABLE`), `internal` (500 `INTERNAL_ERROR`) and `serviceUnavailable` (503 `SERVICE_UNAVAILABLE`). The plan listed only the first six.
  - `ZodError` details use Zod 4's `z.flattenError(err)` instead of the plan's `err.flatten()`, which Zod 4 deprecates. The output shape (`formErrors`, `fieldErrors`) is the same.
  - body-parser errors are mapped: malformed JSON → 400 `INVALID_JSON`, body over 100 KB → 413 `PAYLOAD_TOO_LARGE`, unsupported charset or content encoding → 415 `UNSUPPORTED_MEDIA_TYPE`.
  - The ScreenGuide AI repo isn't on this machine, so default messages and the codes for `validation` (400 rather than 422) and `unprocessable` (`UNPROCESSABLE`) were chosen here. Compare them with ScreenGuide's `AppError` and align whichever side differs.
- **415 covers only what body-parser rejects.** `express.json()` raises 415 for an unsupported charset or encoding. A body sent with a non-JSON `Content-Type` (for example `text/plain`) is not parsed and `req.body` stays `undefined`, so from Phase 3 it fails validation with 400. Rejecting such requests with 415 would need a separate middleware; it wasn't added because the plan doesn't call for it.
- **`AppError.internal()` messages are sent to the client.** Only *unrecognised* errors get the generic message. A deliberate `AppError` 500 has a message we wrote, so it's safe to show.
- **Only 5xx errors are logged by the error handler.** 4xx responses are expected and already appear in the request log (as `warn`).
- **The 404 message includes the method and path** (`Route not found: GET /api/x`) to make typos easier to spot. It echoes only what the client sent.
- **The logger redacts `Cookie`, `Authorization` and `Set-Cookie` headers.** pino-http logs request headers by default, which would put session tokens in the logs from Phase 3 on.
- **Log level is `info`** in development and production, and `silent` in tests.
- **Pool `connectionTimeoutMillis: 5000`.** Without it, a request waits indefinitely for a connection when Postgres is unreachable. With it, `/api/health` returns its 503 quickly.
- **The health module is a single routes file.** It has no business logic or tenant data, so a controller, service and queries file would be empty layers. The plan names only `health.routes.js`.
- **Rate-limit 429s go through the error handler** (custom `handler`), so they use the standard error shape. Responses carry the standard `RateLimit` and `RateLimit-Policy` headers (draft 8), and no legacy `X-RateLimit-*` headers.
- **pino-http logs 4xx as `warn` and 5xx as `error`** (`customLogLevel`), so problems stand out in the log.
- **Graceful shutdown has a 10-second fallback** that forces an exit if open connections keep `server.close()` waiting. `app.listen` errors (such as the port already being in use) are logged and exit 1. Express 5 passes them to the listen callback.
- **Minimal Phase 9.1 pulled forward.** `server/vitest.config.js` (node environment, `NODE_ENV=test`, no file parallelism, 15 s timeout) and `server/.env.test.example`. `globalSetup` (migrate + seed) is left for Phase 9 because Phase 2's tests need no tables.
- **The `.env` loading in `src/config/env.js` duplicates `scripts/lib/loadEnv.js`** (two lines) instead of importing from `scripts/`, so the app's source doesn't depend on the CLI scripts folder.
- **Extra tests beyond the plan's two:** AppError helpers, each error-handler mapping (including Express 5 forwarding async errors, which replaces the temporary test route; that route was also tried by hand and removed), and the `withOrg` / `withTransaction` behaviour.
- **OpenAPI `servers` is `/api`**, so paths are written as `/health` and Swagger's "Try it out" calls the same host that serves the docs.
- **`.gitignore` un-ignores `.env.test.example`.** The `.env.*` rule was also hiding the new placeholder file. Real `.env.test` files stay ignored.

## Phase 3: Authentication, roles and admin endpoints

- **What "refactor transaction helpers" meant.** `withTransaction` keeps the original error if `ROLLBACK` fails, destroys a broken connection instead of returning it to the pool, and listens for `error` on the client while it's checked out. A test that kills its own connection showed that, without the listener, the late `ECONNRESET` was an unhandled error that would crash the server.
- **Response shapes.** Register, login and `/me` all return `{ user, organization: { id, name, slug } }`, so the front end can use any of them to fill its `['me']` cache. Lists return `{ data: [...] }` (Phase 4 adds `pagination`). Single records are returned bare. Output fields stay snake_case as stored; request bodies are camelCase, as the plan's field names are.
- **Error codes added.** `INVALID_CREDENTIALS` and `ACCOUNT_LOCKED` (401, login), `CANNOT_CHANGE_SELF` and `LAST_ADMIN` (400, user admin rules), `INVALID_PASSWORD` (400, wrong current password on `PATCH /users/me`; 400 not 401 so the front end doesn't treat it as a signed-out session). Business-rule refusals use 400 to match the plan's convention for workflow rules (Phase 5); `AppError.unprocessable` (422) stays unused for now.
- **409s carry field errors.** Duplicate email, slug and category name return `details` in the same `{ formErrors, fieldErrors }` shape as validation errors, so a form can show the message under the right input. The `code` stays `CONFLICT`.
- **Last-admin rule locks every active admin row in id order.** The plan says to lock the target row; that alone doesn't stop two admins demoting each other at once (each locks a different row). The test forces the overlap with a third connection holding the locks, and fails if the admin-row lock is removed.
- **Inactive accounts also run bcrypt** against their own hash before the 401, like unknown emails, so timing doesn't distinguish them from a wrong password.
- **Locked accounts are checked before the password** and answered without running bcrypt. The message already says the account is locked, so there's nothing to hide by timing.
- **Passwords: 72-byte check as well as 72 characters.** bcrypt truncates at 72 bytes, and non-ASCII characters use more than one byte.
- **`authenticate` rejects a token whose `sub` or `org` isn't an integer**, even with a valid signature. Missing cookie → `Authentication required`; bad, expired or no-longer-valid session → `Session expired. Please sign in again.` (both 401 `UNAUTHORIZED`).
- **`POST /auth/logout` doesn't require a session**, so a client can always clear a stale cookie.
- **Department can be cleared** by sending `null` or `""`.
- **`users.queries.js` builds the `UPDATE ... SET` list from a whitelist map** (API field → column), so only those columns can appear and every value is a parameter. The users list uses fixed SQL with `($1::user_role IS NULL OR role = $1)`-style optional filters instead.
- **Shared rate-limiter factory** (`src/middleware/rateLimit.js`) used by the general `/api` limiter and the login limiter, so both send 429s in the standard error shape with the same headers.
- **Tests vary the client IP.** The app trusts one proxy hop, so tests set `X-Forwarded-For` to a fresh fake IP for each login. That keeps the real 10-per-15-minutes login limiter on in tests (it has its own test) without one file's logins tripping it.
- **Pulled forward from Phase 9:** `tests/globalSetup.js` (migrate + seed `resolvd_test` once per run) and a minimal `tests/helpers.js` (`app`, `loginAs`, `createUser` via the owner connection with bcrypt cost 4 for speed). `seed()` gained a `table` option so the setup can silence its console table.
- **Bruno:** passwords use a secret environment variable (`vars:secret [ password ]` in `bruno/environments/local.bru`). Bruno stores its value locally, never in the file.
- **`.gitkeep` files left in `modules/auth` and `modules/users`.** They're now redundant next to real files but harmless.

## ScreenGuide AI compatibility follow-ups (after Phase 3)

Carter's requests after checking ScreenGuide AI's conventions, made as a separate commit before Phase 4.

- **`setOrg` rejects any org id that isn't a positive integer** and throws before running a query. It throws a plain `TypeError`, not an `AppError`: a bad org id always means a bug in our code (the id comes from the database or a verified token, never from request input), so the client gets the generic 500 and the full error is logged. Strings such as `"7"` are rejected too, because every caller already has a number, and accepting text is how something like `"1 OR 1=1"` could slip through unnoticed.
- **Sign-up rate limit: 5 per hour per IP** on `POST /api/auth/register-organization`, through the shared `createRateLimiter`, so the 429 uses the standard `TOO_MANY_REQUESTS` error shape. Every attempt counts, including ones rejected by validation, because each real sign-up creates an organization and runs bcrypt. The general `/api` limiter still applies too.
- **Sign-up tests send a fresh fake IP** (`X-Forwarded-For`), like the login tests, so the suite's many sign-ups don't trip the new limiter.
- **The `AppError.js` header comment no longer claims it matches ScreenGuide.** It says the helpers are meant to line up and points to the open questions in the Phase 2 section above, which are still unconfirmed.

## Phase 4: Tickets API

- **Requesters can't change priority after creating a ticket.** Section 4.1 lists what the requester may edit (title, description, category), and Phase 5 adds a staff-only priority endpoint, so `PATCH /tickets/:id` with a changed `priority` from an end user is 403 "Only support staff can change the priority". Staff may change it through `PATCH` too. Phase 6 must recalculate deadlines on this path as well as in `changePriority`.
- **Order of checks on `PATCH`:** not visible → 404; stale `expectedUpdatedAt` → 409; closed → 400 `TICKET_CLOSED`; requester editing a ticket that isn't open → 403; requester changing priority → 403. The 409 comes before the rule checks because a decision made from an outdated copy isn't meaningful. Closed is 400, like the plan's other "this ticket is closed" refusals; "your role can't do this here" is 403.
- **Unchanged values are ignored.** Sending a field with its current value writes no event and doesn't touch `updated_at`. If nothing changes, `PATCH` returns the ticket as it is.
- **The `created` event** stores `new_value = 'open'`, so a ticket's status history starts at creation. `old_value` is null.
- **Unknown category → 400 `VALIDATION_ERROR` with `fieldErrors.categoryId`** (create and update), not the generic `INVALID_REFERENCE`, so the form can show it under the field. Categories are never deleted, so checking before the insert can't race.
- **`categoryId: null` clears the category** on update (and is allowed on create).
- **`description` is trimmed too,** not only `title`, so spaces can't pad it past the 10-character minimum.
- **Ids are capped at the INT maximum (2147483647)** in ticket schemas. A larger number would reach Postgres and fail with "value out of range" (22003), which the error handler doesn't map, so it would be a 500. `page` is capped at 1,000,000 so the OFFSET can't overflow either. The same cap now covers every id: see the follow-up below.
- **`sla` query parameter is validated but not applied yet.** The plan puts it in the Phase 4 schema and wires it in Phase 6. Until then tickets have no deadlines, and OpenAPI says the filter starts working in Phase 6.
- **Queue rows leave out `description`** (up to 5,000 characters each). Create, get and update return the full ticket. Both shapes include `display_id` and the joined `category_name`, `requester_name` and `assignee_name`.
- **A page past the end still reports the total.** `COUNT(*) OVER()` has no row to ride on when the page is empty, so in that case only, a separate `count(*)` runs with the same filters.
- **Search details:** `%`, `_` and `\` are escaped so they match literally; a ticket number is recognised only for 1 to 9 digits (INT range); the title match still applies when the text is a number, so `1003` also finds titles containing "1003".
- **`assignee=<id>`** isn't checked against the users table. An id that isn't an assignee in the org simply matches no tickets.
- **Optimistic locking compares `updated_at` to the millisecond,** because that is all the precision a JSON date carries (Postgres stores microseconds). Two edits within the same millisecond would look identical; the row lock still serializes them, so no edit is lost, only the stale-copy warning could be missed. The 409 uses the existing `CONFLICT` code, which OpenAPI already describes as "the record changed since you loaded it".
- **`loadTicketForUpdate` locks the row, then checks `canView`.** An end user's request for someone else's ticket holds that lock only until its immediate 404 rollback. Keeping the check in `canView` means one definition of the rule for every write path.
- **Tests use their own organizations.** `registerOrg()` in `tests/helpers.js` signs up a fresh org, so ticket numbers start at 1001 and filter results are exact. Until Phase 5 adds the status and assignment endpoints, tests set `status` and `assignee_id` through the owner connection.
- **OpenAPI version bumped to 0.3.0**; Bruno environment gained `ticketId`.
- **Follow-up (Carter's request): every id parameter is capped at the INT maximum.** `PATCH /api/users/99999999999` and `PATCH /api/categories/99999999999` returned 500 (Postgres "value out of range"); they now return 400 `VALIDATION_ERROR`. The rule lives in one shared file, `src/utils/idSchemas.js` (`idParam` for path and query text, `idValue` for JSON body numbers, `idParams` for `/:id`), used by the users, categories and tickets schemas, so a new module can't forget it. It's a new file the plan doesn't name; three copies of the same rule would drift.

## Phase 5: Workflow, assignment, comments and audit log

- **Moving to the same status is refused** (400 `INVALID_TRANSITION`, "The ticket is already on_hold"). The workflow table lists no self-moves, and refusing them means five identical requests sent at once produce exactly one status event. Phase 8's `allowedTransitions` will leave the current status out for the same reason.
- **Every refused status move is 400 `INVALID_TRANSITION`,** including an end user trying a staff-only move. The plan says "400 with reason"; the message carries the reason ("Only support staff can change the status of this ticket", "Tickets can only be reopened within 7 days..."). 403 stays for whole endpoints that are staff only (assignment, priority) and for internal notes.
- **The 7-day reopen window is inclusive**: exactly 7 days after `resolved_at` is still allowed, 1 ms later is not. A missing `resolved_at` is treated as outside the window. Closing (confirming the fix) has no time limit.
- **`isStaff` and `STAFF_ROLES` moved to `workflow.js`** so the workflow module has no database imports. `tickets.service.js` re-exports `isStaff`, so existing imports keep working; the routes use `requireRole(...STAFF_ROLES)`.
- **One clock per request.** The status service creates `now` once and uses it both for the 7-day check and for the `resolved_at` / `closed_at` it writes.
- **Assignment details:**
  - Body is `{ assigneeId }`, required, a user id or `null`. An assignee who isn't an active technician or admin in the org is 400 `VALIDATION_ERROR` with `fieldErrors.assigneeId` (like an unknown category), so a form can show it under the field.
  - Sending the current assignee is not a change: no event, no status move, 200 with the ticket (same as unchanged fields in Phase 4).
  - Unassigning never changes the status. Only assigning someone to an `open` ticket moves it to `in_progress`.
  - The assignee row is read `FOR SHARE`, so it can't be deactivated or demoted until the assignment commits. No deadlock is possible with the user-admin rules: they never lock tickets.
  - Resolved tickets can still be assigned and reprioritized; only closed ones can't (400 `TICKET_CLOSED`).
- **`assertNotClosed(ticket, message)`** is shared by edit, assignment, priority and comments, each with its own message. Comments use the plan's "This ticket is closed. Please submit a new one."
- **Automatic status moves are recorded as the person whose action caused them:** the assigner for open → in_progress, the requester for their reply on an on_hold ticket. `actor_id` NULL ("System") is kept for changes no person caused (Phase 6's SLA job). The requester reply rule applies only to public comments.
- **Setting `first_response_at` writes no event.** The first public staff comment is itself the record, and it's already in the activity feed. Its value is the comment's `created_at`, so the two match exactly.
- **Comments live in `modules/comments/`** (the folder Phase 0 created), with their own five files, mounted inside the tickets router at `/:id/comments` with `mergeParams`. They reuse the tickets module's `loadTicketForUpdate`, `assertNotClosed` and `writeStatusChange`. Events and activity stay in the tickets module because they're the ticket's history.
- **Read-only endpoints don't lock.** Comments, events and activity lists check visibility with `loadTicketForRead` (a small `SELECT` without `FOR UPDATE`). Posting a comment locks, because it can change `first_response_at` or the status.
- **Response shapes:** comments include `author_name` and `author_role`; events include `actor_id` and `actor_name`; lists are `{ data }` with no pagination (one ticket's conversation is small).
- **Activity order:** oldest first; ties on `created_at` put comments before events, then sort by id. Events written in one transaction share a timestamp, so a reply appears before the status change it caused.
- **`is_internal` on activity events** is true for events end users don't see (anything but `created` and `status`), so the front end can mark staff-only items the same way for comments and events. End users only ever receive `false`.
- **Status and assignment endpoints return the full ticket**, like `PATCH /tickets/:id`, so the front end can update its cache from the response.
- **Test helpers moved:** `setUpOrg`, `ticketBody`, `createTicket`, `setTicketColumns` and `eventsFor` moved from `tickets.test.js` to `tests/helpers.js`, because the new workflow and comments suites need them too.
- **OpenAPI version 0.4.0**, with a new Comments tag and the `INVALID_TRANSITION` code. Bruno has a Comments folder and six new ticket requests; Assign ticket uses the existing `userId` variable.

## Phase 6: SLAs and the breach-checking job

- **Resolving counts as the first response** if no public staff reply came first: the status service sets `first_response_at` to the resolution time. The plan says the response clock is met by the first public staff comment. Taken literally, a ticket resolved without a comment would show its response clock running on after the work was done, and the job would later record a response breach on a resolved ticket. Only staff can resolve, and "this is fixed" reaches the requester, so it counts as replying. A later comment doesn't move `first_response_at`.
- **Both deadline changes are recorded** on a priority change: a `response_due_at` and a `resolution_due_at` event (old and new ISO timestamps), each only if that deadline moved. The plan offers storing the resolution deadline in the priority event or adding a `resolution_due_at` event; one event per changed field matches the rest of the audit log, and the response deadline moves too. Existing tests that read the last event after a priority change now look for the `priority` event by field.
- **`sla=at_risk` checks both clocks**, not only the resolution clock as the plan's formula does. A ticket is at risk when no clock is breached and either running clock has less than 25% of its window left. That makes each filter return exactly the tickets whose `sla.overall` says the same thing, so the Breached and At risk views can't disagree with the badges.
- **`sla=breached` includes resolved and closed tickets that were resolved late.** The plan doesn't say; matching `sla.overall` keeps one definition. A work queue can combine it with `status=open,in_progress,on_hold`.
- **The list uses one clock per request,** passed into the SQL as a parameter rather than using `NOW()`, so the filter and each row's `sla` summary are judged at the same instant.
- **A breach mark is cleared when a priority change makes that deadline no longer breached.** `*_breached_at` belongs to the deadline that was missed. Clearing it lets the job record a breach of the new deadline if that one passes too; keeping it when the new deadline is also breached avoids recording the same breach twice. The old `sla_breach` event stays in the history.
- **The job records late completions too.** It uses the same rule as `clockState`: breached if completed after the deadline, or still running past it. A response that came late while the job wasn't running (for example, the server was down) is still recorded. `*_breached_at` is the time the job recorded it, not the deadline.
- **Breach events:** `field = 'sla_breach'`, `new_value = 'response' | 'resolution'`, `old_value` NULL, `actor_id` NULL. The Phase 5 activity test already used this shape. They stay staff-only, like other non-status events.
- **Recording a breach bumps the ticket's `updated_at`** through the existing `set_updated_at` trigger. The ticket did change, so a client holding an older copy gets the usual 409 on `expectedUpdatedAt` and reloads. Avoiding it would mean changing the shared trigger.
- **Tickets created before migration 008 aren't backfilled.** They have no deadlines and their SLA is `none`. Only local dev data predates Phase 6, and Phase 10 reseeds the demo.
- **A missing policy gives a ticket no deadlines** (`none`) rather than failing to create it. It can't happen through the API (every org gets four policies at sign-up and they can't be deleted).
- **The job's overlap guard is our own flag** (`runScheduledSlaCheck`) rather than node-cron 4's `noOverlap` option, so the guard, the error logging and their test are visible in one small function. It returns `'done'`, `'skipped'` or `'failed'` for the tests and the log.
- **No first run at startup.** The job waits for the next 5-minute mark, as the plan describes.
- **`PUT /sla-policies/:priority` is an upsert**, so PUT sets the policy whether or not the row exists. Both times are required. The response must be shorter than the resolution (the error is on `resolutionMinutes`, so a form can show it there). Times must be JSON numbers; `"30"` is 400.
- **`GET /sla-policies` is ordered critical first** (`ORDER BY priority DESC` on the enum), the same order as `DEFAULT_SLA_POLICIES`.
- **The SLA module** (`modules/sla/`) has the five standard files plus `sla.js` (the pure functions). `dueDatesFor(client, priority, createdAt)` in `sla.service.js` takes the caller's client, like `loadTicketForUpdate`, so deadlines are written in the ticket's transaction.
- **OpenAPI version 0.5.0**, with an SLA policies tag and `SlaSummary`, `SlaState`, `SlaPolicy` and `SlaPolicyInput` schemas. Bruno has an SLA policies folder and an `sla` parameter on List tickets.

## Phase 7: Front end foundation

- **ESLint instead of oxlint.** `create-vite` 9 now scaffolds the React template with oxlint. The plan asks for ESLint + Prettier matching the server, so oxlint was removed and `client/eslint.config.js` uses `@eslint/js`, `eslint-plugin-react-hooks` (recommended rules, which include the React Compiler checks) and `eslint-plugin-react-refresh`. `.prettierrc` is a copy of the server's.
- **Versions resolved by `npm install`:** React 19, Vite 8, Mantine 9, React Router 7, TanStack Query 5, Vitest 5 (same as the server). Mantine's PostCSS setup is unchanged in v9 (`postcss.config.cjs` with `postcss-preset-mantine` and the breakpoint variables). The client also has `.nvmrc` (`26`) and `engines.node >=26`, like the server.
- **Template files removed:** the demo CSS, images, `icons.svg` and the template README. The Vite logo favicon is replaced with a small indigo check mark.
- **Retry once, only when it could help.** The plan says `retry: 1`. Queries retry once for network and 5xx errors, but not for 4xx answers (401, 403, 404, 400), which would only repeat. It also means a 401 sends the user to `/login` straight away.
- **How the 401 handler "clears the cache and redirects".** It removes every query except `['me']` and sets `['me']` to `null`. `RequireAuth` then redirects to `/login` with `state.from`, so the user returns to the same page after signing in. A hard `window.location` redirect would lose that and reload the app. (Calling `queryClient.clear()` would also remove `['me']` while components are still subscribed to it, and they wouldn't re-render.)
- **Mutation 401s are handled too.** The plan mentions the query cache only. A mutation that gets 401 (session expired while submitting) shows its message and ends the session the same way. Sign-in and sign-up opt out with `meta: { inlineErrors: true }`, because a 401 there means a wrong password, and they show errors in the form instead of a notification.
- **Sign-out needs the API to answer.** `logout()` clears the session only after `POST /auth/logout` succeeds. If it fails, the httpOnly cookie is still in the browser (only the server can clear it), so showing "signed out" would be untrue. The error appears as a notification. After signing out the app goes to `/login` without remembering the last page, so the next person on that browser doesn't land on it.
- **A failed session check isn't "signed out".** If `/auth/me` fails for a reason other than 401 (API down, cold start timeout), `RequireAuth` shows "Can't reach Resolvd" with a Try again button instead of redirecting to `/login`.
- **Signed-in users visiting `/login` or `/register` go to `/tickets`** (or, from the sign-in page, back to the page they were sent from). This is also how a successful sign-in redirects: filling `['me']` re-renders the page with a user.
- **The 404 page is inside the signed-in shell** (`features/NotFoundPage.jsx`), so a bad link keeps the navigation. A signed-out visitor to an unknown address is sent to `/login` first.
- **Placeholders.** The ticket and admin pages are placeholders until Phase 8. Of the components listed in 7.2, only `PageHeader` exists now; `StatusBadge`, `PriorityBadge`, `SlaBadge` and `EmptyState` are built in Phase 8 (its commit "Add status, priority and SLA badges and empty state"). `constants.js` has the labels and colours already, plus role labels and `STAFF_ROLES`.
- **`api/` modules cover every existing endpoint now,** as one-line wrappers, so Phase 8 only adds pages.
- **Sign-up checks the API's rules in the browser first** (lengths, slug pattern, email shape, password rules) and adds "Confirm password". Sign-up allows 5 attempts per IP per hour, rejected ones included, so a typo shouldn't cost one. The API still validates everything. The slug field lowercases as you type; clearing it turns the automatic suggestion back on.
- **The "URL name" label** matches the API's message "That URL name is taken", so the error reads naturally under that field.
- **Demo logins box:** shows "Demo accounts will be listed here when the live demo is set up" until Phase 10 fills `DEMO_LOGINS` in `LoginPage.jsx`. The cold-start note is always visible, small, under the sign-in button.
- **New shared file `features/auth/AuthShell.jsx`** frames both the sign-in and sign-up pages (brand, heading, card), so they look the same without copying the layout.
- **Empty component sections say `// none`.** Every component has all four sections (State, Data, Handlers, Render), even when one is empty, so every file reads the same way. Hooks that read the URL or router (`useLocation`, `useParams`) are listed under State.
- **Tests (7.4) go a little beyond the two the plan names,** because there's no browser available to Claude Code to click through: route guards (signed-out redirect, admin-only navigation, no-access message, 404), signing in and returning to the requested page, and the sign-up form (slug suggestion, API field error under the input, no request when the form is invalid). They replace `fetch`, so no API is needed. Test files sit next to the code (`*.test.js(x)`); `src/test/` holds the setup (Mantine's jsdom polyfills) and `renderWithProviders`.
- **Vite's 500 kB chunk warning on `npm run build` is left for now.** The whole app is one bundle (about 175 kB of JavaScript gzipped, 570 kB before compression). Splitting pages with `React.lazy` can come later if load time matters.
- **`npm audit`** in `client` reports the same 4 moderate dev-only advisories as the server (ESLint's `minimatch`); `npm audit --omit=dev` is clean.

## Phase 8: Ticket pages and admin screens

- **Only `GET /tickets/:id` carries the allowed actions.** List rows and the responses of write endpoints (status, assignment, priority, edit) don't. After any change the front end invalidates the ticket query and refetches the detail, so the options always come from one place.
- **`allowedTransitions` is in status order** (`open, in_progress, on_hold, resolved, closed`), not the order of the workflow table, so the status menu always lists statuses the same way.
- **`canEdit` and `canComment` are the write paths' own rules.** `canEdit(user, ticket)` is now what `PATCH /tickets/:id` checks (through `assertCanEdit`, which keeps its distinct 400 for closed and 403 for "not at this stage"). `canComment(ticket)` is "not closed", the comments endpoint's rule. OpenAPI version 0.6.0 adds a `TicketDetail` schema.
- **Two small shared files the plan doesn't name:** `client/src/dates.js` (dayjs set up once with `relativeTime` and `localizedFormat`; `fromNow`, `fullDate`, `shortDuration`) and `components/RelativeTime.jsx` (a relative date with the full date in a tooltip, which 8.7 asks for on every page). `components/sla.js` holds the SLA badge wording and `overallClock`, kept out of `SlaBadge.jsx` so the component file only exports a component (React Refresh needs that) and the wording is unit tested.
- **SLA badge wording uses a compact copy of dayjs's English `relativeTime` strings** ("2h", "25m", "3d"), registered as its own locale without becoming the default. Other relative dates keep the long form ("3 hours ago").
- **A queue row shows one SLA clock:** the one that decided `sla.overall` (if both clocks are in that state, the earlier deadline). Its name and exact deadline are in the tooltip. The detail page shows both clocks.
- **SLA colours:** on track blue, at risk orange, breached red, met green, no SLA gray (`SLA_STATES` in `constants.js`).
- **Queue tabs cover active work by default.** My tickets, Unassigned, All open and Breached all show `open`, `in_progress` and `on_hold` tickets. Without that, My tickets sorted by deadline would start with long-closed tickets (their old deadlines sort first), and Breached would mix in tickets resolved late (Phase 6 noted a work queue would add this status filter). The status filter can only narrow a tab's statuses, and changing tab clears it.
- **Added a fifth staff tab, "All tickets"** (every status, no other filter), so staff can still find resolved and closed tickets. The plan lists four staff tabs; with the active-only default above, staff would otherwise have no way to see finished work in the queue.
- **End users' Open tab includes resolved tickets** (waiting for them to confirm the fix); Closed shows closed ones. A tab with a single status hides the status filter.
- **URL parameters:** `tab`, `status`, `priority`, `q` (search), `sort`, `order`, `page`. Unknown or hand-edited values fall back to the defaults instead of reaching the API. Any change except paging removes `page`.
- **Sortable columns are the ones the API can sort:** ID (by `created_at`), Priority, SLA (by `resolution_due_at`) and Updated. A first click sorts deadlines soonest first and the others newest or most severe first; clicking again flips the order.
- **Query keys** live in `api/tickets.js` (`ticketKeys`): `['tickets', 'list', filters]`, `['tickets', 'detail', id]` and `['tickets', 'detail', id, 'activity']`. Because they share the `['tickets']` prefix, invalidating `['tickets']` after a change refreshes the queue, the ticket and its activity in one call.
- **Narrow screens:** below Mantine's `md` breakpoint (62em) the table is replaced by cards, each one a single link. Between `md` and the table's 900 px minimum width the table scrolls sideways.
- **The Phase 7 navigation test** now expects more than one "New ticket" link, because the queue page has its own New ticket button.
- **New ticket form:** the title and description limits (5 to 200, 10 to 5000) and the priority help text live in `features/tickets/ticketForm.js`, shared with the edit form on the ticket page. The description shows a character count. On success the notification reads "RES-1042 created". Errors use the global notification, and field errors from the API also appear under their inputs.
- **Test setup stubs `document.fonts`**, which jsdom lacks and Mantine's autosize Textarea listens on.
