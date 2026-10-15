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

function parseClassicYarn(
  text: string,
  declared: Array<{ name: string; range: string; kind: Exclude<DepKind, 'transitive'> }>,
): LockGraph {
  const directNames = new Set(declared.map((d) => d.name))
  const declaredByName = new Map(declared.map((d) => [d.name, d]))
  const installedByName = new Map<string, string>()
  const allVersionsByName = new Map<string, string[]>()
  const parentsByName = new Map<string, ParentEdge[]>()
  const rootPathsByName = new Map<string, RootPath[]>()

  // Blocks separated by blank lines; keys like: pkg@^1.0.0: or "pkg@npm:^1.0.0":
  const blocks = text.split(/\n(?=\S)/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const header = lines[0]?.trim()
    if (!header || header.startsWith('#')) continue
    if (!header.includes('@') || !header.endsWith(':')) continue

    const keyPart = header.replace(/:$/, '').replace(/^"|"$/g, '')
    // Take first descriptor if multiple "a@1, b@1:"
    const firstKey = keyPart.split(',')[0]!.trim().replace(/^"|"$/g, '')
    let name = firstKey
    if (firstKey.startsWith('@')) {
      const cut = firstKey.lastIndexOf('@')
      name = cut > 0 ? firstKey.slice(0, cut) : firstKey
    } else {
      name = firstKey.split('@')[0] ?? firstKey
    }

    let version: string | null = null
    let inDeps = false
    const deps: Record<string, string> = {}
    for (const line of lines.slice(1)) {
      const t = line.trim()
      if (t.startsWith('version ')) {
        version = t.replace(/^version\s+/, '').replace(/^"|"$/g, '')
        inDeps = false
      } else if (t === 'dependencies:') {
        inDeps = true
      } else if (inDeps && /^\S/.test(line.replace(/^\s\s/, ''))) {
        // leave dependencies section on dedent-ish
        if (!line.startsWith('    ') && !line.startsWith('\t\t')) inDeps = false
      }
      if (inDeps) {
        const m = t.match(/^"?([^"]+)"?\s+"([^"]+)"$/)
        if (m) deps[m[1]!] = m[2]!
      }
    }
    if (!version) continue
    addInstalled(installedByName, allVersionsByName, name, version)
    for (const [depName, range] of Object.entries(deps)) {
      const list = parentsByName.get(depName) ?? []
      list.push({ parentName: name, parentVersion: version, range })
      parentsByName.set(depName, list)
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
    const list = parentsByName.get(dep.name) ?? []
    list.push({
      parentName: '(project)',
      parentVersion: '0.0.0',
      range: dep.range,
    })
    parentsByName.set(dep.name, list)
  }

  for (const [name, edges] of parentsByName) {
    if (rootPathsByName.has(name)) continue
    for (const edge of edges) {
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
    nodesByKey: new Map(),
    installedByName,
    allVersionsByName,
    parentsByName,
    rootPathsByName,
    directNames,
  }
}

function parseBerryYarn(
  text: string,
  declared: Array<{ name: string; range: string; kind: Exclude<DepKind, 'transitive'> }>,
): LockGraph {
  const directNames = new Set(declared.map((d) => d.name))
  const declaredByName = new Map(declared.map((d) => [d.name, d]))
  const installedByName = new Map<string, string>()
  const allVersionsByName = new Map<string, string[]>()
  const parentsByName = new Map<string, ParentEdge[]>()
  const rootPathsByName = new Map<string, RootPath[]>()

  let doc: Record<string, unknown>
  try {
    doc = parseYaml(text) as Record<string, unknown>
  } catch {
    return emptyGraph(directNames)
  }

  for (const [key, value] of Object.entries(doc)) {
    if (key === '__metadata') continue
    if (!value || typeof value !== 'object') continue
    const entry = value as {
      version?: string
      resolution?: string
      dependencies?: Record<string, string>
    }
    const version = entry.version
    if (!version) continue

    // key: "pkg@npm:^1.0.0" or "@scope/pkg@npm:^1.0.0, @scope/pkg@npm:^1.1.0"
    const first = key.split(',')[0]!.trim().replace(/^"|"$/g, '')
    let name = first
    if (first.startsWith('@')) {
      const cut = first.indexOf('@', 1)
      name = cut > 0 ? first.slice(0, cut) : first
    } else {
      name = first.split('@')[0] ?? first
    }

    addInstalled(installedByName, allVersionsByName, name, version)
    for (const [depName, range] of Object.entries(entry.dependencies ?? {})) {
      const list = parentsByName.get(depName) ?? []
      list.push({ parentName: name, parentVersion: version, range })
      parentsByName.set(depName, list)
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

  for (const [name, edges] of parentsByName) {
    if (rootPathsByName.has(name)) continue
    for (const edge of edges) {
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
    nodesByKey: new Map(),
    installedByName,
    allVersionsByName,
    parentsByName,
    rootPathsByName,
    directNames,
  }
}

export function loadYarnLockGraph(
  projectPath: string,
  declared: Array<{
    name: string
    range: string
    kind: Exclude<DepKind, 'transitive'>
  }>,
): LockGraph {
  const lockPath = path.join(projectPath, 'yarn.lock')
  let text: string
  try {
    text = readFileSync(lockPath, 'utf8')
  } catch {
    return emptyGraph(new Set(declared.map((d) => d.name)))
  }

  if (text.includes('__metadata')) {
    return parseBerryYarn(text, declared)
  }
  return parseClassicYarn(text, declared)
}
