# Deps Watch — Roadmap

Local, no-SaaS multi-project dependency dashboard for Node/JS/TS apps that ship a `package.json` (React, Vue, Svelte, Nest, Koa, Fastify, Angular, Vite libs, etc.).

> **This roadmap is a living guide, not a contract.**  
> Items can move between Alpha / Beta / 1.0, be removed, rewritten, or replaced by better ideas that fit the project. Prefer what serves local-first deps tooling over sticking to an old checklist.

| Stage | Version | Goal |
| --- | --- | --- |
| **PoC** | Alpha `0.x` | Prove the loop: scan → prioritize → fix → verify |
| **MVP** | Beta `0.9.x` | Reliable for daily local use across common stacks |
| **Product** | `1.0` | Polished, packager-aware, safe by default |

---

## Alpha — PoC (current)

**Intent:** Works well for local multi-app setups. Detects npm / Yarn / pnpm / Bun. Angular gets extra help (`ng update`).

### Done (baseline)

- [x] Per-project scan + report (`data/reports/{id}.json`)
- [x] Add / remove projects (pick `package.json` via modern file dialog)
- [x] OSV advisories + npm registry outdated detection
- [x] Direct + transitive findings, production filter, ignore / snooze
- [x] Priority sorting, severity, Angular grouping + `ng update` actions
- [x] Framework detection from `package.json` + UI pills
- [x] Package manager detection (npm / Yarn / pnpm / Bun) + manager-aware scan / fix / verify commands
- [x] Official JS/TS upgrade / migration guides when latest major > current (Angular Update Guide, Next, Nuxt, Nest, Vue, …)
- [x] In-app fix runner with progress log
- [x] Optional verify-after-fix (`verifyScript` or auto-detected scripts)
- [x] Clean-git gate for **Run here** (repo required, working tree clean)
- [x] Manual copy of folder + command always available
- [x] Local Vite UI + Node middleware APIs only (no cloud)

### Alpha polish (optional before beta)

- [x] Document install, features, contributing ([README.md](./README.md), [CONTRIBUTING.md](./CONTRIBUTING.md))
- [x] Empty / error states for missing lockfile or broken `package.json`
- [ ] Persist last-selected project across reload

### Alpha engineering (welcome anytime — not blocked on Beta)

Quality tooling is **in scope for Alpha** as `chore/` / `test/` work. Keep it light and useful.

- [ ] Formatter (e.g. Prettier) + `format` / `format:check` scripts
- [ ] Linter (e.g. ESLint) for `src/` + `server/`
- [ ] Unit tests (start with `gitSafety`, classify/semver, lockfile fixtures)
- [ ] Optional e2e smoke (Playwright against dev server)
- [ ] GitHub Actions CI: build (+ lint/test when present) on PRs to `main`

Once added, these join the verify rules in [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Beta — MVP

**Intent:** Daily driver for any local JS/TS project with `package.json` + lockfile. Less Angular-centric; safer fixes; richer package-manager / workspace support.

### Package managers & projects

- [x] Detect package manager: **npm / yarn / pnpm / bun** (lockfile + `packageManager` field) — Alpha
- [x] Run installs/updates with the correct CLI — Alpha
- [x] Read yarn.lock / pnpm-lock.yaml graphs (best-effort) — Alpha
- [ ] Deeper yarn/pnpm graph fidelity (peer links, workspaces)
- [ ] Verify-script presets by stack (e.g. `typecheck`, `test`, `build`, Nest `test`, Vite `build`)
- [ ] Edit project name + verify script from the UI
- [ ] Batch “scan all projects” without bringing back an “All” findings mix-up (queue + per-project progress)

### Safer auto-update

- [ ] Snapshot `package.json` + lockfile before npm-style fixes
- [ ] On verify **fail**: restore snapshot + reinstall (no git required for this path)
- [ ] Keep **clean git required** for schematic / `ng update` (or any multi-file migrator)
- [ ] Clear UI copy: what will roll back vs what needs `git restore`
- [ ] Optional: create a local WIP commit before fix when git is clean (“deps-watch: before update”)

### UX / reliability

- [ ] Non-Windows folder/file picker path (or documented fallback)
- [ ] Cancel in-flight scan / fix
- [ ] History of last N scans per project (timestamp + counts)
- [ ] Export report as JSON / Markdown summary
- [ ] Better monorepo hints (workspace root vs package folder)

### Quality bar for “MVP done”

- [ ] Works on at least: React (Vite), Vue, Nest (or Fastify), and one Angular app
- [ ] npm + pnpm paths smoke-tested
- [ ] README: add project → scan → fix → verify → undo
- [ ] No critical UI flashes / double-animation regressions on drawer

---

## 1.0 — Stable local product

**Intent:** Trustworthy default for local teams. Still no SaaS required; optional offline-friendly behavior.

### Core product

- [ ] First-run wizard (add first project, pick verify script, explain git gate)
- [ ] Policy profiles: *security-only* / *actionable* / *include majors*
- [ ] Dependabot/OSV-style severity policies (e.g. block Run here for critical unless acknowledged)
- [ ] Scheduled local scans (OS task / simple watcher) with tray or CLI notify — optional
- [ ] Offline mode: use last registry/OSV cache with explicit staleness badge
- [ ] Signed / versioned config schema for `projects.config.json`

### Workspaces & scale

- [ ] pnpm / npm / yarn **workspaces** discovery (list packages, scan selected)
- [ ] Nx / Turborepo light detection (map apps, don’t pretend to be Nx)
- [ ] Parallel project scans with concurrency limit
- [ ] Large lockfile performance budget (streaming / incremental)

### Fix & rollback maturity

- [ ] Unified rollback model: git restore when available, else manifest snapshot
- [ ] Post-fix checklist (verify result, re-scan, link to changed files)
- [ ] Support `overrides` / `resolutions` / pnpm `overrides` suggestions for stubborn transitives
- [ ] Angular remains a first-class *plugin path*, not the default mental model

### Distribution

- [ ] One-command local start (`deps-watch` binary or `npx`-friendly package)
- [ ] macOS / Linux parity for pickers and git checks
- [ ] Minimal automated tests: scan fixtures, git gate, rollback snapshot
- [ ] Changelog + semver release process

### Quality bar for “1.0 done”

- [ ] Cross-platform smoke (Windows + macOS or Linux)
- [ ] npm / yarn / pnpm documented and tested
- [ ] Rollback path verified for npm install and documented limits for schematics
- [ ] Stable API for UI (`/api/*`) so a future desktop shell can wrap the same server

---

## Explicit non-goals (for now)

- Cloud accounts, hosted dashboards, or phoning home
- Replacing CI security gates (this is a **local** companion)
- Full SBOM / legal compliance suite
- Auto-PR / GitHub App integration (maybe post-1.0)

---

## Suggested sequencing

1. **Finish alpha polish** → tag `0.1` / `0.2`
2. **Beta:** package-manager detection + snapshot rollback + verify presets
3. **1.0:** workspaces, distribution, tests, cross-platform parity

When in doubt for beta: prefer **correct install tool + safe undo** over new UI chrome.

Editing this file in a PR is welcome — propose moves, drops, or new items with a short “why it fits Deps Watch.”
