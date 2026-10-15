import type { AdvisoryInfo, Feasibility, PackageFinding, Severity } from './types.ts'

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 0,
}

function normalizeSeverityToken(raw: string | null | undefined): Severity | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (s.includes('critical')) return 'critical'
  if (s.includes('high')) return 'high'
  if (s.includes('medium') || s.includes('moderate')) return 'medium'
  if (s.includes('low')) return 'low'
  // CVSS vector — rough band from score if present like "CVSS:3.1/AV:N/.../S:U/C:H/I:H/A:H"
  const scoreMatch = s.match(/\/(\d+(?:\.\d+)?)\s*$/)
  if (scoreMatch) {
    const n = Number(scoreMatch[1])
    if (n >= 9) return 'critical'
    if (n >= 7) return 'high'
    if (n >= 4) return 'medium'
    return 'low'
  }
  return null
}

export function severityFromAdvisories(advisories: AdvisoryInfo[]): Severity {
  let best: Severity = 'none'
  for (const adv of advisories) {
    const sev =
      normalizeSeverityToken(adv.severity) ??
      (advisories.length > 0 ? 'medium' : 'none')
    if (SEVERITY_RANK[sev] > SEVERITY_RANK[best]) best = sev
  }
  if (advisories.length > 0 && best === 'none') return 'medium'
  return best
}

export function computePriority(input: {
  feasibility: Feasibility
  advisories: AdvisoryInfo[]
  isDirect: boolean
  isGroup?: boolean
}): { severity: Severity; priority: number } {
  const fromAdv = severityFromAdvisories(input.advisories)
  let severity: Severity = fromAdv

  if (severity === 'none') {
    if (input.feasibility === 'vuln_no_fix') severity = 'high'
    else if (input.feasibility === 'update_now') severity = 'low'
    else if (input.feasibility === 'plan_major') severity = 'low'
  }

  const feasibilityBoost: Record<Feasibility, number> = {
    vuln_no_fix: 40,
    update_now: 25,
    plan_major: 15,
    ok: 0,
  }

  const priority =
    SEVERITY_RANK[severity] * 20 +
    feasibilityBoost[input.feasibility] +
    (input.isDirect ? 5 : 0) +
    (input.isGroup ? 8 : 0)

  return { severity, priority }
}

export function applyPriority(finding: PackageFinding): PackageFinding {
  const { severity, priority } = computePriority({
    feasibility: finding.feasibility,
    advisories: finding.advisories,
    isDirect: finding.isDirect,
    isGroup: finding.isGroup,
  })
  return { ...finding, severity, priority }
}

export function sortByPriority(findings: PackageFinding[]): PackageFinding[] {
  return [...findings].sort((a, b) => {
    if (a.ignored !== b.ignored) return a.ignored ? 1 : -1
    return (
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.projectName.localeCompare(b.projectName) ||
      a.name.localeCompare(b.name)
    )
  })
}
