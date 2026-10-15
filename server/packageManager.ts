import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { FixRunner, PackageManagerId } from './types.ts'

export type { PackageManagerId }

export type PmCommand = {
  runner: Exclude<FixRunner, 'ng'>
  args: string[]
  command: string
}

function readPackageManagerField(projectPath: string): PackageManagerId | null {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      packageManager?: string
    }
    const raw = pkg.packageManager?.trim().toLowerCase() ?? ''
    if (raw.startsWith('pnpm@') || raw === 'pnpm') return 'pnpm'
    if (raw.startsWith('yarn@') || raw === 'yarn') return 'yarn'
    if (raw.startsWith('bun@') || raw === 'bun') return 'bun'
    if (raw.startsWith('npm@') || raw === 'npm') return 'npm'
  } catch {
    // ignore
  }
  return null
}

function isYarnBerry(projectPath: string): boolean {
  const lockPath = path.join(projectPath, 'yarn.lock')
  if (!existsSync(lockPath)) return false
  try {
    const head = readFileSync(lockPath, 'utf8').slice(0, 400)
    return head.includes('__metadata')
  } catch {
    return false
  }
}

/**
 * Detect the project's package manager.
 * Prefer package.json "packageManager", then lockfiles; default npm.
 */
export function detectPackageManager(projectPath: string): PackageManagerId {
  const fromField = readPackageManagerField(projectPath)
  if (fromField) return fromField

  const hasNpm = existsSync(path.join(projectPath, 'package-lock.json'))
  const hasPnpm = existsSync(path.join(projectPath, 'pnpm-lock.yaml'))
  const hasYarn = existsSync(path.join(projectPath, 'yarn.lock'))
  const hasBun =
    existsSync(path.join(projectPath, 'bun.lock')) ||
    existsSync(path.join(projectPath, 'bun.lockb'))

  // If several lockfiles exist, prefer the more specific non-npm ones first
  if (hasPnpm && !hasNpm && !hasYarn) return 'pnpm'
  if (hasYarn && !hasNpm && !hasPnpm) return 'yarn'
  if (hasBun && !hasNpm && !hasPnpm && !hasYarn) return 'bun'
  if (hasPnpm) return 'pnpm'
  if (hasYarn) return 'yarn'
  if (hasBun) return 'bun'
  if (hasNpm) return 'npm'
  return 'npm'
}

export function packageManagerLabel(manager: PackageManagerId): string {
  switch (manager) {
    case 'pnpm':
      return 'pnpm'
    case 'yarn':
      return 'Yarn'
    case 'bun':
      return 'Bun'
    default:
      return 'npm'
  }
}

function joinCmd(runner: string, args: string[]): string {
  return [runner, ...args].join(' ')
}

/** Install / add a package at a version (or latest). */
export function pmInstall(
  manager: PackageManagerId,
  projectPath: string,
  packageSpec: string,
  dev: boolean,
): PmCommand {
  void projectPath
  switch (manager) {
    case 'yarn': {
      const args = dev
        ? ['add', '-D', packageSpec]
        : ['add', packageSpec]
      return { runner: 'yarn', args, command: joinCmd('yarn', args) }
    }
    case 'pnpm': {
      const args = dev
        ? ['add', '-D', packageSpec]
        : ['add', packageSpec]
      return { runner: 'pnpm', args, command: joinCmd('pnpm', args) }
    }
    case 'bun': {
      const args = dev
        ? ['add', '-d', packageSpec]
        : ['add', packageSpec]
      return { runner: 'bun', args, command: joinCmd('bun', args) }
    }
    default: {
      const args = [
        'install',
        packageSpec,
        dev ? '--save-dev' : '--save',
      ]
      return { runner: 'npm', args, command: joinCmd('npm', args) }
    }
  }
}

/** Refresh a package in the lockfile within existing ranges when possible. */
export function pmUpdate(
  manager: PackageManagerId,
  projectPath: string,
  packageName: string,
): PmCommand {
  switch (manager) {
    case 'yarn': {
      const args = isYarnBerry(projectPath)
        ? ['up', packageName]
        : ['upgrade', packageName]
      return { runner: 'yarn', args, command: joinCmd('yarn', args) }
    }
    case 'pnpm': {
      const args = ['update', packageName]
      return { runner: 'pnpm', args, command: joinCmd('pnpm', args) }
    }
    case 'bun': {
      const args = ['update', packageName]
      return { runner: 'bun', args, command: joinCmd('bun', args) }
    }
    default: {
      const args = ['update', packageName]
      return { runner: 'npm', args, command: joinCmd('npm', args) }
    }
  }
}

/** Run a package.json script. */
export function pmRun(
  manager: PackageManagerId,
  script: string,
): PmCommand {
  switch (manager) {
    case 'yarn': {
      const args = ['run', script]
      return { runner: 'yarn', args, command: joinCmd('yarn', args) }
    }
    case 'pnpm': {
      const args = ['run', script]
      return { runner: 'pnpm', args, command: joinCmd('pnpm', args) }
    }
    case 'bun': {
      const args = ['run', script]
      return { runner: 'bun', args, command: joinCmd('bun', args) }
    }
    default: {
      const args = ['run', script]
      return { runner: 'npm', args, command: joinCmd('npm', args) }
    }
  }
}

export function lockfileNameFor(manager: PackageManagerId): string {
  switch (manager) {
    case 'pnpm':
      return 'pnpm-lock.yaml'
    case 'yarn':
      return 'yarn.lock'
    case 'bun':
      return 'bun.lock / bun.lockb'
    default:
      return 'package-lock.json'
  }
}
