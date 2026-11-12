# Resolvd Build Log

## 2026-11-07 (Phase 0, steps 0.1 to 0.6)

**Did:**
- Installed Node.js (with fnm), PostgreSQL with pgAdmin, the PostgreSQL VS Code extension and Bruno
- Created a private `resolvd` repo on GitHub and connected to my `C:\Projects\resolvd` folder
- Set Git's default branch to `main` and configured my name and email on this PC
- Created the full project folder structure
- Wrote `.gitignore`, a placeholder README and this build log
- Initialized the server package and installed dependencies
- Created the phase issues (#2 to #12) and the v1.0 MVP, v2 and v3 milestones
- Switched to building with Claude Code from my own plan (CLAUDE.md and RESOLVD_PLAN.md); I review and push each phase myself
- Claude Code verified my setup, caught a typo in the `migrate` script and added `.gitattributes`, lint/format config and `.env.example`

**Problems:**
- `fnm` wasn't recognized right after installing. The installer updated PATH, but the open PowerShell window still had the old PATH, so a new window fixed it
- `psql` wasn't recognized, so I added `C:\Program Files\PostgreSQL\18\bin` to my user PATH
- My first `.gitignore` used `*.env`, which wouldn't have caught `.env.test`. Switched to `.env` plus `.env.*`, then un-ignored `.env.example`
- Issue #1 was taken by a deleted issue, so phase issues start at #2 and the first `Closes #1` didn’t close anything

**Learned:**
- Terminals only read PATH when they open, so any PATH change will always need a fresh window
- `.gitignore` rules are read top to bottom, so a `!` exception has to come after the rule it overrides
- Test ignore rules with a dummy file and `git status` rather than just assuming they work

**Concept check:**
- What does `"type": "module"` change?
    - It switches Node from CommonJS (`require`) to ES modules (`import`/`export`), the modern JavaScript standard, so relative imports need the `.js` extension
- Why is `.env` ignored by Git but `.env.example` committed?
    - In `.gitignore`, `.env` is specifically mentioned as a file to ignore, as well as `.env.*`. After those two lines `.env.example` is explicitly un-ignored. `.env` holds real secrets (database passwords, the JWT secret), and committing it to a public repo would expose them to anyone. `.env.example` has the same variable names with placeholder values, so anyone cloning the repo knows what to set up without seeing the actual secrets.
- What does `.gitattributes` fix on Windows?
    - It tells Git to store text files with LF line endings no matter which OS saved them. That stops the CRLF warnings and prevents diffs where every line looks changed just because of line endings

**Next:**
- Phase 1: database roles, migrations, row-level security and seed data (issue #3)

## 2026-11-11 (Phase 1: database, migrations and row-level security)

**Did:**
- Claude Code built the setup script, migration runner, migrations 001 to 007, seed script and RLS demo. It tested everything on a temporary PostgreSQL 18 cluster first, so my real server wasn't touched until I ran it
- Ran the setup myself to create the `resolvd_owner` and `resolvd_app` roles and the `resolvd_dev` and `resolvd_test` databases
- Filled in `server/.env` with real values (never committed)
- Ran the migrations twice (the second run correctly applied nothing) and seeded Acme Corp and Globex
- Ran the RLS demo as `resolvd_app` and took the screenshot
- Ran a compatibility check between Resolvd and ScreenGuide AI's shared tables

**Problems:**
- The setup command contains real passwords, so I cleared it from PowerShell history afterwards
- The first ScreenGuide compatibility check ran before Phase 1 was pushed, so it compared against the plan instead of the real migrations. I'm re-running it against the real code

**Learned:**
- Migrations are numbered SQL files, and a `schema_migrations` table records which have run, so every database ends up with the same schema
- Each migration and its tracking row commit in one transaction, so a failed migration is never recorded as done
- Row-level security makes PostgreSQL itself filter rows by organization, as a second layer behind the app's own checks

**Concept checks:**
- Why does the app connect as `resolvd_app` and not the table owner?
    - RLS doesn't apply to a table's owner, so if the API connected as the owner, every policy would be silently skipped. It's also least privilege: if the API were ever compromised, it couldn't drop or change tables
- What happens if `app.current_org_id` is never set?
    - `current_org_id()` returns NULL, so no row's `organization_id` matches and no rows are visible at all. It fails safe instead of showing everything
- What problem does the composite foreign key on `category_id` prevent?
    - A normal foreign key only checks the category exists somewhere. The composite key on `(organization_id, category_id)` checks it exists in the same organization, so an Acme ticket can't point at a Globex category
- Why is the tickets due-date index partial?
    - It only covers tickets that aren't resolved or closed, which are the only ones the SLA checker searches. It stays small and fast even as closed tickets pile up

**Next:**
- Phase 2: Express server foundation (issue #4)

## 2026-11-11 (Phase 2: Express server foundation)

**Did:**
- Claude Code built the Express foundation: validated config, pino logging, the database pool and `withOrg` transaction helpers, `AppError` and the error handler, security middleware, graceful shutdown, the health check and Swagger docs
- Asked it to match ScreenGuide AI's error handling so the two stay compatible: body-parser errors (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`), ten `AppError` helpers, and Zod 4's `z.flattenError` for validation details
- Created `server/.env.test` for the `resolvd_test` database
- Checked by hand: `/api/health` returned 200, then 503 with PostgreSQL stopped; Swagger UI loaded at `/api/docs`; removing `JWT_SECRET` gave a clear startup error; Ctrl+C logged "Shutting down"
- Ran lint and all 29 tests, and took two Swagger screenshots

**Problems:**
- 6 tests failed with "password authentication failed for user resolvd_app". The password in `.env.test` didn't match the real one. Copying it exactly from `.env` fixed it
- I accidentally edited `.env.test.example` (the committed placeholder file) instead of `.env.test`. `git diff` caught it before committing, and `git restore` put it back

**Learned:**
- When many tests fail at once, look for one shared cause. Here every database test failed and every non-database test passed
- Always check `git status` and `git diff` before committing; it caught my mistake
- Validating config at startup means a bad `.env` fails immediately with a clear message, instead of a confusing crash later

**Concept checks:**
- Why must every query inside `withOrg` use `client` instead of `pool`?
    - `withOrg` runs one transaction on one connection and sets `app.current_org_id` on it. `pool.query` could use a different connection, which would run outside the transaction and without the org setting, so RLS would hide everything and a rollback wouldn't undo it
- Why does the error handler need four parameters?
    - Express recognizes error-handling middleware by its four parameters `(err, req, res, next)`. With three, Express treats it as normal middleware and never sends errors to it
- Why are raw database errors never sent to the client?
    - They can reveal table names, column names and internal details an attacker could use. The full error goes to the server log, and the client gets a safe message and code
- What does `trust proxy` change?
    - On Render, requests arrive through a proxy, so Express would see the proxy's IP for every user. `trust proxy` tells Express to read the real client IP from the proxy's headers, so rate limiting works per user instead of treating everyone as one

**Next:**
- Phase 3: authentication, roles and admin endpoints (issue #5)