import './style.css'
import type {
  Feasibility,
  FixAction,
  FixJob,
  MigrationGuide,
  PackageFinding,
  ProjectSummary,
  ScanReport,
  Severity,
} from './types.ts'

type ProjectInfo = {
  id: string
  name: string
  path: string
  verifyLabel: string | null
  framework?: string | null
  frameworkId?: string | null
  packageManager?: string | null
  packageManagerLabel?: string | null
  healthOk?: boolean
  healthCode?: string | null
  healthMessage?: string | null
  healthHint?: string | null
}

type GitSafetyStatus = {
  ok: boolean
  hasGit: boolean
  isRepo: boolean
  clean: boolean
  reason: string | null
  label: string
}

type Filters = {
  feasibility: Feasibility | 'all' | 'actionable'
  origin: 'all' | 'direct' | 'transitive'
  scope: 'all' | 'production'
  query: string
  showIgnored: boolean
}

const FEASIBILITY_LABEL: Record<Feasibility, string> = {
  ok: 'OK',
  update_now: 'Update now',
  plan_major: 'Plan major',
  vuln_no_fix: 'No fix yet',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: '',
}

const state: {
  projects: ProjectInfo[]
  activeProjectId: string | null
  report: ScanReport | null
  loading: boolean
  adding: boolean
  error: string | null
  filters: Filters
  detail: PackageFinding | null
  selectedActionId: string | null
  modal:
    | { kind: 'fix'; finding: PackageFinding; action: FixAction }
    | { kind: 'remove'; project: ProjectInfo }
    | null
  verifyAfterFix: boolean
  fixJob: FixJob | null
  fixOpen: boolean
  copied: string | null
  gitStatus: GitSafetyStatus | null
  gitLoading: boolean
  /** Play slide-in only on first open — re-renders must not re-animate. */
  drawerEnter: boolean
} = {
  projects: [],
  activeProjectId: null,
  report: null,
  loading: false,
  adding: false,
  error: null,
  filters: {
    feasibility: 'actionable',
    origin: 'all',
    scope: 'all',
    query: '',
    showIgnored: false,
  },
  detail: null,
  selectedActionId: null,
  modal: null,
  verifyAfterFix: true,
  fixJob: null,
  fixOpen: false,
  copied: null,
  gitStatus: null,
  gitLoading: false,
  drawerEnter: false,
}

const app = document.querySelector<HTMLDivElement>('#app')!

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function activeProject(): ProjectInfo | null {
  return (
    state.projects.find((p) => p.id === state.activeProjectId) ?? null
  )
}

function projectMeta(finding: PackageFinding) {
  return (
    state.report?.projects.find((p) => p.id === finding.projectId) ??
    state.projects.find((p) => p.id === finding.projectId)
  )
}

function projectPath(finding: PackageFinding): string {
  return projectMeta(finding)?.path ?? finding.projectName
}

function verifyLabelFor(finding: PackageFinding): string | null {
  const meta = projectMeta(finding)
  if (meta && 'verifyLabel' in meta) return meta.verifyLabel ?? null
  return null
}

function displayName(f: PackageFinding): string {
  if (f.name === '@angular/framework') return 'Angular framework'
  if (f.name === '@angular-eslint/group') return 'Angular ESLint'
  return f.name
}

function isAngularFinding(f: PackageFinding): boolean {
  return (
    f.name === '@angular/framework' ||
    f.name === '@angular-eslint/group' ||
    f.name.startsWith('@angular/') ||
    f.name.startsWith('@angular-eslint/')
  )
}

function isProductionFinding(f: PackageFinding): boolean {
  if (f.name === '@angular/framework') return true
  if (f.name === '@angular-eslint/group') return false
  if (f.kind === 'dependency') return true
  if (f.kind === 'devDependency') return false
  return (f.rootPaths ?? []).some((r) => r.rootKind === 'dependency')
}

function filteredFindings(): PackageFinding[] {
  if (!state.report) return []
  const { feasibility, origin, scope, query, showIgnored } = state.filters
  const q = query.trim().toLowerCase()

  return state.report.findings.filter((f) => {
    if (!showIgnored && f.ignored) return false
    if (scope === 'production' && !isProductionFinding(f)) return false
    if (origin === 'direct' && !f.isDirect && !f.isGroup) return false
    if (origin === 'transitive' && (f.isDirect || f.isGroup)) return false
    if (feasibility === 'actionable' && f.feasibility === 'ok') return false
    if (
      feasibility !== 'all' &&
      feasibility !== 'actionable' &&
      f.feasibility !== feasibility
    ) {
      return false
    }
    if (
      q &&
      !displayName(f).toLowerCase().includes(q) &&
      !f.name.toLowerCase().includes(q) &&
      !(f.groupMembers ?? []).some((m) => m.name.toLowerCase().includes(q)) &&
      !f.rootPaths.some((r) => r.rootPackage.toLowerCase().includes(q))
    ) {
      return false
    }
    return true
  })
}

function totals(report: ScanReport) {
  const counts = {
    ok: 0,
    update_now: 0,
    plan_major: 0,
    vuln_no_fix: 0,
  }
  for (const f of report.findings) {
    if (f.ignored) continue
    counts[f.feasibility] += 1
  }
  return counts
}

function selectedAction(finding: PackageFinding): FixAction | null {
  const id = state.selectedActionId
  return (
    finding.fixActions.find((a) => a.id === id) ??
    finding.fixActions[0] ??
    null
  )
}

function shortVia(f: PackageFinding): string {
  if (f.isGroup) {
    const n = f.groupMembers?.length ?? 0
    return `Group · ${n} packages`
  }
  if (f.isDirect) return 'Direct'
  const root = f.rootPaths[0]?.rootPackage
  return root ? `Via ${root}` : 'Transitive'
}

function sameVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  return a === b
}

