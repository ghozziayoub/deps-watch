import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { DepKind } from './types.ts'
import type { LockGraph, ParentEdge, RootPath } from './lockfile.ts'

function emptyGraph(directNames: Set<string>): LockGraph {
  return {
    nodesByKey: new Map(),
    installedByName: new Map(),
    allVersionsByName: new Map(),
    parentsByName: new Map(),
    rootPathsByName: new Map(),
    directNames,
  }
}

function stripPeerSuffix(version: string): string {
  // "1.2.3(peer@x)" or "1.2.3_abc123"
  return version.split('(')[0]!.split('_')[0]!.trim()
}

function nameVersionFromKey(key: string): { name: string; version: string } | null {
  // "/express@4.18.2" or "express@4.18.2" or "@scope/pkg@1.0.0"
  const cleaned = key.replace(/^\//, '')
  if (cleaned.startsWith('@')) {
    const cut = cleaned.lastIndexOf('@')
    if (cut <= 0) return null
    return {
      name: cleaned.slice(0, cut),
      version: stripPeerSuffix(cleaned.slice(cut + 1)),
    }
  }
  const cut = cleaned.lastIndexOf('@')
  if (cut <= 0) return null
  return {
    name: cleaned.slice(0, cut),
    version: stripPeerSuffix(cleaned.slice(cut + 1)),
  }
}

function addInstalled(
  installedByName: Map<string, string>,
  allVersionsByName: Map<string, string[]>,
  name: string,
  version: string,
) {
  if (!installedByName.has(name)) installedByName.set(name, version)
  const list = allVersionsByName.get(name) ?? []
  if (!list.includes(version)) list.push(version)
  allVersionsByName.set(name, list)
}

/** Best-effort pnpm-lock.yaml graph (versions + root edges). */
export function loadPnpmLockGraph(
  projectPath: string,
  declared: Array<{
    name: string
    range: string
    kind: Exclude<DepKind, 'transitive'>
  }>,
): LockGraph {
  const directNames = new Set(declared.map((d) => d.name))
  const declaredByName = new Map(declared.map((d) => [d.name, d]))
  const lockPath = path.join(projectPath, 'pnpm-lock.yaml')
  const installedByName = new Map<string, string>()
  const allVersionsByName = new Map<string, string[]>()
  const parentsByName = new Map<string, ParentEdge[]>()
  const rootPathsByName = new Map<string, RootPath[]>()
  const nodesByKey = new Map()

  let doc: Record<string, unknown>
  try {
    doc = parseYaml(readFileSync(lockPath, 'utf8')) as Record<string, unknown>
  } catch {
    return emptyGraph(directNames)
  }

  const packages = (doc.packages ?? {}) as Record<
    string,
    { dependencies?: Record<string, string> }
  >

  for (const key of Object.keys(packages)) {
    const nv = nameVersionFromKey(key)
    if (!nv) continue
    addInstalled(installedByName, allVersionsByName, nv.name, nv.version)

    const deps = packages[key]?.dependencies ?? {}
    for (const [depName, depVer] of Object.entries(deps)) {
      const list = parentsByName.get(depName) ?? []
      list.push({
        parentName: nv.name,
        parentVersion: nv.version,
        range: stripPeerSuffix(String(depVer)),
      })
      parentsByName.set(depName, list)
    }
  }

  // importers["."] or top-level dependencies (older format)
  const importers = (doc.importers ?? {}) as Record<
    string,
    {
      dependencies?: Record<string, { version?: string; specifier?: string }>
      devDependencies?: Record<string, { version?: string; specifier?: string }>
    }
  >
  const root =
    importers['.'] ??
    importers[Object.keys(importers)[0] ?? ''] ??
    null

  const rootDeps = {
    ...(root?.dependencies ?? {}),
    ...(root?.devDependencies ?? {}),
  }

  for (const [name, meta] of Object.entries(rootDeps)) {
    const version = stripPeerSuffix(String(meta.version ?? ''))
    if (version) addInstalled(installedByName, allVersionsByName, name, version)
    const declaredDep = declaredByName.get(name)
    const range = meta.specifier ?? declaredDep?.range ?? '*'
    const list = parentsByName.get(name) ?? []
    list.push({
      parentName: '(project)',
      parentVersion: '0.0.0',
      range,
    })
    parentsByName.set(name, list)
  }

  // Older pnpm: top-level dependencies: { name: version }
  if (!root && doc.dependencies && typeof doc.dependencies === 'object') {
    for (const [name, ver] of Object.entries(
      doc.dependencies as Record<string, string>,
    )) {
      const version = stripPeerSuffix(String(ver))
      addInstalled(installedByName, allVersionsByName, name, version)
    }
  }

  for (const dep of declared) {
    const version = installedByName.get(dep.name)
    if (!version) continue
    rootPathsByName.set(dep.name, [
      {
        rootPackage: dep.name,
        rootKind: dep.kind,
        rootRange: dep.range,
        chain: [dep.name],
        immediateRange: dep.range,
      },
    ])
  }

  // Simple transitive root paths: first parent that is a direct dep
  for (const [name, edges] of parentsByName) {
    if (rootPathsByName.has(name)) continue
    for (const edge of edges) {
      if (edge.parentName === '(project)') continue
      const root = declaredByName.get(edge.parentName)
      if (!root) continue
      rootPathsByName.set(name, [
        {
          rootPackage: root.name,
          rootKind: root.kind,
          rootRange: root.range,
          chain: [root.name, name],
          immediateRange: edge.range,
        },
      ])
      break
    }
  }

  return {
    nodesByKey,
    installedByName,
    allVersionsByName,
    parentsByName,
    rootPathsByName,
    directNames,
  }
}
