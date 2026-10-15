import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { DepKind } from './types.ts'

export interface LockNode {
  key: string
  name: string
  version: string
  requestedRanges: Record<string, string>
}

export interface ParentEdge {
  parentName: string
  parentVersion: string
  range: string
}

export interface RootPath {
  rootPackage: string
  rootKind: Exclude<DepKind, 'transitive'>
  rootRange: string
  chain: string[]
  immediateRange: string
}

export interface LockGraph {
  nodesByKey: Map<string, LockNode>
  /** Prefer hoisted/top-level version per package name */
  installedByName: Map<string, string>
  /** All versions present for a name */
  allVersionsByName: Map<string, string[]>
  parentsByName: Map<string, ParentEdge[]>
  rootPathsByName: Map<string, RootPath[]>
  directNames: Set<string>
}

interface LockfileJson {
  packages?: Record<
    string,
    {
      version?: string
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      dev?: boolean
      name?: string
    }
  >
}

function nameFromKey(key: string): string {
  if (!key) return ''
  const marker = 'node_modules/'
  const idx = key.lastIndexOf(marker)
  return idx === -1 ? key : key.slice(idx + marker.length)
}

function resolveDepKey(
  packages: Set<string>,
  parentKey: string,
  depName: string,
): string | null {
  let current = parentKey

  while (true) {
    const candidate =
      current === ''
        ? `node_modules/${depName}`
        : `${current}/node_modules/${depName}`
    if (packages.has(candidate)) return candidate

    if (current === '') return null

    const idx = current.lastIndexOf('/node_modules/')
    if (idx === -1) {
      if (current.startsWith('node_modules/')) {
        current = ''
        continue
      }
      return null
    }
    current = current.slice(0, idx)
  }
}

export function loadLockGraph(
  projectPath: string,
  declared: Array<{
    name: string
    range: string
    kind: Exclude<DepKind, 'transitive'>
  }>,
): LockGraph {
  const lockPath = path.join(projectPath, 'package-lock.json')
  const nodesByKey = new Map<string, LockNode>()
  const installedByName = new Map<string, string>()
  const allVersionsByName = new Map<string, string[]>()
  const parentsByName = new Map<string, ParentEdge[]>()
  const rootPathsByName = new Map<string, RootPath[]>()
  const directNames = new Set(declared.map((d) => d.name))
  const declaredByName = new Map(declared.map((d) => [d.name, d]))

  if (!existsSync(lockPath)) {
    return {
      nodesByKey,
      installedByName,
      allVersionsByName,
      parentsByName,
      rootPathsByName,
      directNames,
    }
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as LockfileJson
  const packages = lock.packages ?? {}
  const packageKeys = new Set(Object.keys(packages))

  for (const [key, value] of Object.entries(packages)) {
    if (key === '') continue
    if (!key.includes('node_modules/')) continue
    const name = nameFromKey(key)
    if (!name || !value.version) continue

    nodesByKey.set(key, {
      key,
      name,
      version: value.version,
      requestedRanges: {
        ...(value.dependencies ?? {}),
        ...(value.optionalDependencies ?? {}),
      },
    })

    const versions = allVersionsByName.get(name) ?? []
    if (!versions.includes(value.version)) versions.push(value.version)
    allVersionsByName.set(name, versions)

    // Prefer top-level install for "current"
    if (!key.slice('node_modules/'.length).includes('/node_modules/')) {
      installedByName.set(name, value.version)
    } else if (!installedByName.has(name)) {
      installedByName.set(name, value.version)
    }
  }

  // Parent edges from each node's dependency declarations
  for (const node of nodesByKey.values()) {
    for (const [depName, range] of Object.entries(node.requestedRanges)) {
      const childKey = resolveDepKey(packageKeys, node.key, depName)
      const child = childKey ? nodesByKey.get(childKey) : undefined
      const list = parentsByName.get(depName) ?? []
      list.push({
        parentName: node.name,
        parentVersion: node.version,
        range,
      })
      parentsByName.set(depName, list)
      void child
    }
  }

  // Also edges from the root package.json via lock "" entry
  const rootPkg = packages['']
  const rootDeps = {
    ...(rootPkg?.dependencies ?? {}),
    ...(rootPkg?.optionalDependencies ?? {}),
  }
  for (const [depName, range] of Object.entries(rootDeps)) {
    const list = parentsByName.get(depName) ?? []
    list.push({
      parentName: '(project)',
      parentVersion: rootPkg?.version ?? '0.0.0',
      range,
    })
    parentsByName.set(depName, list)
  }

  // Deduplicate parent edges
  for (const [name, edges] of parentsByName) {
    const seen = new Set<string>()
    parentsByName.set(
      name,
      edges.filter((e) => {
        const key = `${e.parentName}@${e.parentVersion}:${e.range}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    )
  }

  // Root paths: BFS from each direct dependency
  type QueueItem = {
    key: string
    rootPackage: string
    rootKind: Exclude<DepKind, 'transitive'>
    rootRange: string
    chain: string[]
    immediateRange: string
  }

  const queue: QueueItem[] = []
  for (const dep of declared) {
    const key = resolveDepKey(packageKeys, '', dep.name)
    if (!key) continue
    queue.push({
      key,
      rootPackage: dep.name,
      rootKind: dep.kind,
      rootRange: dep.range,
      chain: [dep.name],
      immediateRange: dep.range,
    })
  }

  const visited = new Set<string>()

  while (queue.length > 0) {
    const item = queue.shift()!
    const visitKey = `${item.rootPackage}>${item.key}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)

    const node = nodesByKey.get(item.key)
    if (!node) continue

    const paths = rootPathsByName.get(node.name) ?? []
    const signature = `${item.rootPackage}:${item.chain.join('>')}`
    if (!paths.some((p) => `${p.rootPackage}:${p.chain.join('>')}` === signature)) {
      paths.push({
        rootPackage: item.rootPackage,
        rootKind: item.rootKind,
        rootRange: item.rootRange,
        chain: item.chain,
        immediateRange: item.immediateRange,
      })
      rootPathsByName.set(node.name, paths)
    }

    for (const [depName, range] of Object.entries(node.requestedRanges)) {
      const childKey = resolveDepKey(packageKeys, node.key, depName)
      if (!childKey) continue
      if (item.chain.length >= 8) continue
      if (item.chain.includes(depName)) continue
      queue.push({
        key: childKey,
        rootPackage: item.rootPackage,
        rootKind: item.rootKind,
        rootRange: item.rootRange,
        chain: [...item.chain, depName],
        immediateRange: range,
      })
    }
  }

  // Ensure declared packages appear even if lock is incomplete
  for (const dep of declared) {
    if (!installedByName.has(dep.name) && declaredByName.has(dep.name)) {
      // leave missing; scan already handles null current
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
