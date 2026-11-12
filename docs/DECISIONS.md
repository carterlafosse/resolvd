# Decisions

Choices made while building Resolvd that the build plan (`RESOLVD_PLAN.md`) did not dictate, newest phase last.

## Phase 0: Skeleton

- **Fixed the `migrate` script path.** `server/package.json` had `node sripts/migrate.js`; corrected to `node scripts/migrate.js` as the plan specifies.
- **`SEED_PASSWORD` added to `.env.example` now.** The plan's Phase 0 key list omits it, but Phase 1 needs it and asks for it as a placeholder. Adding it now means `server/.env` copied in Phase 0 already has every key Phase 1 uses. Keys for later phases (for example `TRUST_PROXY_HOPS`, `EMAIL_MODE`) are added in the phase that introduces them.
- **ESLint ignores `node_modules/`, `coverage/` and `dist/`.** Linting covers only our own source.
- **Dev-only `npm audit` advisories left as is.** `npm audit` (including dev dependencies) reports 4 moderate advisories in ESLint 10's `minimatch` dependency. The only automatic fix is a forced downgrade to ESLint 9. They only affect the local lint tool, not the running API (`npm audit --omit=dev` is clean), so we wait for an upstream fix.
- **`.gitkeep` only in folders that already existed.** Folders for modules the plan creates later (`health`, `organizations`, `sla`, `scripts/lib`) are created when their phase starts.
