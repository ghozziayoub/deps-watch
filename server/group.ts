import semver from 'semver'
import {
  buildAngularFixActions,
  isAngularEslintPackage,
  isAngularFrameworkPackage,
} from './angular.ts'
import { applyPriority } from './priority.ts'
import type { Feasibility, PackageFinding } from './types.ts'

const FEASIBILITY_RANK: Record<Feasibility, number> = {
  vuln_no_fix: 0,
  update_now: 1,
  plan_major: 2,
  ok: 3,
}

function worstFeasibility(items: PackageFinding[]): Feasibility {
  return items.reduce<Feasibility>(
    (worst, item) =>
      FEASIBILITY_RANK[item.feasibility] < FEASIBILITY_RANK[worst]
        ? item.feasibility
        : worst,
    'ok',
  )
}

function validVersions(
  items: PackageFinding[],
  field: 'current' | 'latest' | 'wanted',
): string[] {
  return [
    ...new Set(
      items
        .map((i) => i[field])
        .filter((v): v is string => Boolean(v) && Boolean(semver.valid(v))),
    ),
  ].sort(semver.compare)
}

/** Single version, or "min – max" when members diverge. */
function formatVersionSpan(
  items: PackageFinding[],
  field: 'current' | 'latest' | 'wanted',
): string | null {
  const versions = validVersions(items, field)
  if (versions.length === 0) return null
  if (versions.length === 1) return versions[0]!
  return `${versions[0]} – ${versions[versions.length - 1]}`
}

function pickMaxVersion(
  items: PackageFinding[],
  field: 'current' | 'latest' | 'wanted',
): string | null {
  const versions = validVersions(items, field)
  return versions[versions.length - 1] ?? null
}

function mergeGroup(
  members: PackageFinding[],
  meta: {
    name: string
    labelReason: string
    eslint: boolean
  },
): PackageFinding {
  const sample = members[0]!
  const feasibility = worstFeasibility(members)
  const advisories = members.flatMap((m) => m.advisories)
  const bestFix =
    members.map((m) => m.bestFix).find((v) => Boolean(v)) ?? null
  const latestSpan = formatVersionSpan(members, 'latest')
  const currentSpan = formatVersionSpan(members, 'current')
  const wantedSpan = formatVersionSpan(members, 'wanted')
  const latestMax = pickMaxVersion(members, 'latest')
  const wantedMax = pickMaxVersion(members, 'wanted')

  const currentMax = pickMaxVersion(members, 'current')
  const fixActions = buildAngularFixActions({
    name: meta.eslint ? '@angular-eslint/schematics' : '@angular/core',
    isDirect: true,
    current: currentMax,
    bestFix,
    wanted: wantedMax,
    latest: latestMax,
    feasibility: feasibility === 'ok' ? 'update_now' : feasibility,
    rootPackage: meta.eslint ? '@angular-eslint/schematics' : '@angular/core',
  })

  const actionable = members.filter((m) => m.feasibility !== 'ok')
  const reason =
    actionable.length === 0
      ? meta.labelReason
      : `${actionable.length} Angular package(s) need attention. ${meta.labelReason}`

  const finding: PackageFinding = {
    projectId: sample.projectId,
    projectName: sample.projectName,
    name: meta.name,
    kind: 'dependency',
    isDirect: true,
    range: 'workspace',
    current: currentSpan,
    latest: latestSpan,
    wanted: wantedSpan,
    bump: members.some((m) => m.bump === 'major')
      ? 'major'
      : members.find((m) => m.bump)?.bump ?? null,
    advisories,
    fixAvailable: members.some((m) => m.fixAvailable),
    bestFix,
    feasibility,
    reason,
    parents: [],
    rootPaths: [],
    fixActions,
    isGroup: true,
    groupMembers: members
      .map((m) => ({
        name: m.name,
        current: m.current,
        latest: m.latest,
        feasibility: m.feasibility,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    severity: 'none',
    priority: 0,
    ignored: false,
    securityRequiresMajor: members.some((m) => m.securityRequiresMajor),
  }

  return applyPriority(finding)
}

/** Collapse Angular framework / eslint packages into one finding per project. */
export function groupAngularFindings(findings: PackageFinding[]): PackageFinding[] {
  const result: PackageFinding[] = []
  const byProject = new Map<string, PackageFinding[]>()

  for (const f of findings) {
    byProject.set(f.projectId, [...(byProject.get(f.projectId) ?? []), f])
  }

  for (const [, projectFindings] of byProject) {
    const framework: PackageFinding[] = []
    const eslint: PackageFinding[] = []
    const rest: PackageFinding[] = []

    for (const f of projectFindings) {
      if (isAngularEslintPackage(f.name)) eslint.push(f)
      else if (isAngularFrameworkPackage(f.name)) framework.push(f)
      else rest.push(f)
    }

    const frameworkActionable = framework.filter((f) => f.feasibility !== 'ok')
    if (frameworkActionable.length >= 1) {
      result.push(
        mergeGroup(frameworkActionable, {
          name: '@angular/framework',
          labelReason:
            'Update with ng update @angular/core @angular/cli so packages stay aligned.',
          eslint: false,
        }),
      )
    } else {
      result.push(...framework)
    }

    const eslintActionable = eslint.filter((f) => f.feasibility !== 'ok')
    if (eslintActionable.length >= 1) {
      result.push(
        mergeGroup(eslintActionable, {
          name: '@angular-eslint/group',
          labelReason: 'Update with ng update @angular-eslint/schematics.',
          eslint: true,
        }),
      )
    } else {
      result.push(...eslint)
    }

    result.push(...rest)
  }

  return result
}
