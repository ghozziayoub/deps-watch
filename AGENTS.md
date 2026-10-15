# AGENTS.md — guide for AI coding agents

You are working in **Deps Watch**, a local (no SaaS) multi-project dependency dashboard for Node/JS/TS apps.

Read this file before large changes. Humans: see also [README.md](./README.md), [CONTRIBUTING.md](./CONTRIBUTING.md), and [ROADMAP.md](./ROADMAP.md).

---

## Product constraints (do not violate)

1. **Local-first** — no required cloud accounts, telemetry, or hosted backends.
2. **Per-project scanning** — do not bring back a combined “All projects” findings view.
3. **Auto-update safety** — `Run here` must keep the clean-Git gate (`server/gitSafety.ts`).
4. **Manual path always works** — copy folder + command even when auto-update is blocked.
5. **Package manager** — detect from lockfile / `packageManager` (default npm). Fix commands and **Run here** must use that manager (`server/packageManager.ts`).

---

## Repo map

| Path | Role |
| --- | --- |
| `src/main.ts` | UI state, render, events (vanilla TS, no framework) |
| `src/style.css` | UI styles |
| `src/types.ts` | Shared front-end types |
| `server/*.ts` | Scan, classify, fix, verify, git safety, project store |
| `vite.config.ts` | Dev server + `/api/*` middleware |
| `scripts/scan.ts` | CLI entry for scans |
| `projects.config.json` | Local only (gitignored) — created on first **Add project** |
| `data/` | Local reports / ignores (gitignored) |

### Request flow

```
UI (src/main.ts)
  → fetch /api/*
  → vite.config.ts middleware
  → server/* (scan, fix, projectsStore, gitSafety, …)
```

### Important modules

- `server/scan.ts` — `runScan(projectId)`, per-project reports
- `server/classify.ts` — feasibility + fix actions
- `server/fix.ts` — runs npm/ng; calls git gate first
- `server/gitSafety.ts` — clean repo required for auto-update
- `server/projectsStore.ts` — add/remove projects, file picker
- `server/angular.ts` / `group.ts` — Angular-specific (optional path)
- `server/framework.ts` — detect stack from `package.json`
- `server/packageManager.ts` — detect npm/yarn/pnpm/bun + build install/update/run commands
- `server/lockfileYarn.ts` / `lockfilePnpm.ts` — lock graph loaders
- `server/migrationGuides.ts` — official upgrade docs when latest major > current

---

## How to run

```bash
npm install
npm run dev          # http://localhost:5179
npm run build        # typecheck + vite build
npm run scan         # CLI scan all configured projects
npm run scan -- <id> # CLI scan one project
```

Do not commit `projects.config.json` or `data/`.

---

## Coding rules for agents

- **Small diffs** — change only what the task needs; no drive-by refactors.
- **Match existing style** — vanilla TS, explicit types, no new UI framework unless asked.
- **Preserve design language** in `style.css` (teal accent, Figtree / JetBrains Mono).
- **Full `app.innerHTML` re-renders** — avoid replaying drawer animation; patch small regions when possible (see git panel patching).
- **Server APIs** — keep JSON error shape `{ error: string }`; validate inputs in fix runner.
- **Security** — never weaken arg allowlists in `fix.ts` without a clear reason; no exploit/PoC tooling.
- **Features** — use [ROADMAP.md](./ROADMAP.md) as guidance, not law. It can be edited: move, add, or remove items when a better fit appears. Don’t expand an alpha bugfix into unrelated 1.0 work unless asked.

---

## Good first tasks (agent-friendly)

Pick one, keep the PR tiny:

1. Better empty/error UI when lockfile is missing
2. Persist last-selected `projectId` in `localStorage`
3. Document / improve verify-script auto-detection order
4. Deeper yarn/pnpm lock graph fidelity (peers / workspaces)
5. Unit tests for `gitSafety` / semver classify with fixtures

---

## Git (short)

- Branches: `feat|fix|docs|chore|test/<short-kebab>` off `main`
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`)
- Full rules: [CONTRIBUTING.md](./CONTRIBUTING.md)

## PR checklist (agents should verify)

- [ ] `npm run build` passes
- [ ] `npm run lint` / `npm test` / format check **if those scripts exist**
- [ ] Manual smoke: add project → scan → open drawer → git gate message sensible
- [ ] No secrets or absolute personal paths committed
- [ ] README / ROADMAP / CONTRIBUTING updated only when needed
- [ ] Drawer open does not flash (no full re-animate on git status)
- [ ] Branch + commit naming follow CONTRIBUTING

---

## What not to do

- Add auth, multi-tenant cloud, or analytics SDKs
- Replace the UI with React/Vue “because it’s nicer” without an explicit request
- Remove the git clean check for convenience
- Commit `node_modules`, `data/`, or local `projects.config.json`
