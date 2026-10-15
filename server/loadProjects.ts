import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { loadLockGraph, type LockGraph } from './lockfile.ts'
import { listProjectConfigs } from './projectsStore.ts'
import { getAppRoot } from './paths.ts'
import type { DepKind, ProjectConfig } from './types.ts'

export { getAppRoot }

export function loadProjectConfigs(): ProjectConfig[] {
  return listProjectConfigs()
}

export interface DeclaredDep {
  name: string
  range: string
  kind: Exclude<DepKind, 'transitive'>
}

export interface ProjectManifest {
  declared: DeclaredDep[]
  graph: LockGraph
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function loadProjectManifest(projectPath: string): ProjectManifest {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${projectPath}`)
  }

  const pkg = readJson(pkgPath) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const declared: DeclaredDep[] = []
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    declared.push({ name, range, kind: 'dependency' })
  }
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    declared.push({ name, range, kind: 'devDependency' })
  }

  const graph = loadLockGraph(projectPath, declared)
  return { declared, graph }
}
