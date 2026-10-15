# Contributing to Deps Watch

Thanks for helping. This doc covers **Git conventions**, **what to verify before a PR**, and how **quality tooling** fits in Alpha.

Also read: [README.md](./README.md) · [AGENTS.md](./AGENTS.md) · [ROADMAP.md](./ROADMAP.md)

The roadmap is a **living guide**, not a contract — same spirit here: conventions should stay light and useful.

---

## Git workflow

We use **trunk-based development**, not heavy GitFlow.

| Branch | Purpose |
| --- | --- |
| `main` | Default branch; keep it working for Alpha |
| `feat/<short-kebab>` | New behavior |
| `fix/<short-kebab>` | Bug fixes |
| `docs/<short-kebab>` | Docs only (README, roadmap, AGENTS, …) |
| `chore/<short-kebab>` | Tooling, repo hygiene, Deps Watch’s own deps |
| `test/<short-kebab>` | Adding or fixing tests only |

**Examples**

- `feat/pnpm-lock-detect`
- `fix/drawer-flash`
- `docs/git-conventions`
- `chore/add-eslint`
- `test/git-safety-unit`

**Guidelines**

- Branch from latest `main`
- Keep branches short-lived; open a PR sooner rather than later
- One concern per branch when practical
- No long-lived `develop` / release trains required for Alpha

Later (Beta / 1.0) we may add `release/x.y` if we need staged betas — not required now.

---

## Commit messages

Use **[Conventional Commits](https://www.conventionalcommits.org/)** (light form):

```
<type>: <short imperative summary>
```

| Type | When |
| --- | --- |
| `feat` | User-facing or API behavior |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `chore` | Tooling, config, deps of this repo |
| `test` | Tests only |
| `refactor` | Internal change, no intended behavior change |
| `style` | Formatting only (no logic change) |

**Examples**

```
feat: block Run here unless git status is clean
fix: stop drawer re-animating when git status loads
docs: add contributing git conventions
chore: add eslint and prettier
test: cover gitSafety clean-tree check
```

**Rules**

- Imperative mood: “add”, not “added”
- ~72 chars on the first line when possible
- Optional body for *why* (not a repeat of the diff)
- Optional scope: `feat(scan): …` if it helps
- Avoid: `wip`, `update`, `fix stuff`, `Apply AI changes`

**PR titles** should use the same style as commits (`feat: …`, `fix: …`).  
Squash-merge into `main` is fine for Alpha so history stays readable.

---

## Verify rules (before you open / update a PR)

Treat this as the **minimum quality gate**. Agents and humans should both run it.

### Required

1. **Build passes**
   ```bash
   npm run build
   ```
2. **No local-only files committed**
   - `projects.config.json`
   - `data/**`
   - `.env*`
   - personal absolute paths
3. **Scope stays honest**
   - PR does what the title says
   - No unrelated refactors bundled in
4. **Safety invariants preserved** (if you touch fix / git / scan)
   - Clean-Git gate for `Run here` still enforced server-side
   - Per-project scan (no “All projects” findings mix)
   - Local-first (no required cloud/SaaS)
5. **Manual smoke** when UI or APIs change
   - `npm run dev` → add/select project → scan → open a finding
   - Drawer should not flash/re-animate on git check
   - Copy command still works if auto-update is blocked

### When you change behavior

- Update **README** / **AGENTS** / **ROADMAP** only if users or agents need the new truth
- Roadmap edits are welcome (move / add / remove items) with a short “why”

### When tooling exists (see below)

If the repo has lint / format / test scripts, those become part of verify:

```bash
npm run lint      # when added
npm run format    # or format:check — when added
npm test          # unit — when added
npm run test:e2e  # when added
npm run build     # always
```

Until those scripts exist, **`npm run build` + smoke + invariants** is enough.

---

## Quality tooling in Alpha — yes, welcome

Linting, formatting, unit tests, and e2e are **not “only for 1.0”**.  
They are valid **Alpha technical work** (`chore/` / `test/` PRs), as long as they stay lightweight and help the PoC.

| Investment | Alpha-friendly approach |
| --- | --- |
| **Formatter** | Prettier (or similar) + format script; format on PR |
| **Linter** | ESLint for `src/` + `server/`; start strict-but-fixable |
| **Unit tests** | Fixtures for `gitSafety`, classify/semver, lockfile parsing |
| **e2e** | Optional later in Alpha: Playwright against `npm run dev` smoke paths |
| **CI** | GitHub Actions running verify scripts on PRs to `main` |

**Principles**

- Prefer **fast feedback** over a huge harness
- Don’t block the product PoC behind perfect coverage
- Add scripts to `package.json` and document them here + in README when they land
- Once added, they join the **Required verify** list above

Suggested first slices (good agent/human tasks):

1. `chore: add prettier + format script`
2. `chore: add eslint for ts sources`
3. `test: unit tests for gitSafety`
4. `chore: github action running build (+ lint/test when present)`

---

## PR checklist

Copy into the PR description if useful:

```md
## Summary
<!-- 1–3 bullets -->

## Type
- [ ] feat / fix / docs / chore / test / refactor

## Verify
- [ ] `npm run build` passes
- [ ] lint / format / test (if scripts exist)
- [ ] no `projects.config.json` or `data/` committed
- [ ] smoke checked if UI/API changed
- [ ] git gate / local-first invariants still hold (if touched)

## Notes
<!-- screenshots, roadmap moves, follow-ups -->
```

---

## Questions

Open an issue, or propose a small docs PR. Conventions can evolve with the project.
