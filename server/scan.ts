import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { classifyPackage, emptyCounts } from './classify.ts'
import { groupAngularFindings } from './group.ts'
import { applyIgnoresToFindings } from './ignores.ts'
import { loadProjectManifest } from './loadProjects.ts'
import { getAppRoot } from './paths.ts'
import { clearOsvCache, fetchAdvisoriesBatch } from './osv.ts'
import { sortByPriority } from './priority.ts'
import { getProjectConfig, ensureReportsDir } from './projectsStore.ts'
import { clearRegistryCache, fetchRegistryInfo } from './registry.ts'
import { detectVerifyCommand } from './verify.ts'
import type {
  PackageFinding,
  ProjectSummary,
  ScanReport,
} from './types.ts'

function projectReportPath(projectId: string): string {
  return path.join(getAppRoot(), 'data', 'reports', `${projectId}.json`)
}

/** Legacy combined report (migration / CLI). */
function legacyReportPath(): string {
  return path.join(getAppRoot(), 'data', 'last-report.json')
}

export function loadProjectReport(projectId: string): ScanReport | null {
  const file = projectReportPath(projectId)
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ScanReport
    } catch {
      return null
    }
  }

  // Fallback: slice from legacy combined report if present
  const legacy = loadLegacyReport()
  if (!legacy) return null
  const findings = legacy.findings.filter((f) => f.projectId === projectId)
  const projects = legacy.projects.filter((p) => p.id === projectId)
  if (projects.length === 0 && findings.length === 0) return null
  return {
    scannedAt: legacy.scannedAt,
    durationMs: legacy.durationMs,
    projects,
    findings,
  }
}

function loadLegacyReport(): ScanReport | null {
  const file = legacyReportPath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ScanReport
  } catch {
    return null
  }
}

export function saveProjectReport(projectId: string, report: ScanReport): void {
  ensureReportsDir()
  writeFileSync(
    projectReportPath(projectId),
    JSON.stringify(report, null, 2),
    'utf8',
  )
}

/** Used by ignore refresh + older callers. */
export function loadLastReport(): ScanReport | null {
  return loadLegacyReport()
}

export function saveReport(report: ScanReport): void {
  const file = legacyReportPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      worker(),
    ),
  )
  return results
}

export async function runScan(projectId: string): Promise<ScanReport> {
  const project = getProjectConfig(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)

  const started = Date.now()
  clearRegistryCache()
  clearOsvCache()

  const findings: PackageFinding[] = []
  let summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    path: project.path,
    packageCount: 0,
    directCount: 0,
    transitiveCount: 0,
    counts: emptyCounts(),
    verifyLabel: detectVerifyCommand(project)?.label ?? null,
  }

  type WorkItem = {
    projectId: string
    projectName: string
    name: string
    kind: PackageFinding['kind']
    isDirect: boolean
    range: string
    current: string | null
  }

  const work: WorkItem[] = []
  let graph: ReturnType<typeof loadProjectManifest>['graph'] | null = null

  try {
    const manifest = loadProjectManifest(project.path)
    graph = manifest.graph

    for (const dep of manifest.declared) {
      work.push({
        projectId: project.id,
        projectName: project.name,
        name: dep.name,
        kind: dep.kind,
        isDirect: true,
        range: dep.range,
        current: manifest.graph.installedByName.get(dep.name) ?? null,
      })
    }

    for (const [name, version] of manifest.graph.installedByName) {
      if (manifest.graph.directNames.has(name)) continue
      const parents = manifest.graph.parentsByName.get(name) ?? []
      const rootPaths = manifest.graph.rootPathsByName.get(name) ?? []
      const range =
        rootPaths[0]?.immediateRange ?? parents[0]?.range ?? '*'
      work.push({
        projectId: project.id,
        projectName: project.name,
        name,
        kind: 'transitive',
        isDirect: false,
        range,
        current: version,
      })
    }

    const directCount = manifest.declared.length
    const transitiveCount = [...manifest.graph.installedByName.keys()].filter(
      (n) => !manifest.graph.directNames.has(n),
    ).length

    summary = {
      ...summary,
      packageCount: directCount + transitiveCount,
      directCount,
      transitiveCount,
    }
  } catch (error) {
    summary = {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const directNames = [...new Set(work.filter((w) => w.isDirect).map((w) => w.name))]
  const registryByName = new Map(
    await mapPool(directNames, 8, async (name) => {
      const info = await fetchRegistryInfo(name)
      return [name, info] as const
    }),
  )

  const deduped = new Map<string, { name: string; version: string }>()
  for (const item of work) {
    if (!item.current || !semver.valid(item.current)) continue
    deduped.set(`${item.name}@${item.current}`, {
      name: item.name,
      version: item.current,
    })
  }
  const advisoriesByKey = await fetchAdvisoriesBatch([...deduped.values()])

  for (const item of work) {
    const parents = graph?.parentsByName.get(item.name) ?? []
    const rootPaths = graph?.rootPathsByName.get(item.name) ?? []

    const advKey = item.current ? `${item.name}@${item.current}` : null
    const advisories = advKey ? (advisoriesByKey.get(advKey) ?? []) : []

    if (!item.isDirect && advisories.length === 0) continue

    const registry = item.isDirect
      ? (registryByName.get(item.name) ?? { latest: null, versions: [] })
      : { latest: null, versions: [] }

    let versions = registry.versions
    let latest = registry.latest
    if (!item.isDirect && advisories.length > 0) {
      const info = await fetchRegistryInfo(item.name)
      versions = info.versions
      latest = info.latest
    }

    const wanted =
      item.isDirect && item.range && versions.length > 0
        ? semver.maxSatisfying(versions, item.range)
        : null

    findings.push(
      classifyPackage({
        projectId: item.projectId,
        projectName: item.projectName,
        name: item.name,
        kind: item.kind,
        isDirect: item.isDirect,
        range: item.range,
        current: item.current,
        latest,
        wanted,
        versions,
        advisories,
        parents: parents.filter((p) => p.parentName !== '(project)'),
        rootPaths,
      }),
    )
  }

  const grouped = groupAngularFindings(findings)
  const withIgnores = applyIgnoresToFindings(grouped)
  const sorted = sortByPriority(withIgnores)

  summary.counts = emptyCounts()
  for (const f of sorted) {
    if (!f.ignored) summary.counts[f.feasibility] += 1
  }

  const report: ScanReport = {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    projects: [summary],
    findings: sorted,
  }

  saveProjectReport(projectId, report)
  return report
}

/** CLI helper: scan every configured project sequentially. */
export async function runScanAll(): Promise<ScanReport[]> {
  const { listProjectConfigs } = await import('./projectsStore.ts')
  const reports: ScanReport[] = []
  for (const project of listProjectConfigs()) {
    reports.push(await runScan(project.id))
  }
  return reports
}
