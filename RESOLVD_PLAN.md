# Resolvd: Build Plan for Claude Code

This is the full specification for building Resolvd. Follow `CLAUDE.md` for how to work (one phase at a time, commit but never push, verify everything, stop with a Phase Report).

---

## 1. What Resolvd is

A multi-organization IT helpdesk. Each organization (a company, school or club) gets its own private space. End users submit IT tickets, technicians work a queue against SLA deadlines, and admins manage users, categories and SLA rules. No organization can ever see another organization's data. That is enforced twice: in every query, and again by PostgreSQL row-level security.

Releases:

| Release | Phases | Contents |
| --- | --- | --- |
| v1.0 MVP | 0 to 10 | Live multi-org helpdesk with roles, SLAs, audit log, tests, CI, docs, deployment |
| v2 | 11 to 13 | Knowledge base with full-text search, reporting dashboard, email notifications |
| v3 | 14 | ScreenGuide AI integration (org API keys and ticket intake) |

## 2. Current state of the repo (as of 2026-11-11)

Carter completed Phase 0 by hand up to step 0.5. The repo at `C:\Projects\resolvd` (GitHub: `carterlafosse/resolvd`, private for now) contains:

- `.gitignore` (dependencies, build output, `.env` + `.env.*` with `!.env.example`, logs, OS files)
- `README.md` placeholder
- `docs/build-log.md` (Carter's; never edit it)
- `server/package.json` with `"type": "module"`, scripts (`dev`, `start`, `migrate`, `seed`, `test`) and these packages installed:
  - dependencies: express, pg, dotenv, zod, bcryptjs, jsonwebtoken, cookie-parser, helmet, cors, express-rate-limit, pino, pino-http, node-cron, swagger-ui-express, yaml
  - devDependencies: vitest, supertest, pino-pretty, eslint, prettier
- `server/package-lock.json`
- Empty folders (not tracked by Git): `client/`, `docs/screenshots/`, `server/src/{config,db,middleware,jobs,utils}`, `server/src/modules/{auth,tickets,comments,users,categories}`, `server/db/{migrations,seeds}`, `server/scripts`, `server/tests`

Local tools on Carter's PC: Node 26 via fnm, PostgreSQL 18 (with `psql` on PATH and pgAdmin), Git 2.51, VS Code, Bruno.

GitHub issues: issue #1 was a deleted issue, so **Phase N is issue #(N+2)**: Phase 0 is #2, Phase 1 is #3, through Phase 10 at #12. Milestones: `v1.0 MVP`, `v2`, `v3`. v2 and v3 issues don't exist yet; at the start of Phase 11, ask Carter for the issue numbers (or omit `Closes #N` if he hasn't created them).

## 3. Architecture rules (apply to every phase)

### Request flow

1. **Middleware**: security headers, CORS, request logging, body parsing, cookies, rate limiting, then `authenticate` and `requireRole`.
2. **Route**: maps method + path to a controller, with `validate({ body, query, params })`.
3. **Controller**: reads the validated request, calls the service, sends the response. No business logic.
4. **Service**: business rules. Opens `withOrg(user.orgId, ...)` for tenant data.
5. **Queries**: plain SQL functions taking `client` first. No rules.
6. **Error handler**: turns any thrown error into `{ error: { code, message, details? } }`.

### Tenant isolation, in two layers

- **Layer 1 (application):** services always scope by the user's organization and apply role visibility rules (for example, end users see only their own tickets).
- **Layer 2 (database):** the API connects as `resolvd_app`, which does not own the tables, so row-level security applies. `withOrg` sets `app.current_org_id` for the transaction; every tenant table's `org_isolation` policy only allows rows where `organization_id = current_org_id()`. If the setting is missing, no rows are visible.

### Rules that apply everywhere

- Something someone can't see returns **404, not 403**, so existence isn't revealed. 403 is for "you can see it but your role can't do this action".
- Every ticket change writes a `ticket_events` row in the same transaction.
- Single-row changes that read-then-write lock the row with `SELECT ... FOR UPDATE`.
- Keep `server/openapi.yaml` updated with every endpoint as it's built.
- Keep `docs/architecture.md` updated with each phase's design decisions.
- Keep `docs/DECISIONS.md` updated with any choice not dictated by this plan.
- Keep a Bruno collection in `bruno/` with example requests for each endpoint (Bruno stores requests as `.bru` text files; commit them). Use environment variables for the base URL; never store passwords in committed files. Use a `bruno/environments/local.bru` with only non-secret values, and document that login credentials come from the seed output.

---

## Phase 0: Verify and finish the skeleton (issue #2)

Carter built most of this by hand. Your job is to **double-check it** and fill small gaps. Do not redo his work or rewrite his files.

### 0.1 Verify

Check each item and report the result:

- `server/package.json`: `"type": "module"` present exactly once; scripts are `dev` = `node --watch src/server.js`, `start` = `node src/server.js`, `migrate` = `node scripts/migrate.js`, `seed` = `node scripts/seed.js`, `test` = `vitest run`; no duplicate keys; dependencies split correctly between `dependencies` and `devDependencies` as listed in Section 2.
- `.gitignore` ignores `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`, logs, OS files, and un-ignores `.env.example` after the `.env.*` line. Test it: create a temporary `.env.test` at the root, confirm `git status` doesn't list it, delete it.
- `git status` is clean apart from what you add; `node_modules` is not tracked (`git ls-files | Select-String node_modules` returns nothing).
- `npm ls --depth=0` in `server` shows no missing or invalid packages. Report the installed Express major version (must be 5).
- `npm audit --omit=dev` in `server`. Report the result; don't run `npm audit fix --force`.

### 0.2 Add

- `.gitattributes` at the root normalizing line endings (`* text=auto eol=lf`, with `*.ps1 text eol=crlf`), so Windows doesn't warn about LF/CRLF.
- `server/.nvmrc` containing `26`, and `"engines": { "node": ">=26" }` in `server/package.json` (Render reads this).
- `server/eslint.config.js` (ESLint flat config) for Node ESM with recommended rules; `server/.prettierrc` (single quotes, semicolons, 2-space indent, print width 100, trailing commas "all"). Add scripts `lint` = `eslint .` and `format` = `prettier --write .`. Install `@eslint/js` and `globals` as dev dependencies if needed.
- `server/.env.example` with placeholder values for every key used in later phases:
  ```
  NODE_ENV=development
  PORT=4000
  DATABASE_URL=postgres://resolvd_app:YOUR_APP_PASSWORD@localhost:5432/resolvd_dev
  MIGRATION_DATABASE_URL=postgres://resolvd_owner:YOUR_OWNER_PASSWORD@localhost:5432/resolvd_dev
  JWT_SECRET=REPLACE_WITH_48_RANDOM_BYTES_HEX
  CLIENT_ORIGIN=http://localhost:5173
  ```
- `docs/DECISIONS.md` (heading plus the decisions you made in this phase) and a `docs/architecture.md` stub (headings: Overview, Request flow, Database, Security, Background jobs, Front end, Deployment).
- `.gitkeep` files in empty folders that later phases need, so the structure exists on GitHub.

Do **not** change `README.md` or `docs/build-log.md`.

### Commits

- `Add .gitattributes, Node version pin and lint/format config`
- `Add .env.example, docs stubs and folder placeholders (Closes #2)`

### Definition of done

All 0.1 checks pass (or problems are reported), 0.2 files exist, `npm run lint` passes on the (nearly empty) server.

### Carter's checks

1. `git log --oneline -5` shows the two new commits.
2. Open `server/.env.example` and confirm it only has placeholders.
3. Create your real `server/.env` by copying `.env.example` (`Copy-Item server\.env.example server\.env`). Fill in real values in Phase 1.
4. Push: `git push`. Issue #2 closes automatically.
5. Build log: finish your Phase 0 entry.

### Concept checks

- What does `"type": "module"` change?
- Why is `.env` ignored but `.env.example` committed?
- What does `.gitattributes` fix on Windows?

---

## Phase 1: Database, migrations and row-level security (issue #3)

Ends with a multi-organization schema built from numbered migrations, two database roles, row-level security on every tenant table, and seed data for two test organizations.

### 1.1 Database roles and databases (Carter runs this)

Write `server/db/setup.sql`, run once as the `postgres` superuser, that creates roles `resolvd_owner` and `resolvd_app` (only if missing) and databases `resolvd_dev` and `resolvd_test` (only if missing, both `OWNER resolvd_owner`). Passwords must come from psql variables passed on the command line, never from the file:

```powershell
psql -U postgres -v owner_pw="..." -v app_pw="..." -f server/db/setup.sql
```

psql variables don't expand inside `DO $$ ... $$` blocks and `CREATE DATABASE` can't run inside one, so use top-level `SELECT format(...) WHERE NOT EXISTS (...) \gexec` statements. Test it yourself if a local superuser is available; otherwise say it's untested. Tell Carter to clear the command from PowerShell history afterwards (`Clear-History` and delete the line from `(Get-PSReadLineOption).HistorySavePath`).

Explain to Carter why there are two roles: RLS doesn't apply to a table's owner, so the app must connect as a non-owner; and least privilege means a compromised API can't drop tables.

### 1.2 Migration runner: `server/scripts/migrate.js`

- Connects with `MIGRATION_DATABASE_URL` (owner role).
- Creates `schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` if missing.
- Reads `db/migrations/*.sql`, sorted by name, skips applied ones.
- Applies each file **and** inserts its row inside one transaction (`BEGIN` / SQL / insert / `COMMIT`; `ROLLBACK` and stop on error), logging each filename.
- Export `migrate(connectionString)` from a module (`server/scripts/lib/migrate.js`) and keep `scripts/migrate.js` as a two-line runner, so tests can call it.
- Loads env with dotenv; supports `NODE_ENV=test` by loading `.env.test` (see Phase 9).

### 1.3 Migrations

**`001_types_and_helpers.sql`**
- Enums: `user_role ('end_user','technician','admin')`, `ticket_status ('open','in_progress','on_hold','resolved','closed')`, `ticket_priority ('low','medium','high','critical')` (declaration order matters for sorting).
- `set_updated_at()` trigger function setting `NEW.updated_at = NOW()`.

**`002_organizations.sql`**
- `organizations`: `id SERIAL PK`, `name VARCHAR(100) NOT NULL`, `slug VARCHAR(50) UNIQUE NOT NULL`, `next_ticket_number INT NOT NULL DEFAULT 1001`, `created_at`, `updated_at` (both `TIMESTAMPTZ NOT NULL DEFAULT NOW()`), updated_at trigger.

**`003_users.sql`** (columns must match exactly; ScreenGuide shares this table)
- `id SERIAL PK`, `organization_id INT NOT NULL REFERENCES organizations(id)`, `name VARCHAR(100) NOT NULL`, `email VARCHAR(255) NOT NULL`, `password_hash TEXT NOT NULL`, `role user_role NOT NULL DEFAULT 'end_user'`, `department VARCHAR(100)`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `failed_login_attempts INT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ`, `last_login_at TIMESTAMPTZ`, `email_notifications BOOLEAN NOT NULL DEFAULT TRUE`, `created_at`, `updated_at`.
- `CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));` (emails unique across all organizations).
- `UNIQUE (organization_id, id)`; updated_at trigger.

**`004_categories_and_sla.sql`**
- `categories`: `id`, `organization_id`, `name VARCHAR(100) NOT NULL`, `created_at`, `updated_at`, `UNIQUE (organization_id, name)`, `UNIQUE (organization_id, id)`.
- `sla_policies`: `organization_id`, `priority ticket_priority`, `response_minutes INT NOT NULL`, `resolution_minutes INT NOT NULL`, `updated_at`, `PRIMARY KEY (organization_id, priority)`, `CHECK (response_minutes > 0 AND resolution_minutes > response_minutes)`.

**`005_tickets.sql`**
```sql
CREATE TABLE tickets (
  id                SERIAL PRIMARY KEY,
  organization_id   INT NOT NULL REFERENCES organizations(id),
  ticket_number     INT NOT NULL,          -- per-org, displayed as RES-1001
  title             VARCHAR(200) NOT NULL,
  description       TEXT NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'open',
  priority          ticket_priority NOT NULL DEFAULT 'medium',
  category_id       INT,
  requester_id      INT NOT NULL,
  assignee_id       INT,
  response_due_at   TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ticket_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, category_id)  REFERENCES categories (organization_id, id),
  FOREIGN KEY (organization_id, requester_id) REFERENCES users (organization_id, id),
  FOREIGN KEY (organization_id, assignee_id)  REFERENCES users (organization_id, id)
);
CREATE INDEX tickets_org_status_idx   ON tickets (organization_id, status);
CREATE INDEX tickets_org_assignee_idx ON tickets (organization_id, assignee_id);
CREATE INDEX tickets_org_due_idx      ON tickets (organization_id, resolution_due_at)
  WHERE status NOT IN ('resolved', 'closed');
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
Note on composite FKs with a NULL column (unassigned ticket): with the default `MATCH SIMPLE`, the FK isn't checked, which is what we want.

**`006_comments_and_events.sql`**
- `ticket_comments`: `id`, `organization_id`, `ticket_id`, `author_id`, `body TEXT NOT NULL`, `is_internal BOOLEAN NOT NULL DEFAULT FALSE`, `created_at`. Composite FKs to `tickets (organization_id, id) ON DELETE CASCADE` and `users (organization_id, id)`. Index `(ticket_id, created_at)`.
- `ticket_events`: `id`, `organization_id`, `ticket_id`, `actor_id INT` (nullable from the start; NULL means system), `field VARCHAR(50) NOT NULL`, `old_value TEXT`, `new_value TEXT`, `created_at`. Same FKs (actor via composite FK to users). Index `(ticket_id, created_at)`.

**`007_row_level_security.sql`**
- `current_org_id()` returning `NULLIF(current_setting('app.current_org_id', true), '')::INT`, `LANGUAGE sql STABLE`.
- Enable RLS and create policy `org_isolation` (`USING` and `WITH CHECK` `organization_id = current_org_id()`) on `users, categories, sla_policies, tickets, ticket_comments, ticket_events`.
- `organizations`: RLS enabled, policy `org_self` `USING (id = current_org_id())`.
- `SECURITY DEFINER` functions with `SET search_path = public`:
  - `auth_find_user_by_email(p_email TEXT)` returning `id, organization_id, password_hash, role, is_active, failed_login_attempts, locked_until` matched on `LOWER(email) = LOWER(p_email)`.
  - `auth_record_login_failure(p_user_id INT, p_max_attempts INT, p_lock_minutes INT)`: increments `failed_login_attempts`; when it reaches the max, sets `locked_until = NOW() + lock minutes` and resets attempts to 0. This exists so the failure count is saved even though login then fails (see Phase 3).
  - `create_organization(p_name TEXT, p_slug TEXT) RETURNS INT`.
- Grants: `USAGE ON SCHEMA public`; `SELECT, INSERT, UPDATE, DELETE` on the six tenant tables; `SELECT, UPDATE` on `organizations`; `USAGE ON ALL SEQUENCES`; `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE` to `resolvd_app` on the three functions.
- Every later migration that adds a table must add its RLS policy and grants in the same file.

### 1.4 Shared defaults: `server/src/modules/organizations/defaults.js`

- `DEFAULT_CATEGORIES = ['Hardware','Software','Network','Account Access','Email','Other']`
- `DEFAULT_SLA_POLICIES`: critical 60 / 240, high 240 / 1440, medium 480 / 2880, low 1440 / 7200 (response / resolution minutes).

### 1.5 Seed: `server/scripts/seed.js` (+ `scripts/lib/seed.js` exporting `seed(connectionString)`)

- Connects as the owner (bypasses RLS).
- `TRUNCATE organizations, users, categories, sla_policies, tickets, ticket_comments, ticket_events RESTART IDENTITY CASCADE`.
- Two orgs: **Acme Corp** (`acme-corp`) and **Globex** (`globex`). Each: 1 admin, 2 technicians, 3 end users; the six categories; the four SLA policies.
- Seed users and emails live in `server/db/seeds/users.js` (exported `USERS` object keyed by org and role) so tests import the same data. Emails like `admin@acme.test`.
- Demo password comes from `SEED_PASSWORD` in `.env` (add to `.env.example` as a placeholder). Fail with a clear message if missing. Hash with `bcryptjs`, cost 12.
- Print a summary table of created users (never print the password).

### 1.6 RLS demo script

`docs/rls-demo.sql`: run as `resolvd_app`, shows `SELECT count(*) FROM users;` returning 0 with no org set, then inside `BEGIN; SELECT set_config('app.current_org_id','1',true); SELECT name, email FROM users; COMMIT;` returning only Acme's users, then 0 again after the transaction. This is for Carter's screenshot.

### 1.7 Docs

- `docs/architecture.md` Database section: each table in one line, the two roles and why, how RLS works, the composite FK pattern, the SECURITY DEFINER functions and why each exists.

### Commits

- `Add database setup script and migration runner`
- `Add migrations for types, organizations, users, categories and SLAs`
- `Add tickets migration with composite foreign keys`
- `Add comments and events migration`
- `Add row-level security, auth functions and grants`
- `Add seed script with two test organizations`
- `Document database design and add RLS demo (Closes #3)`

### Definition of done

On a fresh `resolvd_dev`: `npm run migrate` applies 001 to 007; running it again prints that nothing is pending; `npm run seed` creates both orgs; `docs/rls-demo.sql` behaves as described when run as `resolvd_app`. If you can't access Postgres, write everything and list exactly what Carter must run.

### Carter's checks

1. Run the setup (exact commands from Claude Code), then fill `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SEED_PASSWORD` and a real `JWT_SECRET` in `server/.env`. Generate the secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
2. `cd server; npm run migrate; npm run migrate; npm run seed` (second migrate should say up to date).
3. `psql -U resolvd_app -d resolvd_dev -f ..\docs\rls-demo.sql`
4. **Screenshot:** that output → `docs/screenshots/01-rls-test.png`.
5. In pgAdmin as `resolvd_owner`, glance at the tables and seed data.
6. `git grep -n "PASSWORD="` should only show placeholder values.
7. Push. Issue #3 closes.

### Concept checks

- Why does the app connect as `resolvd_app` and not the table owner?
- What happens if `app.current_org_id` is never set?
- What problem does the composite foreign key on `category_id` prevent?
- Why is the tickets due-date index partial?

---

## Phase 2: Express server foundation (issue #4)

Ends with a running API that validates its config, logs every request, returns consistent errors, checks database health and serves docs at `/api/docs`.

### 2.1 Config: `src/config/env.js`

- Loads `.env` (or `.env.test` when `NODE_ENV=test`) with dotenv; real environment variables always win (dotenv doesn't override by default).
- Zod schema: `NODE_ENV` (development | test | production, default development), `PORT` (coerced number, default 4000), `DATABASE_URL` (url), `JWT_SECRET` (min 32 chars), `CLIENT_ORIGIN` (url). Later phases add keys here.
- On failure: print the flattened field errors and `process.exit(1)`.
- Export `env` and `isProd`.

### 2.2 Logger: `src/utils/logger.js`

pino; `pino-pretty` transport in development; plain JSON in production; level `silent` in test.

### 2.3 Database: `src/db/pool.js`, `src/db/withOrg.js`

- `pool` from `env.DATABASE_URL`, with `pool.on('error')` logging (so a dropped idle connection doesn't crash the process).
- `withTransaction(work)`: connect, `BEGIN`, `work(client)`, `COMMIT`; on error `ROLLBACK` and rethrow; always `client.release()` in `finally`.
- `setOrg(client, orgId)`: `SELECT set_config('app.current_org_id', $1, true)` with `String(orgId)` (transaction-scoped so it can't leak to the next request on that connection).
- `withOrg(orgId, work)` = `withTransaction(async (c) => { await setOrg(c, orgId); return work(c); })`.

### 2.4 Errors

- `src/utils/AppError.js`: `status`, `code`, `message`, `details`; static helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `tooManyRequests`.
- `src/middleware/errorHandler.js`: `AppError` → its status; `ZodError` → 400 `VALIDATION_ERROR` with `err.flatten()`; Postgres `23505` → 409 `CONFLICT`, `23503` → 400 `INVALID_REFERENCE`, `22P02` → 400 `INVALID_INPUT`; anything else → log full error, return 500 `INTERNAL_ERROR` with no internals. Four-parameter signature.
- `src/middleware/notFound.js`: 404 `NOT_FOUND` in the same shape.

### 2.5 App and server

- `src/app.js` exports `createApp()`. Order: `trust proxy` (1), Swagger docs router (mounted **before** helmet, or configure helmet's CSP so Swagger UI works; verify the page actually renders), `helmet()`, `cors({ origin: env.CLIENT_ORIGIN, credentials: true })`, `pinoHttp` with a request ID (`genReqId` using `crypto.randomUUID()`, also returned in an `X-Request-Id` response header), `express.json({ limit: '100kb' })`, `cookieParser()`, a general `/api` limiter (300 per minute), routers, `notFound`, `errorHandler`.
- `src/server.js`: listens on `env.PORT`, logs the URL, graceful shutdown on `SIGTERM`/`SIGINT` (stop accepting connections, end the pool, exit).
- Express 5 forwards rejected promises from async handlers to the error handler; confirm with a quick test route during development (remove it after).

### 2.6 Health: `src/modules/health/health.routes.js`

`GET /api/health` → `SELECT 1` through the pool → `{ status: 'ok', database: 'up' }`, or 503 `{ status: 'degraded', database: 'down' }`.

### 2.7 API docs

`server/openapi.yaml` (OpenAPI 3.0.3, title "Resolvd API", version 0.1.0, description, the health path, a reusable `Error` schema). `src/docs.js` serves it with swagger-ui-express (read via `new URL('../openapi.yaml', import.meta.url)`).

### 2.8 Tests (first ones)

Set up enough of Vitest now (full test infrastructure comes in Phase 9) for: health returns 200 with the database up; unknown route returns the 404 error shape. If the test database isn't set up yet, write the tests and say Carter needs `.env.test` (see Phase 9.1, which you may pull forward minimally).

### Commits

- `Add validated config and logger`
- `Add database pool and org-scoped transaction helpers`
- `Add AppError, error handler and 404 middleware`
- `Add Express app with security middleware and graceful shutdown`
- `Add health check, Swagger docs and first tests (Closes #4)`

### Carter's checks

1. `npm run dev`, open `http://localhost:4000/api/health`.
2. Stop the PostgreSQL Windows service, refresh (503), start it again.
3. Open `http://localhost:4000/api/docs` and try the health endpoint.
4. **Screenshot:** Swagger UI → `docs/screenshots/02-swagger-docs.png`.
5. Temporarily break `.env` (delete `JWT_SECRET`), run `npm run dev`, see the clear error, restore it.
6. `npm run lint` and `npm test`. Push. Issue #4 closes.

### Concept checks

- Why must every query inside `withOrg` use `client` instead of `pool`?
- Why does the error handler need four parameters?
- Why are raw database errors never sent to the client?
- What does `trust proxy` change?

---

## Phase 3: Authentication, roles and admin endpoints (issue #5)

### 3.1 Validation middleware: `src/middleware/validate.js`

`validate({ body, query, params })` parses with Zod; replaces `req.body` and `req.params`; puts the parsed query on `req.validatedQuery` (Express 5's `req.query` is read-only). Zod object schemas strip unknown keys (protects against mass assignment).

### 3.2 Auth schemas

- `passwordSchema`: 10 to 72 characters (bcrypt ignores bytes past 72), at least one letter and one number.
- `registerOrgSchema`: `organizationName` (2 to 100), `slug` (`^[a-z0-9-]{3,50}$`), `name` (1 to 100), `email` (email, lowercased), `password`.
- `loginSchema`: `email`, `password` (non-empty only; don't reveal rules at login).

### 3.3 Sign-up: `POST /api/auth/register-organization`

One `withTransaction`: `SELECT create_organization($1,$2)`, `setOrg`, insert admin (bcrypt cost 12), insert default categories and SLA policies, return the user without `password_hash`. Map unique violations by `err.constraint` to clear 409s ("That email is already registered" / "That URL name is taken"). Sets the auth cookie, returns 201.

### 3.4 Login with lockout: `POST /api/auth/login`

- Look up via `auth_find_user_by_email` (pool query; no org context yet).
- Unknown email: run `bcrypt.compare` against a dummy hash (generated at startup with `bcrypt.hashSync`, not hardcoded) to equalize timing, then 401 "Invalid email or password".
- Inactive: same 401. Locked (`locked_until > now`): 401 "Account temporarily locked. Try again later."
- Wrong password: call `auth_record_login_failure(user.id, 5, 15)` **outside any transaction that will roll back**, so the count is actually saved, then 401 with the same message. (The original hand-written guide had a bug where the failure update was rolled back by the thrown error; this design avoids it. Explain this in the Phase Report.)
- Correct: inside `withOrg`, reset attempts and lock, set `last_login_at`. Sign JWT `{ sub: user.id, org: user.organization_id }`, `expiresIn: '8h'`.
- Stricter limiter on this route: 10 per 15 minutes per IP.

### 3.5 Cookies and routes

- Cookie `resolvd_token`: `httpOnly: true`, `secure: isProd`, `sameSite: 'lax'`, `path: '/'`, `maxAge` 8 hours.
- Routes at `/api/auth`: `POST /register-organization`, `POST /login`, `POST /logout` (clears the cookie with the same options; 204), `GET /me` (returns user plus organization `name` and `slug`).

### 3.6 Middleware: `src/middleware/auth.js`

- `authenticate`: read cookie → `jwt.verify` (401 "Session expired" on failure) → load the user **from the database** inside `withOrg(payload.org)` → 401 if missing or inactive → `req.user = { id, orgId, role, name, email }`. The role is never trusted from the token.
- `requireRole(...roles)`: 403 unless `req.user.role` is included.

### 3.7 Users module

- `GET /api/users` (technician, admin): optional `role` and `active` filters. Admins get full fields (no `password_hash` ever); technicians get only `id, name, role` (for assignment dropdowns).
- `POST /api/users` (admin): `name`, `email`, `role`, `department`, temporary `password`. 201.
- `PATCH /api/users/:id` (admin): `name`, `role`, `department`, `isActive`. Rules: an admin can't demote or deactivate themselves; the org must always keep at least one active admin (check inside the transaction with the target row locked). Changing role or deactivating takes effect on the next request (because `authenticate` reads the database).
- `PATCH /api/users/me` (any signed-in user): `name`, `emailNotifications`, and password change (requires `currentPassword`). Mount before `/:id`.

### 3.8 Categories module

`GET /api/categories` (signed in), `POST /api/categories` and `PATCH /api/categories/:id` (admin; rename only).

### 3.9 Tests

Integration tests (Supertest, real test DB) for: register org (201, cookie set, defaults created), duplicate email 409, login success sets `HttpOnly` cookie, wrong password and unknown email give identical status and body, 5 failures lock the account and the right password is then refused, `/me` without cookie 401, logout clears cookie, end user `GET /api/users` 403, Globex admin `PATCH` on an Acme user id 404, last-admin protection, deactivated user's existing cookie stops working. Use users created inside tests for lockout so seed users stay usable.

### Commits

- `Refactor transaction helpers and add validation middleware`
- `Add auth schemas and organization sign-up`
- `Add login with account lockout`
- `Add auth cookies, routes and authenticate/requireRole middleware`
- `Add users admin endpoints`
- `Add categories endpoints`
- `Add auth and admin tests, update API docs and Bruno requests (Closes #5)`

### Carter's checks

1. `npm run lint; npm test`.
2. In Bruno: register a new org, log in, `/me`, logout, `/me` again (401).
3. Wrong password 5 times; check `locked_until` in pgAdmin.
4. Log in as an Acme end user and call `GET /api/users` (403).
5. Push. Issue #5 closes.

### Concept checks

- Why is the session in an httpOnly cookie instead of localStorage?
- Why does `authenticate` load the user from the database on every request?
- Why do "unknown email" and "wrong password" return the same response?
- Why would the failed-attempt counter be lost if it were updated inside the same transaction that throws the login error?

---

## Phase 4: Tickets API (issue #6)

### 4.1 Business rules (comment block at the top of `tickets.service.js`, all enforced)

- End users see only tickets they requested; technicians and admins see every ticket in their org.
- Not visible → 404 "Ticket not found".
- End users may set priority low, medium or high; critical is staff only (403 otherwise).
- Ticket numbers are per org, starting at 1001; `display_id` is `'RES-' || ticket_number`.
- Requester may edit title, description, category while status is `open`; staff any time (except `closed`: nobody).
- Creating a ticket writes a `created` event in the same transaction.

### 4.2 Schemas

- `createTicketSchema`: `title` (trimmed, 5 to 200), `description` (10 to 5000), `priority` (default `medium`), `categoryId` (optional positive int).
- `updateTicketSchema`: same fields, all optional, at least one required.
- `ticketIdParams`: `id` coerced positive int.
- `listTicketsQuery`: `status` and `priority` (comma-separated, each validated against the enum), `assignee` (`me` | `unassigned` | numeric string), `categoryId`, `search` (max 100), `sla` (`breached` | `at_risk`, used in Phase 6), `sort` (`created_at` | `updated_at` | `priority` | `resolution_due_at`, default `created_at`), `order` (`asc` | `desc`, default `desc`), `page` (min 1, default 1), `pageSize` (1 to 100, default 25).

### 4.3 Create: `POST /api/tickets`

Inside `withOrg`: claim the number with `UPDATE organizations SET next_ticket_number = next_ticket_number + 1 WHERE id = current_org_id() RETURNING next_ticket_number - 1 AS ticket_number` (row lock prevents duplicates under concurrency); insert with `organization_id = current_org_id()` in SQL (never passed from JS); `requester_id = user.id`; insert `created` event; return the ticket. 201.

### 4.4 List: `GET /api/tickets`

Build SQL dynamically with a parameter-array helper; user input only in parameters; sort column from a whitelist map; `ORDER BY <col> <dir> NULLS LAST, t.id DESC`; joins for category, requester and assignee names; `COUNT(*) OVER() AS total_count`; search matches `title ILIKE` or exact ticket number (strip a leading `RES-`, case-insensitive; only compare numbers when the remainder is digits). Response: `{ data, pagination: { page, pageSize, total, totalPages } }` via `src/utils/pagination.js`.

### 4.5 Get and update

- `GET /api/tickets/:id`: visibility rule in the `WHERE` clause.
- `PATCH /api/tickets/:id`: lock with `FOR UPDATE`; apply 4.1 rules; one `ticket_events` row per changed field (old/new values; category stored by name). **Optimistic locking:** accept an optional `expectedUpdatedAt`; if provided and it doesn't match, 409 "This ticket was changed by someone else. Reload and try again."
- Shared helper `canView(user, ticket)` and `loadTicketForUpdate(client, user, id)` used by all ticket services from here on.

### 4.6 Tests

Numbering starts at 1001 per org and is independent per org; end user list contains only own tickets; another user's ticket id → 404; each filter and combinations; search by `RES-1003`; priority sort; pagination totals; `sort=title;DROP TABLE tickets` → 400; critical from end user → 403; requester can't edit an `in_progress` ticket; optimistic lock 409; edits write events.

### Commits

- `Add ticket business rules and schemas`
- `Add ticket creation with per-org ticket numbers`
- `Add ticket list with filters, search, sorting and pagination`
- `Add get and update ticket endpoints with change events`
- `Add ticket tests, API docs and Bruno requests (Closes #6)`

### Carter's checks

1. `npm run lint; npm test`.
2. In Bruno, as an Acme technician: create two tickets, filter by status, search `RES-1001`, page 2 with `pageSize=1`.
3. As an Acme end user, request a ticket you didn't create (404).
4. Push. Issue #6 closes.

### Concept checks

- How does the list query stay safe from SQL injection when the SQL is built dynamically?
- Why 404 instead of 403 for someone else's ticket?
- Why claim ticket numbers with one `UPDATE ... RETURNING` instead of `SELECT` then `UPDATE`?
- What does `COUNT(*) OVER()` give you?

---

## Phase 5: Workflow, assignment, comments and audit log (issue #7)

### 5.1 Workflow: `src/modules/tickets/workflow.js` (pure functions, no DB)

| From | Allowed next | Who |
| --- | --- | --- |
| open | in_progress, on_hold, resolved | Staff |
| in_progress | on_hold, resolved, open | Staff |
| on_hold | in_progress, resolved | Staff |
| resolved | closed | Staff, or requester (confirming the fix) |
| resolved | open (reopen) | Staff, or requester within 7 days of `resolved_at` |
| closed | none | Nobody |

`canTransition({ ticket, to, user, now })` returns `{ ok, reason }`. Side effects: → resolved sets `resolved_at`; resolved → open clears `resolved_at`; → closed sets `closed_at`.

### 5.2 Endpoints

- `PATCH /api/tickets/:id/status` `{ status }`: lock row, check visibility, check transition (400 with reason), apply side effects, write `status` event.
- `PATCH /api/tickets/:id/assignment` `{ assigneeId | null }` (staff): assignee must be an active technician or admin in the org (400 otherwise); event stores old/new assignee **names** ("Unassigned" for null). Assigning an `open` ticket moves it to `in_progress` and writes that event too.
- `POST /api/tickets/:id/assign-to-me` (staff): same service.
- `PATCH /api/tickets/:id/priority` `{ priority }` (staff): writes event (SLA recalculation added in Phase 6).
- `GET/POST /api/tickets/:id/comments`: oldest first, author name and role; end users never receive internal notes (filtered in SQL); end users can't post internal notes (403); body 1 to 5000; comments on closed tickets → 400 "This ticket is closed. Please submit a new one."; first **public** staff comment sets `first_response_at` if null; requester reply on an `on_hold` ticket moves it to `in_progress` with an event.
- `GET /api/tickets/:id/events`: newest first with actor name ("System" for null); end users only see `created` and `status` events.
- `GET /api/tickets/:id/activity`: comments and events merged with `UNION ALL` into one shape (`type, id, actor_name, body, field, old_value, new_value, is_internal, created_at`), ordered by time, with the same visibility filters. The front end uses this for its feed.

### 5.3 Tests

Unit tests for every row of the workflow table and the 7-day window (fixed `now`). Integration: full lifecycle; illegal jump 400; requester can close and reopen own resolved ticket; can't reopen after 8 days; internal notes hidden from end users in comments, events and activity; first response only set by public staff comment; assigning to an end user 400; every change writes an event; concurrent status changes don't produce inconsistent events (two parallel requests, assert final state and event count are consistent).

### Commits

- `Add status workflow rules with unit tests`
- `Add status change endpoint with row locking`
- `Add assignment and priority endpoints`
- `Add comments, internal notes and first response tracking`
- `Add event history and activity feed endpoints`
- `Add workflow integration tests and update docs (Closes #7)`

### Carter's checks

1. `npm run lint; npm test`.
2. In Bruno: walk one ticket open → in_progress → on_hold → in_progress → resolved → closed; try open → closed (400).
3. Post an internal note as a technician; view comments as the end user (note absent).
4. Push. Issue #7 closes.

### Concept checks

- What does `SELECT ... FOR UPDATE` protect against?
- Why filter internal notes in SQL rather than in JavaScript?
- Why keep the workflow rules in pure functions?
- Why store names rather than ids in assignment events?

---

## Phase 6: SLAs and the breach-checking job (issue #8)

### 6.1 Decisions (write in `docs/architecture.md`)

24/7 calendar time; deadlines anchored to `created_at`; deadlines stored on the ticket (policy edits only affect new tickets and future priority changes); response met by first public staff comment; resolution met by `resolved_at`; at risk = less than 25% of the window left.

### 6.2 `src/modules/sla/sla.js` (pure)

- `computeDueDates(createdAt, policy)` → `{ responseDueAt, resolutionDueAt }`.
- `clockState({ startAt, dueAt, completedAt, now })` → `met | breached | at_risk | on_track | none` (completed late = breached).
- `slaSummary(ticket, now)` → `{ response, resolution, overall }` where overall is the more severe by rank breached > at_risk > on_track > met > none. So a met response plus on-track resolution is `on_track`.

### 6.3 Wiring

- `createTicket`: insert, then set due dates from the returned `created_at` and the org's policy, same transaction.
- `changePriority`: recalculate both deadlines from `created_at`; the event stores the old and new resolution deadline (or add a second `resolution_due_at` event).
- Every ticket returned (list and detail) includes `sla: slaSummary(ticket)`.

### 6.4 Breach job

- `008_sla_breaches.sql`: add `response_breached_at` and `resolution_breached_at` to tickets; `mark_sla_breaches()` `SECURITY DEFINER`, `SET search_path = public`, returning `(ticket_id INT, org_id INT, clock TEXT)`. Use **two separate statements** (response, then resolution), each an `UPDATE ... WHERE <clock>_breached_at IS NULL ... RETURNING` in a CTE that also inserts `sla_breach` events with `actor_id NULL`. Two statements because one statement can't safely update the same row twice. Grant execute only to `resolvd_app`.
- `src/jobs/slaChecker.js`: `runSlaCheck()` (exported for tests) and `startSlaChecker()` using node-cron every 5 minutes, with an overlap guard and error logging that never crashes the server. Started in `server.js` unless `NODE_ENV === 'test'`; stopped during graceful shutdown.
- The idempotency property (a breach recorded only once) is tested.

### 6.5 Queue filters

`sla=breached` and `sla=at_risk` in `listTickets` (at risk: not resolved/closed, not breached, `resolution_due_at - NOW() < (resolution_due_at - created_at) * 0.25`).

### 6.6 SLA policies admin

`GET /api/sla-policies` (staff), `PUT /api/sla-policies/:priority` (admin; response < resolution, 5 minutes to 90 days).

### 6.7 Tests

Unit tests for all clock states and the summary edge case. Integration: critical ticket deadlines are +1h/+4h; priority change recalculates from `created_at`; `runSlaCheck` records a breach once (run twice, one event); filters; policy validation; non-admin `PUT` 403.

### Commits

- `Add SLA calculation functions with unit tests`
- `Set SLA deadlines on create and priority change`
- `Add SLA breach migration and background job`
- `Add SLA filters and policy admin endpoints`
- `Add SLA integration tests and docs (Closes #8)`

### Carter's checks

1. `npm run migrate; npm run lint; npm test`.
2. Create a critical ticket in Bruno; confirm deadlines.
3. As `resolvd_owner` in pgAdmin, set a ticket's `resolution_due_at` to 10 minutes ago; with `npm run dev` running, wait up to 5 minutes and watch the log; check the `sla_breach` event; wait another run and confirm no duplicate.
4. Push. Issue #8 closes.

### Concept checks

- Why store deadlines on the ticket instead of calculating from the current policy?
- What does idempotent mean, and why does the breach job need it?
- Why does the job use a SECURITY DEFINER function?

---

## Phase 7: Front end foundation (issue #9)

### 7.1 Setup

- `npm create vite@latest client -- --template react` (the `client/` folder may contain only `.gitkeep`; handle that).
- Install `@mantine/core @mantine/hooks @mantine/form @mantine/notifications @mantine/dates dayjs react-router-dom @tanstack/react-query @tabler/icons-react`, dev `postcss postcss-preset-mantine postcss-simple-vars`. Follow Mantine's current Vite setup (PostCSS config, style imports).
- ESLint + Prettier matching the server's style. Scripts: `dev`, `build`, `preview`, `lint`.
- Vite proxy: `/api` → `http://localhost:4000`.

### 7.2 Structure

```
client/src/
├── api/          client.js, auth.js, tickets.js, users.js, categories.js, sla.js
├── auth/         useAuth.js, RequireAuth.jsx, RequireRole.jsx
├── components/   StatusBadge, PriorityBadge, SlaBadge, EmptyState, PageHeader
├── features/auth, features/tickets, features/admin
├── layouts/      AppLayout.jsx
├── constants.js  labels and colours for statuses and priorities
├── theme.js
├── App.jsx, main.jsx
```

### 7.3 Pieces

- `api/client.js`: `api(path, { method, body, query })` with `credentials: 'include'`, JSON handling, `ApiError(status, code, message, details)`.
- `main.jsx`: `QueryClient` (`retry: 1`, `refetchOnWindowFocus: true`), `MutationCache` `onError` showing a red notification with the API's message, `QueryCache` `onError` that on 401 clears the cache and redirects to `/login` (except for the `['me']` query); providers: QueryClientProvider, MantineProvider (custom theme, indigo or teal primary), Notifications, BrowserRouter.
- `useAuth`: `['me']` query (401 → null), `isStaff`, `logout()` (calls API, clears cache).
- `RequireAuth` (loader, redirect with `state.from`), `RequireRole` (friendly no-access message; front-end guards are UX only, the API enforces security).
- Routes: public `/login`, `/register`; behind auth in `AppLayout`: `/` → `/tickets`, `/tickets`, `/tickets/new`, `/tickets/:id`; admin only `/admin/users`, `/admin/categories`, `/admin/sla`; 404 page. Pages built in Phase 8 can be placeholders now.
- `AppLayout`: Mantine AppShell; header with Resolvd name, org name, light/dark toggle, user menu (name, role, sign out); navbar with Tickets, New ticket, admin section for admins; burger collapse on mobile.
- `LoginPage`: email, password, loading state, error alert, link to register, demo logins box (filled in Phase 10), and a note that the first load may take up to a minute (Render cold start).
- `RegisterPage`: org name, slug auto-generated from the name but editable, name, email, password, confirm; shows API field errors under inputs.

Every component follows the State / Data / Handlers / Render structure in `CLAUDE.md`.

### 7.4 Tests

Add Vitest + React Testing Library + jsdom to the client; test `api/client.js` error parsing and the slug generator. Keep it small.

### Commits

- `Create React app with Mantine and API proxy`
- `Add API client, query setup and auth hook`
- `Add routes, guards and app shell`
- `Add sign in, sign up and sign out pages (Closes #9)`

### Carter's checks

1. Two terminals: `cd server; npm run dev` and `cd client; npm run dev`; open `http://localhost:5173`.
2. Sign in as each seed role; admins see Admin, others don't. Refresh while signed in (stays signed in). Visit `/admin/users` as an end user.
3. Register a new org.
4. Try phone width in dev tools.
5. **Screenshot:** sign-in page → `docs/screenshots/07-sign-in.png`.
6. `cd client; npm run lint; npm test; npm run build`. Push. Issue #9 closes.

### Concept checks

- Why does the Vite proxy matter for cookies?
- What does TanStack Query handle that `useEffect` fetching doesn't?
- Why aren't front-end route guards real security?

---

## Phase 8: Ticket pages and admin screens (issue #10)

### 8.1 Back end additions

Ticket detail response includes `allowedTransitions` (statuses where `canTransition` is ok for this viewer), `canEdit`, `canComment`. Add tests.

### 8.2 Shared components

`StatusBadge`, `PriorityBadge` (icon for critical), `SlaBadge` ("Due in 2h", "At risk, 25m left", "Breached 1h ago", "Met"; dayjs `relativeTime`), `EmptyState`. Labels and colours from `constants.js`.

### 8.3 Ticket queue (`TicketQueuePage`)

- Filters live in the URL (`useSearchParams`); changing a filter resets the page.
- Staff tabs: My tickets (`assignee=me`), Unassigned, All open (`status=open,in_progress,on_hold`), Breached (`sla=breached`). End users: Open, Closed.
- Filter bar: status and priority MultiSelects, search debounced 300 ms.
- Table: ID, Title, Status, Priority, SLA, Assignee, Category, Updated; row click opens the ticket; sortable headers. Default sort for staff `resolution_due_at asc`, end users `created_at desc`.
- Pagination with "Showing 26 to 50 of 132"; skeletons; empty state with Clear filters; `keepPreviousData`.
- Card list instead of the table at narrow widths.

### 8.4 New ticket

Title, category Select, priority SegmentedControl (critical only for staff) with helper text explaining each level, description Textarea (autosize), validation matching API limits; on success notification "RES-1042 created", invalidate `['tickets']`, navigate to it.

### 8.5 Ticket detail

Two columns on desktop (stacked on mobile).
- Left: header (display id, title, badges, inline edit when `canEdit`, sending `expectedUpdatedAt`); activity feed from `/activity` (comments as cards, internal notes yellow with an "Internal" label, events as one-liners); comment box with an Internal note switch for staff, disabled when `!canComment`.
- Right sidebar: status Select limited to `allowedTransitions` (end users on a resolved ticket see "Yes, it's fixed" and "Still having this issue" instead), priority and assignee selects plus Assign to me (staff), SLA panel (both clocks), details.
- Mutations invalidate the ticket, its activity, and `['tickets']`. Friendly 404 page. 409 shows "changed by someone else" with a reload button.

### 8.6 Admin pages

- Users: table (name, email, role, active, last login), role select per row, active switch, Add user modal; shows the last-admin error.
- Categories: list, inline rename, add.
- SLA policies: four rows, hours/days input converted to minutes; note that changes apply to new tickets and priority changes.

### 8.7 Polish

`document.title` per page ("RES-1042 · Resolvd"); `aria-label` on icon buttons; dark mode checked on every page; relative dates with full date in a Tooltip.

### Commits

- `Return allowed actions from ticket detail`
- `Add status, priority and SLA badges and empty state`
- `Add ticket queue with URL filters and pagination`
- `Add new ticket page`
- `Add ticket detail page with activity feed and controls`
- `Add admin pages for users, categories and SLA policies`
- `Polish page titles, accessibility and dark mode (Closes #10)`

### Carter's checks

1. Full flow in the browser: end user submits; technician finds it in Unassigned, assigns to self, adds an internal note, replies, resolves; end user sees the reply but not the note, confirms the fix; admin adds a technician, edits an SLA policy, renames a category.
2. Two browser profiles (Acme and Globex) side by side; neither sees the other's data.
3. **Screenshots:** `08-ticket-queue.png`, `08-ticket-detail.png`, `08-new-ticket.png`, `08-admin-users.png`, `08-queue-dark.png`, `08-mobile.png`.
4. Lint, test and build both apps. Push. Issue #10 closes.

### Concept checks

- Why do filters live in the URL?
- Why does the API send `allowedTransitions` instead of the front end working them out?
- What does `invalidateQueries` do after a mutation?

---

## Phase 9: Test infrastructure, isolation suite and CI (issue #11)

Some tests already exist from earlier phases. This phase makes the setup complete and adds the critical suites.

### 9.1 Environment and setup

- `server/.env.test` (Carter creates it from a new `server/.env.test.example`) pointing at `resolvd_test`, with `NODE_ENV=test`, both URLs, `JWT_SECRET`, `CLIENT_ORIGIN`, `SEED_PASSWORD`.
- `server/vitest.config.js`: node environment, `env: { NODE_ENV: 'test' }`, `globalSetup: './tests/globalSetup.js'` (runs `migrate()` then `seed()` on the test DB), `fileParallelism: false`, `testTimeout: 15000`.
- `tests/helpers.js`: `app = createApp()`, `loginAs(email)` returning a Supertest agent, `createUser(...)` helper using the owner connection for test-only users.

### 9.2 Required suites (fill gaps from earlier phases)

- **Unit:** workflow, SLA, pagination helper, slug/display helpers.
- **Integration:** auth, users, categories, tickets, workflow, comments, SLA, health.
- **Isolation (`tests/integration/isolation.test.js`):** sign in as Globex admin and attempt every endpoint that takes an id against Acme records (ticket detail, update, status, assignment, assign-to-me, priority, comments GET/POST, events, activity, users PATCH, categories PATCH); each must return 404. Globex lists never contain Acme data. Assigning an Acme ticket to a Globex technician id fails. **Raw RLS test:** connect with `pg` as `resolvd_app`, `SELECT count(*) FROM tickets` without the setting returns 0; with the setting inside a transaction returns only that org's rows.
- **Authorization sweep:** a table of every route with the roles allowed; loop and assert other roles get 403 (or 404 where visibility applies). Build the table from the routers if practical so new routes can't be forgotten.
- **Concurrency:** 20 parallel ticket creations by one user produce 20 unique consecutive numbers.

### 9.3 CI: `.github/workflows/ci.yml`

- On push and pull_request.
- Job `server`: ubuntu-latest, `postgres:18` service with health check, create the two roles and `resolvd_test` with `psql`, `actions/setup-node` with Node 26 and npm cache (`server/package-lock.json`), env vars as GitHub-only test values (not secrets; they're throwaway CI credentials), `npm ci`, `npm run lint`, `npm test`.
- Job `client`: setup-node, `npm ci`, `npm run lint`, `npm test`, `npm run build` in `client`.
- Coverage: add `@vitest/coverage-v8` and a `test:coverage` script; don't gate CI on a percentage.

### Commits

- `Complete Vitest setup with dedicated test database`
- `Add organization isolation and raw RLS test suite`
- `Add authorization sweep and concurrency tests`
- `Add GitHub Actions CI for server and client (Closes #11)`

### Carter's checks

1. Create `server/.env.test` from the example; `npm test` passes locally.
2. **Screenshot:** isolation suite passing → `docs/screenshots/09-isolation-tests.png`.
3. Push. Watch the Actions tab until both jobs are green. Private repos have a monthly free CI minute limit; this project uses very little.
4. **Screenshot:** green Actions run → `docs/screenshots/09-ci-passing.png`. Issue #11 closes.

### Concept checks

- Unit vs integration tests: why both?
- How does the isolation suite prove RLS works independently of the `WHERE` clauses?
- What does CI catch that running tests locally doesn't?

---

## Phase 10: Demo data, deployment and v1.0 release (issue #12)

### 10.1 Demo seed: `npm run seed:demo`

- Org **Northbridge Logistics** (`northbridge`): 1 admin, 3 technicians, 8 end users with realistic names (`@northbridge.test` emails), defaults.
- ~45 realistic tickets from templates in `server/db/seeds/demo-tickets.js` (vague and specific, polite and frustrated: Outlook password prompts, VPN drops, new hire setup, printer jams, shared drive access, MFA, Teams audio, etc.).
- `created_at` spread over 30 days, weighted to recent; statuses ~30% closed, 20% resolved, 25% in progress, 10% on hold, 15% open (some unassigned); deadlines via `computeDueDates`; 4 or 5 breached and a few at risk; 1 to 5 comments per worked ticket including internal notes; matching events.
- Resets only the demo org (deletes and recreates it); never touches Acme/Globex.
- Uses `MIGRATION_DATABASE_URL` and `SEED_PASSWORD`.

### 10.2 Deployment config (you write; Carter deploys)

- `client/vercel.json` with `/api/:path*` rewrite to the Render URL (placeholder `RENDER_SERVICE_URL`, and instructions to replace it) and SPA fallback.
- `render.yaml` (optional blueprint) or documented Render settings: root `server`, build `npm ci`, start `npm start`, health check `/api/health`.
- Production `trust proxy`: requests arrive via Vercel then Render, so the hop count may need adjusting for rate limiting to see real client IPs. Make it configurable (`TRUST_PROXY_HOPS`, default 1) and add an env flag `LOG_CLIENT_IP=true` (off by default) that logs `req.ip` on `/api/health`, so Carter can compare it with his public IP after deploying.
- `.github/workflows/reset-demo.yml`: daily at `0 8 * * *` UTC plus `workflow_dispatch`; runs `npm ci` and `npm run seed:demo` with `MIGRATION_DATABASE_URL: ${{ secrets.NEON_OWNER_URL }}` and `SEED_PASSWORD: ${{ secrets.DEMO_PASSWORD }}`.
- `docs/deployment.md`: step-by-step for Carter (Neon project and roles, connection strings: pooled for the app, direct for migrations, running migrate and seed against Neon from PowerShell and clearing the env vars afterwards, Render service and env vars, Vercel project, GitHub secrets, verifying, trust proxy check).

### 10.3 README

Full README: title and one-line pitch, CI badge, live demo and API docs links (placeholders until deployed), hero screenshot/GIF slots, demo logins per role, features, architecture paragraph plus a Mermaid diagram (browser → Vercel → Render API → Neon), engineering highlights linking to files (RLS, composite FKs, transactions and row locks, idempotent SLA job, lockout design, isolation suite), stack, running locally (PowerShell commands), testing, roadmap (v2, v3), and a "What I learned" section with a placeholder heading **for Carter to write himself**, plus a short "Built with AI assistance" note (Claude Code wrote the code from Carter's specification; Carter designed it and reviewed every phase).

### 10.4 Security pass (you run and report)

`npm audit --omit=dev` both apps; grep the full history for secrets (`git log -p` searching for `PASSWORD=`, `JWT_SECRET=`, connection strings with real-looking credentials); confirm cookies are `secure` in production, no stack traces in responses, login rate limit active, `.env*` never committed (`git log --all --name-only` check).

### Commits

- `Add demo seed with realistic tickets`
- `Add deployment config and nightly demo reset workflow`
- `Add deployment guide`
- `Write README with architecture and demo logins (Closes #12)` (only after Carter confirms deployment works; until then, make this commit without `Closes` and tell Carter)

### Carter's checks

1. Run `npm run seed:demo` locally and click through.
2. Follow `docs/deployment.md` (come back to chat Claude for help at any step).
3. Production checks: private window, desktop and phone, each role, cold start note visible.
4. **Screenshots:** `10-demo.gif` (20 to 30 seconds), retake Phase 8 screenshots with demo data.
5. Make the repo public only after the secret check passes (Settings → General → Danger Zone).
6. Tag and release: `git tag -a v1.0.0 -m "Resolvd v1.0.0: MVP"`, `git push origin v1.0.0`, create a GitHub Release.
7. Write "What I learned" yourself. Pin the repo; LinkedIn Projects, Featured, a post.

### Concept checks

- Why does the Vercel rewrite make cookies work in Safari?
- Why do migrations use a direct connection while the app uses the pooler?
- Why do the owner credentials live in GitHub Secrets rather than on Render?

---

## Phase 11 (v2): Knowledge base with full-text search

Ask Carter for the issue number first.

- `009_knowledge_base.sql`: `article_status` enum (`draft`, `published`); `kb_articles` (`id`, `organization_id`, `title`, `body` Markdown, `category_id`, `author_id`, `status`, `view_count`, `helpful_yes`, `helpful_no`, timestamps, generated `search_vector TSVECTOR` = title weight A + body weight B, `UNIQUE (organization_id, id)`, composite FKs); GIN index; trigger; RLS and grants.
- Endpoints: `GET /api/kb?q=&categoryId=&includeDrafts=` (search with `websearch_to_tsquery`, `ts_rank`, `ts_headline` snippet; end users only published), `GET /api/kb/:id` (increments views; drafts 404 for end users), `POST`/`PATCH` (staff), `POST /api/kb/:id/feedback`, `GET /api/kb/suggest?q=` (top 3 published; empty under 4 characters).
- **XSS safety:** escape the article text before `ts_headline` (or highlight in JS on escaped text) so only `<mark>` is ever rendered as HTML. Test with a malicious article.
- Front end: Knowledge base page, article page (`react-markdown`, no raw HTML), editor with Write/Preview, suggestions on the new ticket form (debounced 400 ms), "Insert article" for staff replies.
- Seed 15 to 20 real, useful articles into the demo org.
- Tests: ranking, drafts hidden, isolation, XSS.

Carter's checks: search the demo KB, screenshots `11-kb-search.png`, `11-ticket-suggestions.png`. Concept checks: what a tsvector holds; what the GIN index does; why `ts_headline` output needs care.

## Phase 12 (v2): Reporting dashboard

- `GET /api/reports/summary?from=&to=` (staff; max 1 year; `from < to`): open tickets by status; created per day with zero days (`generate_series` + LEFT JOIN); median resolution and first response (`percentile_cont(0.5)`, minutes); SLA compliance (`FILTER`); by category; technician workload (open assigned, resolved in range, compliance). All in one `withOrg`.
- `GET /api/reports/tickets.csv` streamed export.
- Run `EXPLAIN ANALYZE` on the slowest query with demo data; add an index if it helps; record before/after in `docs/architecture.md`.
- Front end: Dashboard page (date presets 7/30/90 days, stat cards, line chart, bar chart, workload table) with `@mantine/charts`.
- Tests: metric correctness on a small known dataset; isolation.

Carter's checks: screenshot `12-dashboard.png`. Concept checks: why `generate_series`; median vs average; what EXPLAIN ANALYZE showed.

## Phase 13 (v2): Email notifications with an outbox

- `010_email_outbox.sql`: `email_outbox` (`id`, `organization_id`, `to_email`, `template`, `payload JSONB`, `status` pending/sent/failed, `attempts`, `next_attempt_at`, `last_error`, `sent_at`, `created_at`, index `(status, next_attempt_at)`), RLS and grants; `claim_outbox_batch(p_limit)` with `FOR UPDATE SKIP LOCKED` and `complete_outbox_item(p_id, p_success, p_error)` with exponential backoff, failed after 5 attempts (both SECURITY DEFINER).
- Emails queued **in the same transaction** as the ticket change: created (requester), assigned (assignee), public staff reply (requester), requester reply (assignee), resolved (requester), SLA breach (assignee and admins, from the SLA job). Skip users with `email_notifications = false`.
- `src/jobs/emailWorker.js` every minute, nodemailer. `EMAIL_MODE` = `log` | `sandbox` | `live` in config; demo never sends real email.
- Templates in `src/modules/notifications/templates.js` with links back to tickets.
- Front end: My account page (notification toggle, password change).
- Tests: outbox rows created in the transaction and absent on rollback; retry/backoff logic; skip-locked claim.

Carter's checks: screenshot `13-email.png` from Ethereal/Mailtrap; tag `v2.0.0`. Concept checks: what the outbox pattern solves; `SKIP LOCKED`; why exponential backoff.

## Phase 14 (v3): ScreenGuide AI integration

ScreenGuide AI is Resolvd's AI assistant: it tries to fix problems live and escalates unresolved sessions into Resolvd as tickets. Its repo contains `docs/resolvd-integration.md`, the spec for what Resolvd must expose. **Before starting this phase, ask Carter to copy that file into `docs/` in this repo.** If it conflicts with anything below, the integration doc wins for wire formats; raise any conflict with Resolvd's conventions before coding.

Expected scope (confirm against the spec):

- `011_api_keys.sql`: `api_keys` (`id`, `organization_id`, `name`, `key_prefix`, `key_hash`, `created_by`, `last_used_at`, `revoked_at`, `created_at`), RLS and grants; a SECURITY DEFINER lookup by prefix for authentication.
- Keys shown once at creation; stored as a SHA-256 hash; header `Authorization: Bearer <key>`; admin endpoints to create, list (prefix only) and revoke; admin UI page.
- `POST /api/integrations/tickets`: API-key authenticated, creates a ticket for a requester identified by email in the org (or a configured fallback user), with `source = 'screenguide'`, an external session id, and the transcript/steps attached as an internal note. **Idempotent** via an `Idempotency-Key` header or the external session id (same request twice → same ticket). Returns `{ id, display_id }`.
- Add `source` (default `'web'`) and `external_ref` columns to tickets in the same migration.
- Rate limiting per key; audit events for key creation/revocation.
- Tests: valid key, revoked key, wrong org, idempotency, isolation.
- Update `docs/architecture.md` and the README roadmap.

Concept checks: why hash API keys; why idempotency matters for integrations; how API-key auth differs from cookie auth.
