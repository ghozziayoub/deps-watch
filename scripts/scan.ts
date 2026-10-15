import { listProjectConfigs } from '../server/projectsStore.ts'
import { runScan, runScanAll } from '../server/scan.ts'

const projectId = process.argv[2]
const projects = listProjectConfigs()

if (projectId) {
  const report = await runScan(projectId)
  const summary = report.projects[0]
  const actionable = report.findings.filter((f) => f.feasibility !== 'ok')
  console.log(
    `Scanned ${summary?.name ?? projectId} in ${report.durationMs}ms`,
  )
  console.log(
    `Findings: ${report.findings.length} total, ${actionable.length} actionable`,
  )
  if (summary) {
    const { counts } = summary
    console.log(
      `ok=${counts.ok} update=${counts.update_now} major=${counts.plan_major} no-fix=${counts.vuln_no_fix}`,
    )
  }
} else {
  console.log(`Scanning ${projects.length} projects…`)
  const reports = await runScanAll()
  for (const report of reports) {
    const summary = report.projects[0]
    if (!summary) continue
    const { counts } = summary
    console.log(
      `- ${summary.name}: ok=${counts.ok} update=${counts.update_now} major=${counts.plan_major} no-fix=${counts.vuln_no_fix} (${report.durationMs}ms)`,
    )
  }
}