function suggestedVersion(
  f: PackageFinding,
  action: FixAction | null = null,
): string | null {
  const fromAction = action?.targetVersion
  if (fromAction && fromAction !== 'latest') return fromAction
  if (f.feasibility === 'ok') return f.current
  if (f.feasibility === 'vuln_no_fix') return null
  if (f.bestFix) return f.bestFix
  if (f.feasibility === 'plan_major') return f.latest ?? f.wanted
  if (f.wanted && f.current && !sameVersion(f.wanted, f.current)) return f.wanted
  return f.latest ?? f.wanted
}

function suggestedLabel(f: PackageFinding): string {
  if (f.bestFix && f.feasibility === 'update_now') return 'Security fix'
  if (f.feasibility === 'plan_major') {
    return isAngularFinding(f) ? 'Suggested major' : 'Latest (major)'
  }
  if (isAngularFinding(f) && f.feasibility === 'update_now') {
    return 'Suggested (this major)'
  }
  if (f.feasibility === 'update_now') return 'Suggested'
  return 'Target'
}

function listTargetVersion(f: PackageFinding): string {
  return suggestedVersion(f, f.fixActions[0] ?? null) ?? '—'
}

function isNgAction(action: FixAction | null): boolean {
  return Boolean(
    action &&
      (action.runner === 'ng' ||
        action.command.startsWith('ng ') ||
        action.id.startsWith('ng-update')),
  )
}

function manualSteps(finding: PackageFinding, action: FixAction | null): string[] {
  const cwd = projectPath(finding)
  const steps = [
    `Open a terminal in the project folder`,
    `cd "${cwd}"`,
  ]

  if (!action) {
    if (finding.feasibility === 'vuln_no_fix') {
      steps.push('No published fix yet — monitor the advisory and re-scan later')
    } else {
      steps.push('No automatic fix suggested for this item')
    }
    return steps
  }

  if (isNgAction(action)) {
    steps.push('Optional check: ng update')
    steps.push(`Run: ${action.command}`)
    steps.push(
      'Let the CLI update related @angular/* packages together and apply migrations',
    )
  } else {
    steps.push(`Run: ${action.command}`)
  }

  if (finding.isGroup && finding.groupMembers?.length) {
    steps.push(
      `This covers: ${finding.groupMembers
        .slice(0, 6)
        .map((m) => m.name)
        .join(', ')}${finding.groupMembers.length > 6 ? '…' : ''}`,
    )
  } else if (!finding.isDirect && finding.rootPaths[0]) {
    steps.push(
      `This package is pulled by: ${finding.rootPaths[0].chain.join(' → ')}`,
    )
  }

  const verify = verifyLabelFor(finding)
  if (verify) {
    steps.push(`Optional verify: ${verify}`)
  }
  steps.push('Re-scan in Deps Watch to confirm the issue is gone')
  return steps
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return p
  return `…/${parts.slice(-3).join('/')}`
}

function activeMigrationGuide(): MigrationGuide | null {
  return (
    state.report?.projects.find((p) => p.id === state.activeProjectId)
      ?.migrationGuide ?? null
  )
}

function migrationGuideBannerHtml(guide: MigrationGuide | null | undefined): string {
  if (!guide) return ''
  return `
    <div class="banner guide" role="note">
      <div class="guide-copy">
        <strong>${escapeHtml(guide.frameworkLabel)} ${guide.fromMajor} → ${guide.toMajor}</strong>
        <span>Official guide for this major upgrade.</span>
      </div>
      <a class="btn ghost btn-sm" href="${escapeAttr(guide.url)}" target="_blank" rel="noreferrer">${escapeHtml(guide.title)} ↗</a>
    </div>`
}

/** Show guide in the drawer for the framework marker finding only. */
function drawerMigrationGuideHtml(finding: PackageFinding): string {
  const guide = activeMigrationGuide()
  if (!guide) return ''
  const show =
    finding.name === guide.markerPackage ||
    (guide.frameworkId === 'angular' &&
      (finding.name === '@angular/framework' ||
        finding.name === '@angular/core'))
  if (!show) return ''
  return `
    <div class="guide-inline">
      <p class="section-kicker">Major upgrade</p>
      <p class="hint">v${guide.fromMajor} → v${guide.toMajor}. Follow the official guide before running large updates.</p>
      <a class="guide-link" href="${escapeAttr(guide.url)}" target="_blank" rel="noreferrer">${escapeHtml(guide.title)} ↗</a>
    </div>`
}

function healthTitle(code: string | null | undefined): string {
  switch (code) {
    case 'missing_package_json':
      return 'package.json missing'
    case 'broken_package_json':
      return 'Broken package.json'
    case 'missing_lockfile':
      return 'Lockfile missing'
    case 'broken_lockfile':
      return 'Broken lockfile'
    default:
      return 'Project can’t be scanned'
  }
}

function installCommandFor(manager: string | null | undefined): string {
  switch (manager) {
    case 'yarn':
      return 'yarn install'
    case 'pnpm':
      return 'pnpm install'
    case 'bun':
      return 'bun install'
    default:
      return 'npm install'
  }
}

function projectProblemPanel(input: {
  title: string
  message: string
  hint?: string | null
  path?: string
  code?: string | null
  manager?: string | null
}): string {
  return `
    <section class="state-panel state-error" role="alert">
      <p class="eyebrow">Needs attention</p>
      <h2>${escapeHtml(input.title)}</h2>
      <p class="state-message">${escapeHtml(input.message)}</p>
      ${
        input.hint
          ? `<p class="state-hint">${escapeHtml(input.hint)}</p>`
          : ''
      }
      ${
        input.path
          ? `<p class="meta path-hint"><code>${escapeHtml(input.path)}</code></p>`
          : ''
      }
      ${
        input.code === 'missing_lockfile' || input.code === 'broken_lockfile'
          ? `<pre class="state-cmd">${escapeHtml(installCommandFor(input.manager))}</pre>`
          : ''
      }
    </section>`
}

