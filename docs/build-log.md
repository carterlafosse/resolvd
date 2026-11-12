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