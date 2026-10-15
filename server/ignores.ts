import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAppRoot } from './paths.ts'
import type { IgnoreEntry, PackageFinding } from './types.ts'

function ignoresPath(): string {
  return path.join(getAppRoot(), 'data', 'ignores.json')
}

export function loadIgnores(): IgnoreEntry[] {
  const file = ignoresPath()
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items?: IgnoreEntry[] }
    const now = Date.now()
    return (raw.items ?? []).filter((item) => {
      if (!item.until) return true
      return Date.parse(item.until) > now
    })
  } catch {
    return []
  }
}

function saveIgnores(items: IgnoreEntry[]): void {
  const file = ignoresPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ items }, null, 2), 'utf8')
}

export function ignoreKey(projectId: string, name: string): string {
  return `${projectId}::${name}`
}

export function isIgnored(
  projectId: string,
  name: string,
  items: IgnoreEntry[] = loadIgnores(),
): boolean {
  const key = ignoreKey(projectId, name)
  return items.some((i) => ignoreKey(i.projectId, i.name) === key)
}

export function addIgnore(input: {
  projectId: string
  name: string
  days?: number | null
  reason?: string
}): IgnoreEntry[] {
  const items = loadIgnores().filter(
    (i) => !(i.projectId === input.projectId && i.name === input.name),
  )
  const until =
    input.days && input.days > 0
      ? new Date(Date.now() + input.days * 24 * 60 * 60 * 1000).toISOString()
      : null

  items.push({
    projectId: input.projectId,
    name: input.name,
    until,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  })
  saveIgnores(items)
  return items
}

export function removeIgnore(projectId: string, name: string): IgnoreEntry[] {
  const items = loadIgnores().filter(
    (i) => !(i.projectId === projectId && i.name === name),
  )
  saveIgnores(items)
  return items
}

export function applyIgnoresToFindings(
  findings: PackageFinding[],
): PackageFinding[] {
  const items = loadIgnores()
  return findings.map((f) => ({
    ...f,
    ignored: isIgnored(f.projectId, f.name, items),
  }))
}