function mainPanelHtml(
  project: ProjectInfo | null,
  report: ScanReport | null,
  summary: ProjectSummary | undefined,
  findings: PackageFinding[],
  counts: ReturnType<typeof totals> | null,
  ignoredCount: number,
): string {
  if (!project) {
    return `
      <section class="state-panel state-empty">
        <p class="eyebrow">Get started</p>
        <h2>Add a project</h2>
        <p class="state-message">Choose a folder’s <code>package.json</code> to start scanning dependencies.</p>
        <p class="state-hint">Uses the project’s package manager (npm, Yarn, pnpm, or Bun) from its lockfile or <code>packageManager</code> field — default npm.</p>
      </section>`
  }

  const preHealthBad = project.healthOk === false
  if (!report && preHealthBad) {
    return projectProblemPanel({
      title: healthTitle(project.healthCode),
      message: project.healthMessage ?? 'This project is not ready to scan.',
      hint: project.healthHint,
      path: project.path,
      code: project.healthCode,
      manager: project.packageManager,
    })
  }

  if (!report) {
    return `
      <section class="state-panel state-ready">
        <p class="eyebrow">Ready</p>
        <h2>Scan ${escapeHtml(project.name)}${
          project.framework && project.framework !== 'Unknown'
            ? ` <span class="framework-pill" data-framework="${escapeAttr(project.frameworkId ?? '')}">${escapeHtml(project.framework)}</span>`
            : ''
        }${
          project.packageManagerLabel
            ? ` <span class="framework-pill pm-pill">${escapeHtml(project.packageManagerLabel)}</span>`
            : ''
        }</h2>
        <p class="state-message">Check outdated packages and known vulnerabilities for this project.</p>
        <p class="meta path-hint"><code>${escapeHtml(project.path)}</code></p>
      </section>`
  }

  if (summary?.error) {
    return projectProblemPanel({
      title: healthTitle(summary.errorCode),
      message: summary.error,
      hint: summary.errorHint,
      path: project.path,
      code: summary.errorCode,
      manager: summary.packageManager ?? project.packageManager,
    })
  }

  return `
    ${migrationGuideBannerHtml(summary?.migrationGuide)}
    ${
      counts
        ? `<div class="status-row" role="group" aria-label="Status">
            <button type="button" class="status-pill ${state.filters.feasibility === 'actionable' ? 'active' : ''}" data-feasibility="actionable">Needs attention</button>
            <button type="button" class="status-pill ${state.filters.feasibility === 'vuln_no_fix' ? 'active' : ''}" data-feasibility="vuln_no_fix">No fix yet <b>${counts.vuln_no_fix}</b></button>
            <button type="button" class="status-pill ${state.filters.feasibility === 'update_now' ? 'active' : ''}" data-feasibility="update_now">Update now <b>${counts.update_now}</b></button>
            <button type="button" class="status-pill ${state.filters.feasibility === 'plan_major' ? 'active' : ''}" data-feasibility="plan_major">Plan major <b>${counts.plan_major}</b></button>
            <button type="button" class="status-pill ${state.filters.feasibility === 'ok' ? 'active' : ''}" data-feasibility="ok">OK <b>${counts.ok}</b></button>
            <button type="button" class="status-pill ${state.filters.feasibility === 'all' ? 'active' : ''}" data-feasibility="all">All</button>
          </div>`
        : ''
    }
    <div class="filters">
      <div class="seg" role="group" aria-label="Scope">
        <button type="button" class="seg-btn ${state.filters.scope === 'all' ? 'active' : ''}" data-scope="all">All scopes</button>
        <button type="button" class="seg-btn ${state.filters.scope === 'production' ? 'active' : ''}" data-scope="production">Production</button>
      </div>
      <div class="seg" role="group" aria-label="Origin">
        <button type="button" class="seg-btn ${state.filters.origin === 'all' ? 'active' : ''}" data-origin="all">All deps</button>
        <button type="button" class="seg-btn ${state.filters.origin === 'direct' ? 'active' : ''}" data-origin="direct">Direct</button>
        <button type="button" class="seg-btn ${state.filters.origin === 'transitive' ? 'active' : ''}" data-origin="transitive">Transitive</button>
      </div>
      <button type="button" class="seg-btn ignore-toggle ${state.filters.showIgnored ? 'active' : ''}" id="toggle-ignored">
        Ignored${ignoredCount ? ` (${ignoredCount})` : ''}
      </button>
      <input id="query" class="search" type="search" placeholder="Search package…" value="${escapeAttr(state.filters.query)}" />
      <span class="count">${findings.length}</span>
    </div>
    <section class="list" aria-label="Packages">
      ${
        findings.length === 0
          ? `<div class="state-panel state-empty compact">
              <p class="state-message">Nothing matches these filters.</p>
              <p class="state-hint">Try “All”, clear search, or include ignored items.</p>
            </div>`
          : findings.map((f) => rowHtml(f)).join('')
      }
    </section>`
}

