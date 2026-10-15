import { readFileSync } from 'node:fs'

const r = JSON.parse(readFileSync('./data/last-report.json', 'utf8'))
const projects = [
  ...new Set([
    ...(r.projects ?? []).map((p) => p.id),
    ...(r.findings ?? []).map((f) => f.projectId),
  ]),
].filter(Boolean)

function isAng(n) {
  return (
    n.startsWith('@angular/') ||
    n.startsWith('@angular-devkit/') ||
    n.startsWith('@angular-eslint/') ||
    n === '@angular/framework' ||
    n === '@angular-eslint/group'
  )
}

function isProd(f) {
  if (f.name === '@angular/framework') return true
  if (f.name === '@angular-eslint/group') return false
  if (f.kind === 'dependency') return true
  if (f.kind === 'devDependency') return false
  return (f.rootPaths || []).some((x) => x.rootKind === 'dependency')
}

const bad = []
const checks = {}

for (const pid of projects) {
  const all = r.findings.filter((f) => f.projectId === pid && !f.ignored)
  const act = all.filter((f) => f.feasibility !== 'ok')
  const prod = act.filter(isProd)
  const grp = all.find((f) => f.name === '@angular/framework')

  for (const f of act) {
    for (const a of f.fixActions || []) {
      if ((a.command.startsWith('ng ') || a.runner === 'ng') && !isAng(f.name)) {
        bad.push({ pid, name: f.name, issue: 'ng-on-non-angular', cmd: a.command })
      }
      const m = a.command.match(/@angular\/core@(\d+)/)
      if (m && Number(m[1]) < 15) {
        bad.push({ pid, name: f.name, issue: 'ng-absurd', cmd: a.command })
      }
    }
  }

  const spotNames = [
    'proxy-addr',
    'piscina',
    'bullmq',
    'handlebars',
    '@faker-js/faker',
    'nodemailer',
    'tar',
  ]

  checks[pid] = {
    actionable: act.length,
    productionActionable: prod.length,
    angularGroup: grp
      ? {
          current: grp.current,
          latest: grp.latest,
          cmd: grp.fixActions?.[0]?.command,
          members: grp.groupMembers?.length,
        }
      : null,
    spots: Object.fromEntries(
      spotNames.map((n) => {
        const f = act.find((x) => x.name === n)
        if (!f) return [n, null]
        return [
          n,
          {
            feas: f.feasibility,
            majorSec: !!f.securityRequiresMajor,
            current: f.current,
            bestFix: f.bestFix,
            actions: (f.fixActions || []).map((a) => a.label || a.command),
            reason: (f.reason || '').slice(0, 160),
          },
        ]
      }),
    ),
  }
}

console.log(JSON.stringify({ badCount: bad.length, bad, checks }, null, 2))
