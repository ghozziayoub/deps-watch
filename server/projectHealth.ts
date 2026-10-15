import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  detectPackageManager,
  lockfileNameFor,
  type PackageManagerId,
} from './packageManager.ts'

export type ProjectHealthCode =
  | 'missing_package_json'
  | 'broken_package_json'
  | 'missing_lockfile'
  | 'broken_lockfile'

export type ProjectHealth = {
  ok: boolean
  code: ProjectHealthCode | null
  message: string | null
  hint: string | null
  packageManager: PackageManagerId
}

export class ProjectLoadError extends Error {
  code: ProjectHealthCode
  hint: string

  constructor(code: ProjectHealthCode, message: string, hint: string) {
    super(message)
    this.name = 'ProjectLoadError'
    this.code = code
    this.hint = hint
  }
}

function health(
  code: ProjectHealthCode,
  message: string,
  hint: string,
  packageManager: PackageManagerId,
): ProjectHealth {
  return { ok: false, code, message, hint, packageManager }
}

function installHint(manager: PackageManagerId): string {
  switch (manager) {
    case 'yarn':
      return 'From the project folder, run yarn (or yarn install) to create yarn.lock, then scan again.'
    case 'pnpm':
      return 'From the project folder, run pnpm install to create pnpm-lock.yaml, then scan again.'
    case 'bun':
      return 'From the project folder, run bun install to create a Bun lockfile, then scan again.'
    default:
      return 'From the project folder, run npm install to create package-lock.json, then scan again.'
  }
}

function validateNpmLock(lockPath: string): string | null {
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      packages?: unknown
    }
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
      return 'package-lock.json is not valid JSON'
    }
    if (lock.packages == null || typeof lock.packages !== 'object') {
      return 'package-lock.json has no packages map'
    }
    return null
  } catch {
    return 'package-lock.json could not be parsed'
  }
}

function validateYarnLock(lockPath: string): string | null {
  try {
    const text = readFileSync(lockPath, 'utf8')
    if (!text.trim()) return 'yarn.lock is empty'
    return null
  } catch {
    return 'yarn.lock could not be read'
  }
}

function validatePnpmLock(lockPath: string): string | null {
  try {
    const text = readFileSync(lockPath, 'utf8')
    if (!text.trim()) return 'pnpm-lock.yaml is empty'
    if (!text.includes('lockfileVersion') && !text.includes('packages:')) {
      return 'pnpm-lock.yaml looks incomplete'
    }
    return null
  } catch {
    return 'pnpm-lock.yaml could not be read'
  }
}

function validateBunLock(projectPath: string): string | null {
  const textLock = path.join(projectPath, 'bun.lock')
  const binLock = path.join(projectPath, 'bun.lockb')
  if (!existsSync(textLock) && !existsSync(binLock)) {
    return 'Bun lockfile is missing'
  }
  return null
}

/** Sync checks before / during scan for the detected package manager. */
export function inspectProjectHealth(projectPath: string): ProjectHealth {
  const packageManager = detectPackageManager(projectPath)
  const pkgPath = path.join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) {
    return health(
      'missing_package_json',
      'package.json is missing',
      'Add a Node project folder that contains a package.json, or remove this project from Deps Watch.',
      packageManager,
    )
  }

  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as unknown
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      return health(
        'broken_package_json',
        'package.json is not a valid JSON object',
        'Open package.json and fix the JSON syntax, then try again.',
        packageManager,
      )
    }
  } catch {
    return health(
      'broken_package_json',
      'package.json could not be parsed',
      'Fix invalid JSON in package.json (trailing commas, comments, etc.), then re-scan.',
      packageManager,
    )
  }

  const lockLabel = lockfileNameFor(packageManager)

  if (packageManager === 'npm') {
    const lockPath = path.join(projectPath, 'package-lock.json')
    if (!existsSync(lockPath)) {
      return health(
        'missing_lockfile',
        `${lockLabel} is missing`,
        installHint('npm'),
        packageManager,
      )
    }
    const err = validateNpmLock(lockPath)
    if (err) {
      return health(
        'broken_lockfile',
        err,
        'Restore the lockfile from Git, or delete it and run npm install.',
        packageManager,
      )
    }
  } else if (packageManager === 'yarn') {
    const lockPath = path.join(projectPath, 'yarn.lock')
    if (!existsSync(lockPath)) {
      return health(
        'missing_lockfile',
        `${lockLabel} is missing`,
        installHint('yarn'),
        packageManager,
      )
    }
    const err = validateYarnLock(lockPath)
    if (err) {
      return health(
        'broken_lockfile',
        err,
        'Restore yarn.lock from Git, or run yarn install.',
        packageManager,
      )
    }
  } else if (packageManager === 'pnpm') {
    const lockPath = path.join(projectPath, 'pnpm-lock.yaml')
    if (!existsSync(lockPath)) {
      return health(
        'missing_lockfile',
        `${lockLabel} is missing`,
        installHint('pnpm'),
        packageManager,
      )
    }
    const err = validatePnpmLock(lockPath)
    if (err) {
      return health(
        'broken_lockfile',
        err,
        'Restore pnpm-lock.yaml from Git, or run pnpm install.',
        packageManager,
      )
    }
  } else {
    const err = validateBunLock(projectPath)
    if (err) {
      return health(
        'missing_lockfile',
        err,
        installHint('bun'),
        packageManager,
      )
    }
  }

  return {
    ok: true,
    code: null,
    message: null,
    hint: null,
    packageManager,
  }
}

export function assertProjectHealthy(projectPath: string): void {
  const result = inspectProjectHealth(projectPath)
  if (!result.ok && result.code && result.message && result.hint) {
    throw new ProjectLoadError(result.code, result.message, result.hint)
  }
}