function render(): void {
  const report = state.report
  const findings = filteredFindings()
  const counts = report ? totals(report) : null
  const job = state.fixJob
  const detail = state.detail
  const project = activeProject()
  const ignoredCount =
    report?.findings.filter((f) => f.ignored).length ?? 0
  const summary = report?.projects.find((p) => p.id === state.activeProjectId)

  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <div>
          <h1>Deps Watch</h1>
          <p class="lede">One scanner per project — fix, verify, or snooze.</p>
        </div>
        <div class="actions">
          <div class="action-row">
            <button type="button" class="btn ghost" id="add-project-btn" ${state.adding ? 'disabled' : ''}>
              Add project
            </button>
            <button type="button" class="btn primary" id="scan-btn" ${
              state.loading || !project ? 'disabled' : ''
            } title="${
              project?.healthOk === false
                ? escapeAttr(
                    `${project.healthMessage ?? 'Project has an issue'} — scan to re-check after you fix it.`,
                  )
                : 'Scan this project'
            }">
              ${state.loading ? 'Scanning…' : project ? `Scan ${escapeHtml(project.name)}` : 'Scan'}
            </button>
          </div>
          ${
            report && !summary?.error
              ? `<p class="meta">${formatWhen(report.scannedAt)}${
                  summary ? ` · ${Math.round(report.durationMs / 100) / 10}s` : ''
                }</p>`
              : project && project.healthOk === false
                ? `<p class="meta warn-meta">Not ready to scan</p>`
                : project && !report
                  ? `<p class="meta">Not scanned yet</p>`
                  : summary?.error
                    ? `<p class="meta warn-meta">Scan blocked</p>`
                    : ''
          }
        </div>
      </header>

      ${state.error ? `<div class="banner error" role="alert">${escapeHtml(state.error)}</div>` : ''}
      ${
        state.adding
          ? `<div class="banner info" role="status">File picker open — select that project’s <code>package.json</code>.</div>`
          : ''
      }

      <section class="project-rail" aria-label="Projects">
        ${
          state.projects.length === 0
            ? `<p class="rail-empty">No projects yet. Add a folder that contains a <code>package.json</code>.</p>`
            : state.projects
                .map((p) => {
                  const active = p.id === state.activeProjectId
                  const unhealthy = p.healthOk === false
                  return `
                  <div class="project-tab ${active ? 'active' : ''} ${unhealthy ? 'unhealthy' : ''}">
                    <button type="button" class="project-tab-main" data-project="${escapeAttr(p.id)}">
                      <span class="project-tab-name">
                        ${escapeHtml(p.name)}
                        ${
                          p.framework && p.framework !== 'Unknown'
                            ? `<span class="framework-pill" data-framework="${escapeAttr(p.frameworkId ?? '')}">${escapeHtml(p.framework)}</span>`
                            : ''
                        }
                        ${
                          p.packageManagerLabel
                            ? `<span class="framework-pill pm-pill">${escapeHtml(p.packageManagerLabel)}</span>`
                            : ''
                        }
                        ${unhealthy ? `<span class="framework-pill warn-pill">Issue</span>` : ''}
                      </span>
                      <span class="project-tab-path">${escapeHtml(shortPath(p.path))}</span>
                    </button>
                    <button type="button" class="project-tab-remove" data-remove-project="${escapeAttr(p.id)}" title="Remove project" aria-label="Remove ${escapeAttr(p.name)}">✕</button>
                  </div>`
                })
                .join('')
        }
      </section>

      ${mainPanelHtml(project, report, summary, findings, counts, ignoredCount)}
    </div>

    ${detail ? detailHtml(detail) : ''}
    ${
      state.modal?.kind === 'fix'
        ? fixModalHtml(state.modal.finding, state.modal.action)
        : state.modal?.kind === 'remove'
          ? removeModalHtml(state.modal.project)
          : ''
    }
    ${state.fixOpen && job ? progressHtml(job) : ''}
  `

  bindEvents()
}

function severityBadge(f: PackageFinding): string {
  const sev = (f.severity ?? 'none') as Severity
  if (sev === 'none') return ''
  return `<span class="tag tag-sev-${sev}">${SEVERITY_LABEL[sev]}</span>`
}

function extraBadges(f: PackageFinding): string {
  const bits: string[] = []
  if (f.securityRequiresMajor) {
    bits.push(`<span class="tag tag-major-sec">Major security</span>`)
  }
  return bits.join('')
}

function rowHtml(f: PackageFinding): string {
  const open =
    state.detail?.projectId === f.projectId && state.detail.name === f.name
  const target = listTargetVersion(f)
  const showArrow =
    f.feasibility !== 'ok' &&
    Boolean(target) &&
    target !== '—' &&
    !sameVersion(f.current, target)

  return `
    <article class="row ${open ? 'open' : ''} ${f.ignored ? 'ignored' : ''} row-${f.feasibility}">
      <button type="button" class="row-main" data-open-project="${escapeAttr(f.projectId)}" data-open-name="${escapeAttr(f.name)}">
        <span class="tag-stack">
          <span class="tag tag-${f.feasibility}">${FEASIBILITY_LABEL[f.feasibility]}</span>
          ${severityBadge(f)}
          ${extraBadges(f)}
          ${f.isGroup ? `<span class="tag tag-group">Group</span>` : ''}
          ${f.ignored ? `<span class="tag tag-ignored">Ignored</span>` : ''}
        </span>
        <span class="row-body">
          <span class="pkg-name">${escapeHtml(displayName(f))}</span>
          <span class="pkg-meta">${escapeHtml(shortVia(f))}</span>
        </span>
        <span class="versions">
          <code>${escapeHtml(f.current ?? '—')}</code>
          ${
            showArrow
              ? `<span class="arrow">→</span><code>${escapeHtml(target)}</code>`
              : f.feasibility === 'vuln_no_fix'
                ? `<span class="ver-note">no fix</span>`
                : ''
          }
        </span>
      </button>
    </article>
  `
}

/** Extra version facts shown under the main In use → Suggested strip. */
function extraVersionMetaHtml(
  finding: PackageFinding,
  action: FixAction | null,
): string {
  const suggested = suggestedVersion(finding, action)
  const wanted = finding.wanted
  const latest = finding.latest
  const rows: string[] = []

  if (
    wanted &&
    !sameVersion(wanted, finding.current) &&
    !sameVersion(wanted, suggested) &&
    !wanted.includes('versions')
  ) {
    rows.push(
      `<div class="meta-row"><span>Newest allowed</span><code>${escapeHtml(wanted)}</code></div>`,
    )
  }

  if (
    latest &&
    !sameVersion(latest, finding.current) &&
    !sameVersion(latest, suggested) &&
    !sameVersion(latest, wanted) &&
    !latest.includes('versions')
  ) {
    rows.push(
      `<div class="meta-row"><span>${
        isAngularFinding(finding) && finding.feasibility === 'update_now'
          ? 'Newest on npm (other major)'
          : 'Newest on npm'
      }</span><code>${escapeHtml(latest)}</code></div>`,
    )
  }

  if (finding.range && finding.range !== 'workspace') {
    rows.push(
      `<div class="meta-row"><span>Allowed range</span><code>${escapeHtml(finding.range)}</code></div>`,
    )
  }

  return rows.length ? `<div class="meta-grid">${rows.join('')}</div>` : ''
}

function detailHtml(finding: PackageFinding): string {
  const action = selectedAction(finding)
  const steps = manualSteps(finding, action)
  const cwd = projectPath(finding)
  const sev = (finding.severity ?? 'none') as Severity
  const suggested = suggestedVersion(finding, action)
  const origin = finding.isGroup
    ? 'Group'
    : finding.isDirect
      ? 'Direct'
      : 'Transitive'
  const canRun =
    Boolean(action) && !state.gitLoading && Boolean(state.gitStatus?.ok)

  return `
    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer${state.drawerEnter ? ' drawer-enter' : ''}" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header class="drawer-head">
        <div class="drawer-head-text">
          <p class="eyebrow">${escapeHtml(origin)} · ${escapeHtml(finding.projectName)}</p>
          <h2 id="drawer-title">${escapeHtml(displayName(finding))}</h2>
          <div class="drawer-badges">
            <span class="tag tag-${finding.feasibility}">${FEASIBILITY_LABEL[finding.feasibility]}</span>
            ${sev !== 'none' ? `<span class="tag tag-sev-${sev}">${SEVERITY_LABEL[sev]}</span>` : ''}
            ${finding.securityRequiresMajor ? `<span class="tag tag-major-sec">Major security</span>` : ''}
            ${finding.ignored ? `<span class="tag tag-ignored">Ignored</span>` : ''}
            <span class="tag tag-priority">P${finding.priority ?? 0}</span>
          </div>
        </div>
        <button type="button" class="icon-btn" id="drawer-close" aria-label="Close">✕</button>
      </header>

      <div class="drawer-scroll">
        <section class="drawer-section">
          <div class="version-strip">
            <div class="version-cell">
              <span class="version-label">In use</span>
              <code>${escapeHtml(finding.current ?? '—')}</code>
            </div>
            <span class="version-arrow" aria-hidden="true">→</span>
            <div class="version-cell accent">
              <span class="version-label">${
                finding.feasibility === 'vuln_no_fix'
                  ? 'Suggested'
                  : escapeHtml(suggestedLabel(finding))
              }</span>
              <code>${
                finding.feasibility === 'vuln_no_fix'
                  ? 'none yet'
                  : escapeHtml(suggested ?? '—')
              }</code>
            </div>
          </div>
          ${extraVersionMetaHtml(finding, action)}
          ${
            finding.isGroup && finding.groupMembers?.length
              ? `<div class="members">
                  <p class="section-kicker">Packages in this group</p>
                  <ul>${finding.groupMembers
                    .map(
                      (m) =>
                        `<li><code>${escapeHtml(m.name)}</code> <span class="muted">${escapeHtml(m.current ?? '—')} · ${FEASIBILITY_LABEL[m.feasibility]}</span></li>`,
                    )
                    .join('')}</ul>
                </div>`
              : !finding.isDirect && finding.rootPaths[0]
                ? `<div class="brought-by">
                    <p class="section-kicker">Brought by</p>
                    <code class="chain">${escapeHtml(finding.rootPaths[0].chain.join(' → '))}</code>
                  </div>`
                : ''
          }
          <p class="why">${escapeHtml(finding.reason)}</p>
          ${
            finding.advisories.length
              ? `<div class="advisories">${finding.advisories
                  .map(
                    (a) =>
                      `<a href="https://osv.dev/vulnerability/${encodeURIComponent(a.id)}" target="_blank" rel="noreferrer">${escapeHtml(a.id)}</a>`,
                  )
                  .join('')}</div>`
              : ''
          }
          ${drawerMigrationGuideHtml(finding)}
        </section>

        <section class="drawer-section">
          <h3>How to fix</h3>
          ${
            finding.fixActions.length > 1
              ? `<label class="field">
                  <span>Strategy</span>
                  <select id="action-select">
                    ${finding.fixActions
                      .map(
                        (a) =>
                          `<option value="${escapeAttr(a.id)}" ${action?.id === a.id ? 'selected' : ''}>${escapeHtml(a.label)}</option>`,
                      )
                      .join('')}
                  </select>
                </label>`
              : action
                ? `<p class="strategy">${escapeHtml(action.label)}</p>`
                : `<p class="hint">No automatic fix for this item.</p>`
          }
          ${action ? `<p class="hint">${escapeHtml(action.explanation)}</p>` : ''}

          <ol class="steps">
            ${steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${escapeHtml(s)}</span></li>`).join('')}
          </ol>

          <div class="cmd-box">
            <div class="cmd-line">
              <span class="cmd-label">Folder</span>
              <code>${escapeHtml(cwd)}</code>
              <button type="button" class="link-btn" data-copy="${escapeAttr(cwd)}">${state.copied === cwd ? 'Copied' : 'Copy'}</button>
            </div>
            ${
              action
                ? `<div class="cmd-line">
                    <span class="cmd-label">Command</span>
                    <code>${escapeHtml(action.command)}</code>
                    <button type="button" class="link-btn" data-copy="${escapeAttr(action.command)}">${state.copied === action.command ? 'Copied' : 'Copy'}</button>
                  </div>`
                : ''
            }
          </div>
        </section>

        ${
          action
            ? `<section class="drawer-section">
                <h3>Auto-update safety</h3>
                <div id="git-panel-host">${gitPanelInnerHtml()}</div>
              </section>`
            : ''
        }

        <section class="drawer-section last">
          <h3>Noise control</h3>
          ${
            finding.ignored
              ? `<button type="button" class="btn ghost" id="unignore-btn">Stop ignoring</button>`
              : `<div class="ignore-actions">
                  <button type="button" class="btn ghost btn-sm" data-ignore-days="">Ignore</button>
                  <button type="button" class="btn ghost btn-sm" data-ignore-days="7">Snooze 7d</button>
                  <button type="button" class="btn ghost btn-sm" data-ignore-days="30">Snooze 30d</button>
                </div>`
          }
        </section>
      </div>

      <footer class="drawer-foot">
        <button type="button" class="btn ghost" id="drawer-close-2">Close</button>
        ${
          action
            ? `<button type="button" class="btn primary" id="run-fix" data-fix-project="${escapeAttr(finding.projectId)}" data-fix-name="${escapeAttr(finding.name)}" data-fix-action="${escapeAttr(action.id)}" ${
                canRun ? '' : 'disabled'
              } title="${runFixTitle()}">Run here</button>`
            : ''
        }
      </footer>
    </aside>
  `
}

