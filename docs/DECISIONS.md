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
- **Ids are capped at the INT maximum (2147483647)** in ticket schemas. A larger number would reach Postgres and fail with "value out of range" (22003), which the error handler doesn't map, so it would be a 500. `page` is capped at 1,000,000 so the OFFSET can't overflow either. The users and categories `:id` schemas from Phase 3 have the same gap; suggested as a follow-up rather than changed here.
- **`sla` query parameter is validated but not applied yet.** The plan puts it in the Phase 4 schema and wires it in Phase 6. Until then tickets have no deadlines, and OpenAPI says the filter starts working in Phase 6.
- **Queue rows leave out `description`** (up to 5,000 characters each). Create, get and update return the full ticket. Both shapes include `display_id` and the joined `category_name`, `requester_name` and `assignee_name`.
- **A page past the end still reports the total.** `COUNT(*) OVER()` has no row to ride on when the page is empty, so in that case only, a separate `count(*)` runs with the same filters.
- **Search details:** `%`, `_` and `\` are escaped so they match literally; a ticket number is recognised only for 1 to 9 digits (INT range); the title match still applies when the text is a number, so `1003` also finds titles containing "1003".
- **`assignee=<id>`** isn't checked against the users table. An id that isn't an assignee in the org simply matches no tickets.
- **Optimistic locking compares `updated_at` to the millisecond,** because that is all the precision a JSON date carries (Postgres stores microseconds). Two edits within the same millisecond would look identical; the row lock still serializes them, so no edit is lost, only the stale-copy warning could be missed. The 409 uses the existing `CONFLICT` code, which OpenAPI already describes as "the record changed since you loaded it".
- **`loadTicketForUpdate` locks the row, then checks `canView`.** An end user's request for someone else's ticket holds that lock only until its immediate 404 rollback. Keeping the check in `canView` means one definition of the rule for every write path.
- **Tests use their own organizations.** `registerOrg()` in `tests/helpers.js` signs up a fresh org, so ticket numbers start at 1001 and filter results are exact. Until Phase 5 adds the status and assignment endpoints, tests set `status` and `assignee_id` through the owner connection.
- **OpenAPI version bumped to 0.3.0**; Bruno environment gained `ticketId`.
