# Deps Watch

**Local multi-project dependency dashboard** for Node / JavaScript / TypeScript apps.

Scan outdated and vulnerable packages, prioritize what matters, run fixes from the UI, and verify the project still builds — without a SaaS account or phoning home.

> **Status:** Alpha (PoC) · version `0.1.0`  
> See [ROADMAP.md](./ROADMAP.md) for Beta (MVP) and 1.0 plans — the roadmap is a living guide, not a fixed contract (items can move, change, or be dropped).

---

## Why Deps Watch?

- Works with any project that has a `package.json` (React, Vue, Svelte, Nest, Koa, Fastify, Angular, Vite libs, …)
- Stays on your machine — config and reports are local files
- One scanner **per project** (no muddy “all projects” findings mix)
- Safe-by-default **Run here**: requires a clean Git working tree
- Angular gets extra help (`ng update` grouping); other stacks use npm-style fixes

---

## Requirements

- **Node.js** 20+ (recommended)
- **npm** (current alpha is npm / `package-lock.json` oriented)
- **Git** on `PATH` if you want in-app auto-updates
- **Windows** recommended for the file picker in this alpha (other OS: add projects via config; picker UI is limited)

---

## Install

```bash
git clone https://github.com/ghozziayoub/deps-watch.git
cd deps-watch
npm install
```

No config file is required up front. The first time you use **Add project** in the UI, Deps Watch creates `projects.config.json` for you. You can also edit that file by hand later (paths relative to the `deps-watch` folder, or absolute).

---

## Run

Start the local UI + API:

```bash
npm run dev
```

Open **http://localhost:5179/**

### CLI scan (optional)

```bash
# Scan every project in projects.config.json
npm run scan

# Scan one project by id
npm run scan -- my-api
```

### Production build

```bash
npm run build
npm run preview
```

---

## Features in 0.1.0 (Alpha)

| Area | What you get |
| --- | --- |
| **Projects** | Add / remove apps (pick a folder’s `package.json`); per-project tabs |
| **Scan** | Registry outdated checks + [OSV](https://osv.dev) advisories |
| **Graph** | Direct + transitive deps; production vs all scopes |
| **Priority** | Severity, feasibility (`update now` / `plan major` / `no fix yet`), ignore & snooze |
| **Framework detect** | Best-effort stack label from `package.json` (Angular, React, Next, Vue, Nest, …) |
| **Upgrade guides** | Official migration / update docs when the framework’s **latest major** is ahead of the project (see below) |
| **Angular** | Framework grouping and `ng update` suggestions |
| **Fix** | Copy command, or **Run here** with live progress |
| **Verify** | Optional post-fix script (`verifyScript` or auto-detected `typecheck` / `test` / `build` …) |
| **Safety** | Auto-update blocked unless Git exists and `git status` is clean |
| **Privacy** | No cloud account; reports under `data/reports/` |

### JS / TS framework upgrade guides

After a scan, if Deps Watch detects a framework and the **newest major on npm is greater than the major in use**, it shows a short banner (and a drawer link on the marker package) pointing at the official upgrade docs — not on every project, only when a major jump is relevant.

| Detected stack | Guide |
| --- | --- |
| **Angular** | [Angular Update Guide](https://angular.dev/update-guide) (linked with from → to majors) |
| **Next.js** | [Upgrading](https://nextjs.org/docs/app/building-your-application/upgrading) |
| **Nuxt** | [Upgrade](https://nuxt.com/docs/getting-started/upgrade) |
| **NestJS** | [Migration guide](https://docs.nestjs.com/migration-guide) |
| **Vue** | [Vue 3 migration](https://v3-migration.vuejs.org/) |
| **SvelteKit** | [Migrating](https://svelte.dev/docs/kit/migrating) |
| **Remix** | [Changelog](https://remix.run/docs/en/main/start/changelog) |
| **Astro** | [Upgrade guides](https://docs.astro.build/en/guides/upgrade-to/v5/) |

Stacks without a clear single official guide (e.g. plain React, Vite, Express, Fastify, Koa) do not get a banner.

### Config: `projects.config.json`

```json
{
  "projects": [
    {
      "id": "my-api",
      "name": "My API",
      "path": "../my-api",
      "verifyScript": "test"
    }
  ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Stable id (used for report files) |
| `name` | yes | Label in the UI |
| `path` | yes | Relative to Deps Watch root, or absolute |
| `verifyScript` | no | npm script name (`typecheck`) or full command (`npm run test:ci`, `ng build`) |

---

## Typical workflow

1. **Add project** — select that app’s `package.json`
2. **Scan** — review actionable findings
3. Commit or stash so Git is clean
4. Open a finding → copy the command, or **Run here**
5. Keep **Verify after fix** enabled when a verify script exists
6. **Re-scan** to confirm the issue is gone

> Auto-update does **not** roll back on verify failure in alpha. Use Git to undo, or reinstall the previous version manually. Snapshot rollback is planned for Beta — see the roadmap.

---

## Project layout

```
deps-watch/
  src/                 UI (Vite + TypeScript)
  server/              Scan, classify, fix, git safety, APIs
  scripts/             CLI scan helpers
  projects.config.json Your local project list (do not commit secrets/paths you don’t want public)
  data/reports/        Per-project scan reports (gitignored)
  ROADMAP.md           Alpha → Beta → 1.0
```

---

## For AI / agent collaborators

Tool-agnostic (Cursor, Claude, Gemini, Copilot, Windsurf, etc.):

1. Start with **[AGENTS.md](./AGENTS.md)** — architecture map, constraints, and PR checklist
2. Follow **[ROADMAP.md](./ROADMAP.md)** so Alpha work doesn’t jump into 1.0 scope

Point your agent at `AGENTS.md` first; that file is the shared source of truth for every tool.

---

## Contributing

Full guide: **[CONTRIBUTING.md](./CONTRIBUTING.md)** (branching, commit names, verify rules).

Deps Watch is an early alpha. Useful contributions:

1. Bug reports and clear repro steps
2. Support for **yarn** / **pnpm** lockfiles (Beta priority)
3. UX fixes and accessibility
4. **Quality tooling** — lint, format, unit/e2e tests, CI (welcome in Alpha)
5. Docs for stacks you use daily (Nest, Vue, …)

### Dev setup

```bash
npm install
npm run dev
```

### Before a PR

```bash
npm run build
```

Plus lint / test scripts once they exist — see CONTRIBUTING verify rules.

Keep the tool **local-first**, prefer small PRs, and don’t commit `projects.config.json` or `data/`.

---

## Security notes

- Deps Watch runs **npm** / **ng** commands on your machine in project folders you configure
- Only enable **Run here** on projects you trust and when Git is clean
- Reports may list package names and versions from your apps — treat `data/` as local

---

## License

[MIT](./LICENSE)

---

## Links

- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Agents: [AGENTS.md](./AGENTS.md)
- Roadmap: [ROADMAP.md](./ROADMAP.md)