function runFixTitle(): string {
  if (state.gitStatus?.ok) return 'Run update in this project'
  return (
    state.gitStatus?.reason ?? 'Git must be clean for auto-update'
  )
}

function gitPanelInnerHtml(): string {
  const tone = state.gitLoading
    ? 'pending'
    : state.gitStatus?.ok
      ? 'ok'
      : 'blocked'

  if (state.gitLoading && !state.gitStatus) {
    return `<div class="git-panel pending" id="git-panel"><p class="git-status-text">Checking git…</p></div>`
  }

  if (state.gitLoading && state.gitStatus) {
    return `<div class="git-panel ${state.gitStatus.ok ? 'ok' : 'blocked'} refreshing" id="git-panel">
      <p class="git-status-text">${
        state.gitStatus.ok
          ? `<strong>Ready</strong> — working tree is clean.`
          : `<strong>Blocked</strong> — ${escapeHtml(state.gitStatus.reason ?? 'Git check failed.')}`
      } <span class="git-inline-busy">Checking…</span></p>
    </div>`
  }

  if (state.gitStatus?.ok) {
    return `<div class="git-panel ok" id="git-panel"><p class="git-status-text"><strong>Ready</strong> — working tree is clean.</p></div>`
  }

  return `<div class="git-panel ${tone}" id="git-panel">
    <p class="git-status-text"><strong>Blocked</strong> — ${escapeHtml(
      state.gitStatus?.reason ??
        'Git must be initialized and clean before Run here.',
    )}</p>
    <p class="git-hint">Copy the command above to run it yourself, or clean git and re-check.</p>
    <button type="button" class="btn ghost btn-sm" id="git-refresh">Re-check git</button>
  </div>`
}

