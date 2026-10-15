import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { detectPackageManager, pmRun } from './packageManager.ts'
import type {
  PackageManagerId,
  ProjectConfig,
  VerifyCommand,
} from './types.ts'

const PREFERRED_SCRIPTS = [
  'typecheck',
  'test:ci',
  'test:node',
  'test:smoke',
  'lint',
  'build',
  'build:prod',
  'ci',
  'test',
] as const

export function detectVerifyCommand(
  project: ProjectConfig,
  packageManager: PackageManagerId = detectPackageManager(project.path),
): VerifyCommand | null {
  if (project.verifyScript) {
    const script = project.verifyScript.trim()
    if (!script) return null

    if (script.startsWith('ng ')) {
      return {
        label: script,
        runner: 'ng',
        args: script.split(/\s+/).slice(1),
      }
    }

    // Full command already includes a runner
    if (
      script.startsWith('npm ') ||
      script.startsWith('yarn ') ||
      script.startsWith('pnpm ') ||
      script.startsWith('bun ')
    ) {
      const parts = script.split(/\s+/)
      const runner = parts[0] as Exclude<VerifyCommand['runner'], undefined>
      return {
        label: script,
        runner,
        args: parts.slice(1),
      }
    }

    const cmd = pmRun(packageManager, script)
    return {
      label: cmd.command,
      runner: cmd.runner,
      args: cmd.args,
    }
  }

  const pkgPath = path.join(project.path, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
  }
  const scripts = pkg.scripts ?? {}

  for (const name of PREFERRED_SCRIPTS) {
    if (scripts[name]) {
      const cmd = pmRun(packageManager, name)
      return {
        label: cmd.command,
        runner: cmd.runner,
        args: cmd.args,
      }
    }
  }

  return null
}
