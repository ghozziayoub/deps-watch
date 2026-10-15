import type { AdvisoryInfo } from './types.ts'

interface OsvEvent {
  introduced?: string
  fixed?: string
}

interface OsvAffected {
  package?: { name?: string; ecosystem?: string }
  ranges?: Array<{ events?: OsvEvent[] }>
  database_specific?: { severity?: string }
}

interface OsvVuln {
  id: string
  summary?: string
  details?: string
  aliases?: string[]
  severity?: Array<{ type?: string; score?: string }>
  database_specific?: { severity?: string }
  affected?: OsvAffected[]
}

const vulnDetailCache = new Map<string, OsvVuln | null>()
const advisoriesCache = new Map<string, AdvisoryInfo[]>()

export function clearOsvCache(): void {
  vulnDetailCache.clear()
  advisoriesCache.clear()
}

function severityFromVuln(vuln: OsvVuln): string | null {
  const db = vuln.database_specific?.severity
  if (db) return String(db).toLowerCase()
  const score = vuln.severity?.[0]?.score
  if (!score) return null
  return score.startsWith('CVSS') ? score : score.toLowerCase()
}

function fixedVersionsForPackage(vuln: OsvVuln, packageName: string): string[] {
  const fixed = new Set<string>()
  for (const affected of vuln.affected ?? []) {
    const name = affected.package?.name
    if (name && name !== packageName) continue
    if (affected.package?.ecosystem && affected.package.ecosystem !== 'npm') continue
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixed.add(event.fixed)
      }
    }
  }
  return [...fixed]
}

async function fetchVulnDetails(id: string): Promise<OsvVuln | null> {
  if (vulnDetailCache.has(id)) return vulnDetailCache.get(id) ?? null
  const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)
  if (!res.ok) {
    vulnDetailCache.set(id, null)
    return null
  }
  const full = (await res.json()) as OsvVuln
  vulnDetailCache.set(id, full)
  return full
}

function toAdvisory(full: OsvVuln, packageName: string): AdvisoryInfo {
  return {
    id: full.id,
    summary: full.summary || full.details?.slice(0, 140) || full.id,
    severity: severityFromVuln(full),
    fixedVersions: fixedVersionsForPackage(full, packageName),
    aliases: full.aliases ?? [],
  }
}

/** Batch-query OSV, then hydrate only hits. */
export async function fetchAdvisoriesBatch(
  items: Array<{ name: string; version: string }>,
  chunkSize = 80,
): Promise<Map<string, AdvisoryInfo[]>> {
  const result = new Map<string, AdvisoryInfo[]>()
  const pending: Array<{ name: string; version: string; key: string }> = []

  for (const item of items) {
    const key = `${item.name}@${item.version}`
    if (advisoriesCache.has(key)) {
      result.set(key, advisoriesCache.get(key)!)
    } else {
      pending.push({ ...item, key })
    }
  }

  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize)
    const res = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: chunk.map((c) => ({
          package: { name: c.name, ecosystem: 'npm' },
          version: c.version,
        })),
      }),
    })

    if (!res.ok) {
      for (const c of chunk) {
        advisoriesCache.set(c.key, [])
        result.set(c.key, [])
      }
      continue
    }

    const data = (await res.json()) as {
      results?: Array<{ vulns?: Array<{ id: string }> }>
    }
    const results = data.results ?? []

    for (let qi = 0; qi < chunk.length; qi++) {
      const item = chunk[qi]!
      const ids = (results[qi]?.vulns ?? []).map((v) => v.id)
      if (ids.length === 0) {
        advisoriesCache.set(item.key, [])
        result.set(item.key, [])
        continue
      }

      const advisories: AdvisoryInfo[] = []
      for (const id of ids) {
        const full = await fetchVulnDetails(id)
        if (!full) {
          advisories.push({
            id,
            summary: id,
            severity: null,
            fixedVersions: [],
            aliases: [],
          })
          continue
        }
        advisories.push(toAdvisory(full, item.name))
      }
      advisoriesCache.set(item.key, advisories)
      result.set(item.key, advisories)
    }
  }

  return result
}