/** Update git UI without rebuilding the whole drawer (avoids flash / re-animation). */
function patchGitPanel(): void {
  const host = document.querySelector('#git-panel-host')
  if (!host) {
    render()
    return
  }
  host.innerHTML = gitPanelInnerHtml()
  document.querySelector('#git-refresh')?.addEventListener('click', () => {
    if (state.detail) void loadGitStatus(state.detail.projectId)
  })

  const runBtn = document.querySelector<HTMLButtonElement>('#run-fix')
  if (runBtn) {
    const canRun = !state.gitLoading && Boolean(state.gitStatus?.ok)
    runBtn.disabled = !canRun
    runBtn.title = runFixTitle()
  }
}

function fixModalHtml(finding: PackageFinding, action: FixAction): string {
  const verify = verifyLabelFor(finding)
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">Run this fix?</h2>
        <p class="modal-copy">${escapeHtml(finding.projectName)} · <code>${escapeHtml(displayName(finding))}</code></p>
        <pre class="modal-cmd">${escapeHtml(action.command)}</pre>
        <p class="modal-note">Requires a clean git working tree so you can undo if verify fails.</p>
        ${
          verify
            ? `<label class="verify-check">
                <input type="checkbox" id="verify-toggle" ${state.verifyAfterFix ? 'checked' : ''} />
                <span>Verify after fix with <code>${escapeHtml(verify)}</code></span>
              </label>`
            : `<p class="modal-note">No verify script configured for this project.</p>`
        }
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="modal-cancel">Cancel</button>
          <button type="button" class="btn primary" id="modal-confirm">Confirm</button>
        </div>
      </div>
    </div>
  `
}

function removeModalHtml(project: ProjectInfo): string {
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">Remove this project?</h2>
        <p class="modal-copy"><code>${escapeHtml(project.name)}</code></p>
        <pre class="modal-cmd">${escapeHtml(project.path)}</pre>
        <p class="modal-note">Removes it from Deps Watch only — files on disk are not deleted.</p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="modal-cancel">Cancel</button>
          <button type="button" class="btn primary" id="modal-confirm">Remove</button>
        </div>
      </div>
    </div>
  `
}

function progressHtml(job: FixJob): string {
  const running =
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'verifying'
  const statusLabel =
    job.status === 'verifying'
      ? 'verifying'
      : job.verifyStatus === 'passed'
        ? 'done · verified'
        : job.verifyStatus === 'failed'
          ? 'fix ok · verify failed'
          : job.status

  return `
    <div class="progress-panel" id="progress-panel">
      <div class="progress-head">
        <div>
          <p class="eyebrow">Running</p>
          <h3>${escapeHtml(job.projectName)}</h3>
        </div>
        <button type="button" class="icon-btn light" id="progress-close" aria-label="Close">✕</button>
      </div>
      <p class="progress-cmd"><code>${escapeHtml(job.command)}</code></p>
      ${job.verifyLabel && job.verifyRequested ? `<p class="progress-cmd"><code>then ${escapeHtml(job.verifyLabel)}</code></p>` : ''}
      <div class="progress-bar"><i class="${running ? 'indeterminate' : job.status === 'done' ? 'full' : 'error'}"></i></div>
      <p class="meta">${escapeHtml(statusLabel)}</p>
      <pre class="progress-log" id="progress-log">${escapeHtml(job.logs.join('\n'))}</pre>
      ${
        job.status === 'done'
          ? `<button type="button" class="btn primary" id="progress-rescan">Re-scan</button>`
          : job.status === 'error'
            ? `<p class="banner error">${escapeHtml(job.error ?? 'Failed')}</p>`
            : ''
      }
    </div>
  `
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

function openDetail(projectId: string, name: string): void {
  const finding = state.report?.findings.find(
    (f) => f.projectId === projectId && f.name === name,
  )
  if (!finding) return

  const sameProject = state.detail?.projectId === projectId
  const alreadyOpen = state.detail?.name === name && sameProject
  if (alreadyOpen) return

  const drawerWasOpen = document.querySelector('.drawer') != null
  state.detail = finding
  state.selectedActionId = finding.fixActions[0]?.id ?? null
  // Keep last git result for this project while re-checking — avoids empty flash
  if (!sameProject) state.gitStatus = null
  state.gitLoading = true
  state.drawerEnter = !drawerWasOpen
  render()
  // Later full renders must not replay slide-in
  state.drawerEnter = false
  void loadGitStatus(projectId, { patchOnly: true })
}

async function loadGitStatus(
  projectId: string,
  opts: { patchOnly?: boolean } = {},
): Promise<void> {
  state.gitLoading = true
  if (opts.patchOnly && document.querySelector('#git-panel-host')) {
    patchGitPanel()
  } else if (!opts.patchOnly) {
    render()
  }

  try {
    const res = await fetch(
      `/api/git-status?projectId=${encodeURIComponent(projectId)}`,
    )
    const body = (await res.json()) as GitSafetyStatus & { error?: string }
    if (!res.ok) {
      state.gitStatus = {
        ok: false,
        hasGit: false,
        isRepo: false,
        clean: false,
        reason: body.error || 'Could not check git status',
        label: 'Error',
      }
    } else {
      state.gitStatus = body
    }
  } catch (error) {
    state.gitStatus = {
      ok: false,
      hasGit: false,
      isRepo: false,
      clean: false,
      reason: error instanceof Error ? error.message : String(error),
      label: 'Error',
    }
  } finally {
    state.gitLoading = false
    if (document.querySelector('#git-panel-host')) {
      patchGitPanel()
    } else {
      render()
    }
  }
}

async function refreshProjectList(): Promise<void> {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) return
    const body = (await res.json()) as { projects: ProjectInfo[] }
    state.projects = body.projects
  } catch {
    // keep existing list
  }
}

