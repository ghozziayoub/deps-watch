import semver from 'semver'
import type { Feasibility, FixAction } from './types.ts'

/** Packages that must move together via `ng update @angular/core @angular/cli`. */
const FRAMEWORK_PACKAGES = new Set([
  '@angular/animations',
  '@angular/common',
  '@angular/compiler',
  '@angular/compiler-cli',
  '@angular/core',
  '@angular/elements',
  '@angular/forms',
  '@angular/localize',
  '@angular/platform-browser',
  '@angular/platform-browser-dynamic',
  '@angular/platform-server',
  '@angular/router',
  '@angular/service-worker',
  '@angular/ssr',
  '@angular/upgrade',
  '@angular/build',
  '@angular/cli',
  '@angular/language-service',
  '@angular-devkit/architect',
  '@angular-devkit/build-angular',
  '@angular-devkit/core',
  '@angular-devkit/schematics',
  '@schematics/angular',
])

export function isAngularScopedPackage(name: string): boolean {
  return (
    name.startsWith('@angular/') ||
    name.startsWith('@angular-devkit/') ||
    name.startsWith('@schematics/angular') ||
    name.startsWith('@angular-eslint/')
  )
}

export function isAngularFrameworkPackage(name: string): boolean {
  return FRAMEWORK_PACKAGES.has(name) || name.startsWith('@angular-devkit/')
}

export function isAngularEslintPackage(name: string): boolean {
  return name.startsWith('@angular-eslint/')
}

export function angularRootInPath(rootPackage: string): boolean {
  return isAngularFrameworkPackage(rootPackage) || isAngularEslintPackage(rootPackage)
}

function ngCommand(args: string[]): string {
  return ['ng', ...args].join(' ')
}

function versionTag(version: string | null): string | null {
  if (!version || version === 'latest') return null
  const parsed = semver.parse(version)
  if (!parsed) return null
  return String(parsed.major)
}

function pickAngularTarget(input: {
  current: string | null
  bestFix: string | null
  wanted: string | null
  latest: string | null
  feasibility: Feasibility
}): string | null {
  // Explicit major upgrade path
  if (input.feasibility === 'plan_major') {
    return input.latest ?? input.wanted ?? input.bestFix
  }

  const cur =
    input.current && semver.valid(input.current) ? input.current : null
  const curMajor = cur ? semver.major(cur) : null

  // Security fix on the same major wins
  if (
    input.bestFix &&
    semver.valid(input.bestFix) &&
    (curMajor == null || semver.major(input.bestFix) === curMajor)
  ) {
    return input.bestFix
  }

  // Security forces a major jump
  if (
    input.bestFix &&
    semver.valid(input.bestFix) &&
    curMajor != null &&
    semver.major(input.bestFix) !== curMajor
  ) {
    return input.bestFix
  }

  // Prefer staying on the installed major (ng update @20) even if npm latest is @22
  if (curMajor != null) {
    if (
      input.wanted &&
      semver.valid(input.wanted) &&
      semver.major(input.wanted) === curMajor
    ) {
      return input.wanted
    }
    if (
      input.latest &&
      semver.valid(input.latest) &&
      semver.major(input.latest) === curMajor
    ) {
      return input.latest
    }
    return cur
  }

  return input.wanted ?? input.latest ?? input.bestFix
}

/** Build ng update actions for Angular packages (preferred over solo npm installs). */
export function buildAngularFixActions(input: {
  name: string
  isDirect: boolean
  current?: string | null
  bestFix: string | null
  wanted: string | null
  latest: string | null
  feasibility: Feasibility
  rootPackage?: string
}): FixAction[] {
  const actions: FixAction[] = []
  const target = pickAngularTarget({
    current: input.current ?? null,
    bestFix: input.bestFix,
    wanted: input.wanted,
    latest: input.latest,
    feasibility: input.feasibility,
  })
  const tag = versionTag(target)
  const latestMajor =
    input.latest && semver.valid(input.latest)
      ? String(semver.major(input.latest))
      : null
  const stayingOnCurrentMajor =
    Boolean(tag) && Boolean(latestMajor) && tag !== latestMajor

  if (isAngularEslintPackage(input.name) || input.rootPackage?.startsWith('@angular-eslint/')) {
    const pkg = '@angular-eslint/schematics'
    const args = tag
      ? ['update', `${pkg}@${tag}`]
      : ['update', pkg]
    actions.push({
      id: 'ng-update-eslint',
      label: tag ? `ng update ${pkg}@${tag}` : `ng update ${pkg}`,
      explanation:
        'Angular ESLint packages should be updated with the Angular update schematic, not a solo npm install.',
      runner: 'ng',
      args,
      command: ngCommand(args),
      targetPackage: pkg,
      targetVersion: tag ?? 'latest',
    })
    return actions
  }

  // Framework / CLI family — always update core + cli together
  const coreSpec = tag ? `@angular/core@${tag}` : '@angular/core'
  const cliSpec = tag ? `@angular/cli@${tag}` : '@angular/cli'
  const args = ['update', coreSpec, cliSpec]

  const via =
    !input.isDirect && input.rootPackage
      ? ` (${input.name} is pulled in via ${input.rootPackage})`
      : input.name !== '@angular/core' && input.name !== '@angular/cli'
        ? ` (keeps ${input.name} aligned with the rest of the framework)`
        : ''

  const stayNote = stayingOnCurrentMajor
    ? ` Suggested line is Angular ${tag} (your current major). Newest on npm is ${latestMajor}.x — treat that as a separate major upgrade.`
    : ''

  actions.push({
    id: 'ng-update-framework',
    label: tag
      ? `ng update @angular/core@${tag} @angular/cli@${tag}`
      : 'ng update @angular/core @angular/cli',
    explanation: `Use the Angular CLI updater so core, common, compiler, router, etc. stay on the same version and migrations run.${via}${stayNote} Do not npm-install a single @angular/* package alone.`,
    runner: 'ng',
    args,
    command: ngCommand(args),
    targetPackage: '@angular/core',
    targetVersion: tag ?? target,
  })

  if (stayingOnCurrentMajor && latestMajor) {
    actions.push({
      id: 'ng-update-framework-next-major',
      label: `ng update @angular/core@${latestMajor} @angular/cli@${latestMajor} (new major)`,
      explanation: `Optional major jump to the newest Angular line on npm (${latestMajor}.x). Review the Angular update guide before running.`,
      runner: 'ng',
      args: [
        'update',
        `@angular/core@${latestMajor}`,
        `@angular/cli@${latestMajor}`,
      ],
      command: ngCommand([
        'update',
        `@angular/core@${latestMajor}`,
        `@angular/cli@${latestMajor}`,
      ]),
      targetPackage: '@angular/core',
      targetVersion: latestMajor,
    })
  }

  // Optional: allow dirty working tree (common during local work)
  actions.push({
    id: 'ng-update-framework-allow-dirty',
    label: tag
      ? `ng update @angular/core@${tag} @angular/cli@${tag} --allow-dirty`
      : 'ng update @angular/core @angular/cli --allow-dirty',
    explanation:
      'Same as the main Angular update, but allows a dirty git working tree. Review migrations afterward.',
    runner: 'ng',
    args: [...args, '--allow-dirty'],
    command: ngCommand([...args, '--allow-dirty']),
    targetPackage: '@angular/core',
    targetVersion: tag ?? target,
  })

  return actions
}

/** Only the package itself — never because an Angular tool appears in the dependency path. */
export function shouldUseNgUpdate(name: string): boolean {
  return isAngularFrameworkPackage(name) || isAngularEslintPackage(name)
}
