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