async function selectProject(projectId: string): Promise<void> {
  if (state.activeProjectId === projectId) return
  state.activeProjectId = projectId
  state.detail = null
  state.report = null
  state.error = null
  state.filters.query = ''
  render()
  await refreshProjectList()
  await loadReport(projectId)
}

function bindEvents(): void {
  document.querySelector('#scan-btn')?.addEventListener('click', () => {
    void runScan()
  })

  document.querySelector('#add-project-btn')?.addEventListener('click', () => {
    void addProject()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-project]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void selectProject(btn.dataset.project!)
    })
  })

  document
    .querySelectorAll<HTMLButtonElement>('[data-remove-project]')
    .forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        openRemoveModal(btn.dataset.removeProject!)
      })
    })

  document.querySelectorAll<HTMLButtonElement>('[data-feasibility]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.feasibility = btn.dataset.feasibility as Filters['feasibility']
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-origin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.origin = btn.dataset.origin as Filters['origin']
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.scope = btn.dataset.scope as Filters['scope']
      render()
    })
  })

  document.querySelector('#toggle-ignored')?.addEventListener('click', () => {
    state.filters.showIgnored = !state.filters.showIgnored
    render()
  })

  const query = document.querySelector<HTMLInputElement>('#query')
  query?.addEventListener('input', () => {
    state.filters.query = query.value
    const pos = query.selectionStart
    render()
    const next = document.querySelector<HTMLInputElement>('#query')
    if (next && pos != null) {
      next.focus()
      next.setSelectionRange(pos, pos)
    }
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-project]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDetail(btn.dataset.openProject!, btn.dataset.openName!)
    })
  })

  document.querySelector('#drawer-close')?.addEventListener('click', closeDetail)
  document.querySelector('#drawer-close-2')?.addEventListener('click', closeDetail)
  document.querySelector('#drawer-backdrop')?.addEventListener('click', closeDetail)

  const actionSelect = document.querySelector<HTMLSelectElement>('#action-select')
  actionSelect?.addEventListener('change', () => {
    state.selectedActionId = actionSelect.value
    render()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy ?? ''
      try {
        await navigator.clipboard.writeText(text)
        state.copied = text
        render()
        window.setTimeout(() => {
          if (state.copied === text) {
            state.copied = null
            render()
          }
        }, 1200)
      } catch {
        state.error = 'Could not copy to clipboard'
        render()
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-ignore-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.dataset.ignoreDays
      const days = raw === '' || raw == null ? null : Number(raw)
      void setIgnore(days)
    })
  })

  document.querySelector('#unignore-btn')?.addEventListener('click', () => {
    void clearIgnore()
  })

  document.querySelector('#git-refresh')?.addEventListener('click', () => {
    if (state.detail) void loadGitStatus(state.detail.projectId)
  })

  document.querySelector('#run-fix')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    if (btn.disabled) return
    if (!state.gitStatus?.ok) {
      state.error =
        state.gitStatus?.reason ??
        'Git must be initialized and clean before Run here.'
      render()
      return
    }
    void openFixModal(
      btn.dataset.fixProject!,
      btn.dataset.fixName!,
      btn.dataset.fixAction!,
    )
  })

  document.querySelector('#modal-cancel')?.addEventListener('click', () => {
    state.modal = null
    render()
  })
  document.querySelector('#modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      state.modal = null
      render()
    }
  })
  document.querySelector('#verify-toggle')?.addEventListener('change', (e) => {
    state.verifyAfterFix = (e.target as HTMLInputElement).checked
  })
  document.querySelector('#modal-confirm')?.addEventListener('click', () => {
    if (state.modal?.kind === 'fix') void confirmFix()
    else if (state.modal?.kind === 'remove') void confirmRemove()
  })

  document.querySelector('#progress-close')?.addEventListener('click', () => {
    state.fixOpen = false
    render()
  })
  document.querySelector('#progress-rescan')?.addEventListener('click', () => {
    state.fixOpen = false
    state.detail = null
    void runScan()
  })

  const log = document.querySelector('#progress-log')
  if (log) log.scrollTop = log.scrollHeight
}

function closeDetail(): void {
  state.detail = null
  state.selectedActionId = null
  state.gitLoading = false
  state.drawerEnter = false
  render()
}

