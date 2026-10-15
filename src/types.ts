export type Feasibility =
  | 'ok'
  | 'update_now'
  | 'plan_major'
  | 'vuln_no_fix'

export type DepKind = 'dependency' | 'devDependency' | 'transitive'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type PackageManagerId = 'npm' | 'yarn' | 'pnpm' | 'bun'

export type FixRunner = PackageManagerId | 'ng'

export interface AdvisoryInfo {
  id: string
  summary: string
  severity: string | null
  fixedVersions: string[]
  aliases: string[]
}

export interface ParentEdge {
  parentName: string
  parentVersion: string
  range: string
}

export interface RootPath {
  rootPackage: string
  rootKind: 'dependency' | 'devDependency'
  rootRange: string
  chain: string[]
  immediateRange: string
}

export interface FixAction {
  id: string
  label: string
  explanation: string
  runner?: FixRunner
  args: string[]
  command: string
  targetPackage: string
  targetVersion: string | null
}

export interface GroupMember {
  name: string
  current: string | null
  latest: string | null
  feasibility: Feasibility
}

export interface PackageFinding {
  projectId: string
  projectName: string
  name: string
  kind: DepKind
  isDirect: boolean
  range: string
  current: string | null
  latest: string | null
  wanted: string | null
  bump: 'major' | 'minor' | 'patch' | 'prerelease' | null
  advisories: AdvisoryInfo[]
  fixAvailable: boolean
  bestFix: string | null
  feasibility: Feasibility
  reason: string
  parents: ParentEdge[]
  rootPaths: RootPath[]
  fixActions: FixAction[]
  severity?: Severity
  priority?: number
  ignored?: boolean
  securityRequiresMajor?: boolean
  isGroup?: boolean
  groupMembers?: GroupMember[]
}

export interface MigrationGuide {
  frameworkId: string
  frameworkLabel: string
  title: string
  url: string
  fromMajor: number
  toMajor: number
  markerPackage: string
}

export interface ProjectSummary {
  id: string
  name: string
  path: string
  packageCount: number
  directCount: number
  transitiveCount: number
  counts: Record<Feasibility, number>
  verifyLabel?: string | null
  packageManager?: PackageManagerId | null
  migrationGuide?: MigrationGuide | null
  error?: string
  errorCode?: string | null
  errorHint?: string | null
}

export interface ScanReport {
  scannedAt: string
  durationMs: number
  projects: ProjectSummary[]
  findings: PackageFinding[]
}

export interface FixJob {
  id: string
  projectId: string
  projectName: string
  projectPath: string
  status: 'queued' | 'running' | 'verifying' | 'done' | 'error'
  command: string
  runner?: FixRunner
  args: string[]
  logs: string[]
  exitCode: number | null
  startedAt: string
  finishedAt: string | null
  error: string | null
  verifyRequested?: boolean
  verifyLabel?: string | null
  verifyStatus?: 'skipped' | 'pending' | 'running' | 'passed' | 'failed'
}
