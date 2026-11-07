# Resolvd Build Log

## 2026-11-07 (Phase 0, steps 0.1 to 0.4)

**Did:**
- Installed Node.js (with fnm), PostgreSQL with pgAdmin, the PostgreSQL VS Code extension and Bruno
- Create a private `resolvd` repo on GitHub and connected to my `C:\Projects\resolvd` folder
- Set Git's default branch to `main` and configured my name and email on this PC
- Created the full project folder structure
- Wrote `.gitignore`, a placeholder README and this build log

**Problems:**
- `fnm` wasn't recognized right after installing. The installer updated PATH, but the open PowerShell window still had the old PATH, so a new window fixed it
- `psql` wasn't recognized, so I added `C:\Program Files\PostgreSQL\18\bin` to my user PATH
- My first `.gitignore` used `*.env`, which wouldn't have caught `.env.test`. Switched to `.env` plus `.env.*`, then un-ignored `.env.example`

**Learned:**
- Terminals only read PATH when they open, so any PATH change will always need a fresh window
- `.gitignore` rules are read top to bottom, so a `!` exception has to come after the rule it overrides
- Test ignore rules with a dummy files and `git status` rather than just assuming they work

**Concept check:**
- (Asnwered at the end of Pahse 0)

**Next:**
- Initialize the server package and install dependencies (0.5)
- Create the GitHub issues for each phase (0.6)