async function setIgnore(days: number | null): Promise<void> {
  if (!state.detail) return
  try {
    const res = await fetch('/api/ignores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: state.detail.projectId,
        name: state.detail.name,
        days,
      }),
    })
    const body = (await res.json()) as {
      report?: ScanReport
      error?: string
    }
    if (!res.ok) throw new Error(body.error || 'Ignore failed')
    if (body.report) state.report = body.report
    state.detail = null
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function clearIgnore(): Promise<void> {
  if (!state.detail) return
  try {
    const res = await fetch('/api/ignores/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: state.detail.projectId,
        name: state.detail.name,
      }),
    })
    const body = (await res.json()) as {
      report?: ScanReport
      error?: string
    }
    if (!res.ok) throw new Error(body.error || 'Unignore failed')
    if (body.report) state.report = body.report
    const refreshed = state.report?.findings.find(
      (f) =>
        f.projectId === state.detail!.projectId && f.name === state.detail!.name,
    )
    state.detail = refreshed ?? null
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function openFixModal(
  projectId: string,
  name: string,
  actionId: string,
): Promise<void> {
  const finding = state.report?.findings.find(
    (f) => f.projectId === projectId && f.name === name,
  )
  const action = finding?.fixActions.find((a) => a.id === actionId)
  if (!finding || !action) {
    state.error = 'Fix action not found. Re-scan and try again.'
    render()
    return
  }

  await loadGitStatus(projectId)
  if (!state.gitStatus?.ok) {
    state.error =
      state.gitStatus?.reason ??
      'Git must be initialized and clean before Run here.'
    render()
    return
  }

  state.verifyAfterFix = Boolean(verifyLabelFor(finding))
  state.modal = { kind: 'fix', finding, action }
  render()
}

function openRemoveModal(id: string): void {
  const project = state.projects.find((p) => p.id === id)
  if (!project) return
  state.modal = { kind: 'remove', project }
  render()
}

async function confirmFix(): Promise<void> {
  if (state.modal?.kind !== 'fix') return
  const { finding, action } = state.modal
  const verify = state.verifyAfterFix
  state.modal = null
  state.error = null
  render()

  try {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: finding.projectId,
        findingName: finding.name,
        actionId: action.id,
        verify,
      }),
    })
    const body = (await res.json()) as FixJob & { error?: string }
    if (!res.ok) throw new Error(body.error || `Fix failed (${res.status})`)
    state.fixJob = body
    state.fixOpen = true
    render()
    watchFixJob(body.id)
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

function watchFixJob(jobId: string): void {
  const source = new EventSource(`/api/fix/${jobId}/stream`)
  source.onmessage = (event) => {
    const data = JSON.parse(event.data) as {
      type: string
      lines?: string[]
      status?: FixJob['status']
      verifyStatus?: FixJob['verifyStatus']
      job?: FixJob
      error?: string
    }

    if (data.type === 'hello' && data.job) {
      state.fixJob = data.job
      state.fixOpen = true
      render()
      return
    }

    if (data.type === 'log' && state.fixJob?.id === jobId) {
      state.fixJob = {
        ...state.fixJob,
        logs: [...state.fixJob.logs, ...(data.lines ?? [])],
        status: data.status ?? state.fixJob.status,
        verifyStatus: data.verifyStatus ?? state.fixJob.verifyStatus,
      }
      render()
      return
    }

    if (data.type === 'done' && data.job) {
      state.fixJob = data.job
      state.fixOpen = true
      render()
      source.close()
      return
    }

    if (data.type === 'error') {
      state.error = data.error ?? 'Fix stream error'
      source.close()
      render()
    }
  }
  source.onerror = () => {
    source.close()
  }
}

async function runScan(): Promise<void> {
  const projectId = state.activeProjectId
  if (!projectId) return
  state.loading = true
  state.error = null
  state.detail = null
  render()
  try {
    await refreshProjectList()
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    const body = (await res.json()) as ScanReport & { error?: string }
    if (!res.ok) throw new Error(body.error || `Scan failed (${res.status})`)
    state.report = body
    await refreshProjectList()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.loading = false
    render()
  }
}

async function loadReport(projectId: string): Promise<void> {
  try {
    const res = await fetch(`/api/report?projectId=${encodeURIComponent(projectId)}`)
    if (res.ok) {
      state.report = (await res.json()) as ScanReport
    } else {
      state.report = null
    }
  } catch {
    state.report = null
  }
  render()
}

async function addProject(): Promise<void> {
  state.adding = true
  state.error = null
  render()
  try {
    const browseRes = await fetch('/api/projects/browse', { method: 'POST' })
    const browseBody = (await browseRes.json()) as {
      path?: string | null
      error?: string
    }
    if (!browseRes.ok) {
      throw new Error(browseBody.error || 'Could not open folder picker')
    }
    if (!browseBody.path) {
      state.adding = false
      render()
      return
    }

    const addRes = await fetch('/api/projects/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: browseBody.path }),
    })
    const addBody = (await addRes.json()) as {
      project?: ProjectInfo
      projects?: ProjectInfo[]
      error?: string
    }
    if (!addRes.ok) throw new Error(addBody.error || 'Could not add project')

    state.projects = addBody.projects ?? state.projects
    if (addBody.project) {
      state.activeProjectId = addBody.project.id
      state.report = null
      state.detail = null
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
  } finally {
    state.adding = false
    render()
  }
}

async function confirmRemove(): Promise<void> {
  if (state.modal?.kind !== 'remove') return
  const { project } = state.modal
  state.modal = null
  state.error = null
  render()

  try {
    const res = await fetch('/api/projects/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id }),
    })
    const body = (await res.json()) as {
      projects?: ProjectInfo[]
      error?: string
    }
    if (!res.ok) throw new Error(body.error || 'Remove failed')

    state.projects = body.projects ?? []
    if (state.activeProjectId === project.id) {
      state.activeProjectId = state.projects[0]?.id ?? null
      state.report = null
      state.detail = null
      if (state.activeProjectId) {
        await loadReport(state.activeProjectId)
        return
      }
    }
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

async function bootstrap(): Promise<void> {
  render()
  try {
    const res = await fetch('/api/config')
    if (res.ok) {
      const body = (await res.json()) as { projects: ProjectInfo[] }
      state.projects = body.projects
      state.activeProjectId = body.projects[0]?.id ?? null
      render()
      if (state.activeProjectId) {
        await loadReport(state.activeProjectId)
      }
    }
  } catch {
    // First run
  }
}

void bootstrap()
