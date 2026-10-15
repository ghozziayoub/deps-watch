import { readFileSync } from 'node:fs'

const r = JSON.parse(readFileSync('./data/last-report.json', 'utf8'))
const projects = [
  ...new Set([
    ...(r.projects ?? []).map((p) => p.id),
    ...(r.findings ?? []).map((f) => f.projectId),
  ]),
].filter(Boolean)
const issues = []
const samples = {}

function isAngularPkg(n) {
  return (
    n.startsWith('@angular/') ||
    n.startsWith('@angular-devkit/') ||
    n.startsWith('@angular-eslint/') ||
    n.startsWith('@schematics/angular') ||
    n === '@angular/framework' ||
    n === '@angular-eslint/group'
  )
}

for (const pid of projects) {
  const findings = r.findings.filter((f) => f.projectId === pid && !f.ignored)
  const actionable = findings.filter((f) => f.feasibility !== 'ok')
  samples[pid] = { total: findings.length, actionable: actionable.length }

  const angGroup = findings.find((f) => f.name === '@angular/framework')
  const core = findings.find((f) => f.name === '@angular/core')
  const angVer = angGroup?.current || core?.current
  const angMajor =
    angVer && !String(angVer).includes('versions')
      ? String(angVer).split('.')[0]
      : null

  for (const f of actionable) {
    for (const a of f.fixActions || []) {
      if (
        (a.runner === 'ng' || a.command.startsWith('ng ')) &&
        !isAngularPkg(f.name)
      ) {
        issues.push({
          pid,
          name: f.name,
          type: 'ng-on-non-angular',
          cmd: a.command,
        })
      }
      const m = a.command.match(/@angular\/core@(\d+)/)
      if (m && Number(m[1]) < 15 && Number(angMajor) >= 18) {
        issues.push({
          pid,
          name: f.name,
          type: 'ng-absurd-version',
          cmd: a.command,
          angMajor,
        })
      }
    }

    // Transitive security with parent caret range but only weird actions
    if (!f.isDirect && !f.isGroup && f.bestFix && f.fixAvailable) {
      const hasUpdate = (f.fixActions || []).some((a) =>
        a.command.startsWith('npm update '),
      )
      const rangeAllows = (f.rootPaths || []).some((rp) => {
        const range = rp.immediateRange || ''
        return range.startsWith('^') || range.startsWith('~') || range === '*'
      })
      if (rangeAllows && !hasUpdate && (f.fixActions || []).length > 0) {
        issues.push({
          pid,
          name: f.name,
          type: 'expected-npm-update-missing',
          range: f.rootPaths.map((x) => x.immediateRange),
          actions: f.fixActions.map((a) => a.command),
        })
      }
      if ((f.fixActions || []).length === 0) {
        issues.push({
          pid,
          name: f.name,
          type: 'actionable-no-actions',
          feas: f.feasibility,
          bestFix: f.bestFix,
        })
      }
    }
  }

  samples[pid].angularGroup = angGroup
    ? {
        members: angGroup.groupMembers?.length,
        current: angGroup.current,
        cmd: angGroup.fixActions?.[0]?.command,
        feas: angGroup.feasibility,
        sev: angGroup.severity,
      }
    : null

  samples[pid].top = actionable.slice(0, 10).map((f) => ({
    name: f.name,
    feas: f.feasibility,
    sev: f.severity,
    direct: f.isDirect || !!f.isGroup,
    group: !!f.isGroup,
    current: f.current,
    bestFix: f.bestFix,
    roots: [...new Set((f.rootPaths || []).map((x) => x.rootPackage))].slice(
      0,
      3,
    ),
    actions: (f.fixActions || []).slice(0, 3).map((a) => a.command),
  }))

  samples[pid].directMajors = actionable
    .filter((f) => f.isDirect && !f.isGroup && f.feasibility === 'plan_major')
    .slice(0, 6)
    .map((f) => ({
      name: f.name,
      current: f.current,
      latest: f.latest,
      action: f.fixActions?.[0]?.command,
    }))

  samples[pid].vulnNoFix = actionable
    .filter((f) => f.feasibility === 'vuln_no_fix')
    .map((f) => ({
      name: f.name,
      current: f.current,
      roots: [...new Set((f.rootPaths || []).map((x) => x.rootPackage))],
    }))
}

// Spotlight checks
const spot = {}
for (const name of ['proxy-addr', 'bullmq', 'express', 'handlebars', 'piscina']) {
  spot[name] = r.findings
    .filter((f) => f.name === name && projects.includes(f.projectId))
    .map((f) => ({
      project: f.projectName,
      feas: f.feasibility,
      current: f.current,
      bestFix: f.bestFix,
      actions: (f.fixActions || []).map((a) => a.command),
      roots: (f.rootPaths || []).map((x) => x.rootPackage),
    }))
}

console.log(
  JSON.stringify(
    {
      issueCount: issues.length,
      issues,
      spot,
      samples,
    },
    null,
    2,
  ),
)
