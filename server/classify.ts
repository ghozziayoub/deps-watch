import semver from 'semver'
import {
  buildAngularFixActions,
  isAngularFrameworkPackage,
  isAngularScopedPackage,
  shouldUseNgUpdate,
} from './angular.ts'
import { applyPriority } from './priority.ts'
import type {
  AdvisoryInfo,
  DepKind,
  Feasibility,
  FixAction,
  PackageFinding,
  ParentEdge,
  RootPath,
} from './types.ts'

function pickBestFix(
  current: string,
  advisories: AdvisoryInfo[],
  availableVersions: string[],
): string | null {
  const candidates = new Set<string>()
  for (const adv of advisories) {
    for (const fixed of adv.fixedVersions) {
      if (semver.valid(fixed) && semver.gt(fixed, current)) {
        candidates.add(fixed)
      }
    }
  }

  const existing = [...candidates].filter((v) => availableVersions.includes(v))
  const pool = existing.length > 0 ? existing : [...candidates]
  if (pool.length === 0) return null

  pool.sort(semver.compare)
  return pool[0] ?? null
}

function npmCommand(args: string[]): string {
  return ['npm', ...args].join(' ')
}

function buildFixActions(input: {
  name: string
  kind: DepKind
  isDirect: boolean
  current: string | null
  latest: string | null
  wanted: string | null
  bestFix: string | null
  fixAvailable: boolean
  feasibility: Feasibility
  rootPaths: RootPath[]
  parents: ParentEdge[]
}): FixAction[] {
  const actions: FixAction[] = []
  if (input.feasibility === 'ok' || input.feasibility === 'vuln_no_fix') {
    return actions
  }

  // Angular packages themselves: never solo-npm — use ng update
  if (shouldUseNgUpdate(input.name)) {
    return buildAngularFixActions({
      name: input.name,
      isDirect: input.isDirect,
      current: input.current,
      bestFix: input.bestFix,
      wanted: input.wanted,
      latest: input.latest,
      feasibility: input.feasibility,
      rootPackage: input.name,
    })
  }

  const saveFlag =
    input.kind === 'devDependency' ? '--save-dev' : '--save'

  if (input.isDirect) {
    const securityTarget = input.bestFix
    const securityIsMajor =
      Boolean(securityTarget) &&
      Boolean(input.current) &&
      Boolean(semver.valid(securityTarget!)) &&
      Boolean(semver.valid(input.current!)) &&
      semver.major(securityTarget!) !== semver.major(input.current!)

    const updateTarget =
      input.feasibility === 'plan_major'
        ? input.latest
        : (input.wanted &&
            input.current &&
            semver.valid(input.wanted) &&
            semver.gt(input.wanted, input.current)
            ? input.wanted
            : input.latest)

    if (securityTarget && input.fixAvailable) {
      const args = ['install', `${input.name}@${securityTarget}`, saveFlag]
      actions.push({
        id: 'direct-security',
        label: securityIsMajor
          ? `Security fix ${securityTarget} (major bump)`
          : `Install security fix ${securityTarget}`,
        explanation: securityIsMajor
          ? `Security fix for ${input.name} requires a major upgrade (${input.current} → ${securityTarget}). Review breaking changes.`
          : `Updates direct dependency ${input.name} to the fixed version.`,
        runner: 'npm',
        args,
        command: npmCommand(args),
        targetPackage: input.name,
        targetVersion: securityTarget,
      })
    }

    if (updateTarget && updateTarget !== securityTarget) {
      const args = ['install', `${input.name}@${updateTarget}`, saveFlag]
      const peerHint = peerMajorCaution(input.name)
      actions.push({
        id: 'direct-update',
        label:
          input.feasibility === 'plan_major'
            ? `Install ${updateTarget} (major)`
            : `Install ${updateTarget}`,
        explanation:
          input.feasibility === 'plan_major'
            ? `Major bump of direct dependency ${input.name}. Review breaking changes first.${peerHint}`
            : `Updates direct dependency ${input.name} within / to the selected target.`,
        runner: 'npm',
        args,
        command: npmCommand(args),
        targetPackage: input.name,
        targetVersion: updateTarget,
      })
    }

    return actions
  }

  // Transitive non-Angular
  const target = input.bestFix ?? input.latest
  const roots = input.rootPaths.slice(0, 6)
  const isAngularRoot = (name: string) =>
    isAngularFrameworkPackage(name) || name.startsWith('@angular-eslint/')
  const nonAngularRoots = roots.filter((r) => !isAngularRoot(r.rootPackage))
  const onlyAngularParents =
    roots.length > 0 && nonAngularRoots.length === 0

  for (const root of roots) {
    const rangeAllowsFix =
      Boolean(target) &&
      Boolean(semver.valid(target!)) &&
      semver.satisfies(target!, root.immediateRange, { includePrerelease: true })

    if (target && rangeAllowsFix) {
      const args = ['update', input.name]
      actions.push({
        id: `via-root-update:${root.rootPackage}`,
        label: `npm update ${input.name} (via ${root.rootPackage})`,
        explanation: `Pulled in by ${root.chain.join(' → ')}. Parent range ${root.immediateRange} already allows ${target}, so updating the lockfile may fix it without changing package.json.`,
        runner: 'npm',
        args,
        command: npmCommand(args),
        targetPackage: input.name,
        targetVersion: target,
      })
      break
    }
  }

  for (const root of nonAngularRoots) {
    const rootSave = root.rootKind === 'devDependency' ? '--save-dev' : '--save'
    const args = ['install', `${root.rootPackage}@latest`, rootSave]
    actions.push({
      id: `bump-root:${root.rootPackage}`,
      label: `Bump root ${root.rootPackage}@latest`,
      explanation: `${input.name} comes from ${root.chain.join(' → ')}. Updating the root package may pull a fixed/newer transitive version (not guaranteed — re-scan after).`,
      runner: 'npm',
      args,
      command: npmCommand(args),
      targetPackage: root.rootPackage,
      targetVersion: 'latest',
    })
  }

  if (onlyAngularParents) {
    // Prefer framework/CLI group over pinning tooling transitives into package.json
    if (actions.length > 0) {
      const first = actions[0]!
      first.explanation = `${first.explanation} Prefer refreshing via the Angular framework group (ng update) when possible.`
    }

    if (target && !isAngularScopedPackage(input.name)) {
      const args = ['install', `${input.name}@${target}`, '--save']
      actions.push({
        id: 'pin-transitive-last-resort',
        label: `Last resort: pin ${input.name}@${target}`,
        explanation: onlyAngularParents
          ? `${input.name} comes only through Angular tooling (${roots.map((r) => r.rootPackage).join(', ')}). Prefer the Angular framework group first; pin only if that does not refresh this package.`
          : 'Only if an Angular CLI/framework update does not refresh this package. Adds it as a direct dependency.',
        runner: 'npm',
        args,
        command: npmCommand(args),
        targetPackage: input.name,
        targetVersion: target,
      })
    }
  } else if (target && !isAngularScopedPackage(input.name)) {
    const args = ['install', `${input.name}@${target}`, '--save']
    actions.push({
      id: 'pin-transitive',
      label: `Pin ${input.name}@${target} as direct dep`,
      explanation:
        'Adds this package as a direct dependency so npm can hoist the fixed version. Use when root bumps do not help.',
      runner: 'npm',
      args,
      command: npmCommand(args),
      targetPackage: input.name,
      targetVersion: target,
    })
  }

  const seen = new Set<string>()
  return actions.filter((a) => {
    if (seen.has(a.command)) return false
    seen.add(a.command)
    return true
  })
}

