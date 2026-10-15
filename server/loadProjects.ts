import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadLockGraph, type LockGraph } from './lockfile.ts'
import { detectPackageManager } from './packageManager.ts'
import { assertProjectHealthy } from './projectHealth.ts'
import { listProjectConfigs } from './projectsStore.ts'
import { getAppRoot } from './paths.ts'
import type { DepKind, PackageManagerId, ProjectConfig } from './types.ts'

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
  packageManager: PackageManagerId
}

export function loadProjectManifest(projectPath: string): ProjectManifest {
  assertProjectHealthy(projectPath)
  const packageManager = detectPackageManager(projectPath)

  const pkgPath = path.join(projectPath, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
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

  const graph = loadLockGraph(projectPath, declared, packageManager)
  return { declared, graph, packageManager }
}
