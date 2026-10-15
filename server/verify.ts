import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProjectConfig, VerifyCommand } from './types.ts'

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
): VerifyCommand | null {
  if (project.verifyScript) {
    const script = project.verifyScript.trim()
    if (!script) return null
    // Allow "typecheck" or "npm run typecheck" or full "ng build"
    if (script.startsWith('npm ')) {
      const parts = script.split(/\s+/).slice(1)
      return { label: script, runner: 'npm', args: parts }
    }
    if (script.startsWith('ng ')) {
      return {
        label: script,
        runner: 'ng',
        args: script.split(/\s+/).slice(1),
      }
    }
    return {
      label: `npm run ${script}`,
      runner: 'npm',
      args: ['run', script],
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
      return {
        label: `npm run ${name}`,
        runner: 'npm',
        args: ['run', name],
      }
    }
  }

  return null
}