function peerMajorCaution(name: string): string {
  const watched = new Set([
    'typescript',
    'eslint',
    '@types/node',
    'zone.js',
    'rxjs',
  ])
  if (!watched.has(name)) return ''
  return ' Check Angular (and other) peer dependency support before jumping majors.'
}

export function classifyPackage(input: {
  projectId: string
  projectName: string
  name: string
  kind: DepKind
  isDirect: boolean
  range: string
  current: string | null
  latest: string | null
  wanted: string | null
  versions: string[]
  advisories: AdvisoryInfo[]
  parents: ParentEdge[]
  rootPaths: RootPath[]
}): PackageFinding {
  const { current, latest, advisories, versions } = input
  const hasVuln = advisories.length > 0
  const bestFix =
    current && hasVuln ? pickBestFix(current, advisories, versions) : null
  const fixAvailable = Boolean(bestFix)

  let bump: PackageFinding['bump'] = null
  if (current && latest && semver.valid(current) && semver.valid(latest)) {
    if (semver.neq(current, latest)) {
      const diff = semver.diff(current, latest)
      if (
        diff === 'major' ||
        diff === 'minor' ||
        diff === 'patch' ||
        diff === 'prerelease'
      ) {
        bump = diff
      } else if (diff === 'premajor') {
        bump = 'major'
      } else if (diff === 'preminor') {
        bump = 'minor'
      } else if (diff === 'prepatch') {
        bump = 'patch'
      }
    }
  }

  let feasibility: Feasibility = 'ok'
  let reason = input.isDirect
    ? 'Up to date, no known advisories for the installed version.'
    : 'Transitive dependency with no known advisory on the installed version.'

  const isAngularPkg = shouldUseNgUpdate(input.name)

  if (!current) {
    feasibility = 'plan_major'
    reason = 'Installed version not found in lockfile; inspect manually.'
  } else if (hasVuln && !fixAvailable) {
    feasibility = 'vuln_no_fix'
    reason = input.isDirect
      ? 'Advisory exists for this version, but no published fixed version was found yet.'
      : `Transitive advisory with no published fix yet. Required by: ${summarizeParents(input.parents, input.rootPaths)}`
  } else if (hasVuln && fixAvailable) {
    feasibility = 'update_now'
    const securityIsMajor =
      Boolean(bestFix) &&
      Boolean(current) &&
      Boolean(semver.valid(bestFix!)) &&
      Boolean(semver.valid(current!)) &&
      semver.major(bestFix!) !== semver.major(current!)
    if (isAngularPkg) {
      reason = `Security fix available (at least ${bestFix}). Use ng update — do not bump a single @angular/* package with npm.`
    } else if (securityIsMajor) {
      reason = input.isDirect
        ? `Security fix available, but it requires a major bump (${current} → ${bestFix}). Review breaking changes.`
        : `Transitive security fix available, but it requires a major bump (${current} → ${bestFix}). ${summarizeRoots(input.rootPaths)}`
    } else {
      const onlyAng =
        input.rootPaths.length > 0 &&
        input.rootPaths.every(
          (r) =>
            isAngularFrameworkPackage(r.rootPackage) ||
            r.rootPackage.startsWith('@angular-eslint/'),
        )
      reason = input.isDirect
        ? `Security fix available (at least ${bestFix}).`
        : onlyAng
          ? `Transitive security fix available (at least ${bestFix}). Pulled only via Angular tooling — prefer the Angular framework group; pin only as last resort. ${summarizeRoots(input.rootPaths)}`
          : `Transitive security fix available (at least ${bestFix}). ${summarizeRoots(input.rootPaths)}`
    }
  } else if (
    input.isDirect &&
    current &&
    latest &&
    semver.valid(current) &&
    semver.valid(latest)
  ) {
    if (semver.lt(current, latest)) {
      if (bump === 'major') {
        feasibility = 'plan_major'
        reason = isAngularPkg
          ? `Major Angular update available (${current} → ${latest}). Use ng update @angular/core @angular/cli so the framework stays aligned.`
          : `Major update available (${current} → ${latest}).${peerMajorCaution(input.name)}`
      } else {
        feasibility = 'update_now'
        reason = isAngularPkg
          ? `${bump ?? 'version'} update available (${current} → ${latest}). Prefer ng update over installing ${input.name} alone.`
          : `${bump ?? 'version'} update available (${current} → ${latest}).`
      }
    }
  } else if (input.isDirect && latest && current !== latest) {
    feasibility = 'update_now'
    reason = isAngularPkg
      ? `Update available (${current} → ${latest}). Prefer ng update for Angular packages.`
      : `Update available (${current} → ${latest}).`
  }

  const securityRequiresMajor =
    Boolean(bestFix) &&
    Boolean(current) &&
    Boolean(semver.valid(bestFix!)) &&
    Boolean(semver.valid(current!)) &&
    semver.major(bestFix!) !== semver.major(current!)

  const fixActions = buildFixActions({
    name: input.name,
    kind: input.kind,
    isDirect: input.isDirect,
    current,
    latest,
    wanted: input.wanted,
    bestFix,
    fixAvailable,
    feasibility,
    rootPaths: input.rootPaths,
    parents: input.parents,
  })

  return applyPriority({
    projectId: input.projectId,
    projectName: input.projectName,
    name: input.name,
    kind: input.kind,
    isDirect: input.isDirect,
    range: input.range,
    current,
    latest,
    wanted: input.wanted,
    bump,
    advisories,
    fixAvailable,
    bestFix,
    feasibility,
    reason,
    parents: input.parents,
    rootPaths: input.rootPaths,
    fixActions,
    severity: 'none',
    priority: 0,
    ignored: false,
    securityRequiresMajor,
  })
}

function summarizeParents(parents: ParentEdge[], roots: RootPath[]): string {
  if (roots.length > 0) {
    const rootsList = [...new Set(roots.map((r) => r.rootPackage))].slice(0, 4)
    return `Root dep(s): ${rootsList.join(', ')}.`
  }
  if (parents.length > 0) {
    return `Parents: ${parents
      .slice(0, 3)
      .map((p) => `${p.parentName}@${p.parentVersion}`)
      .join(', ')}.`
  }
  return ''
}

function summarizeRoots(roots: RootPath[]): string {
  if (roots.length === 0) return 'No root path found in lockfile.'
  const unique = [...new Set(roots.map((r) => r.rootPackage))].slice(0, 4)
  return `Comes from root dep(s): ${unique.join(', ')}.`
}

export function emptyCounts(): Record<Feasibility, number> {
  return {
    ok: 0,
    update_now: 0,
    plan_major: 0,
    vuln_no_fix: 0,
  }
}
