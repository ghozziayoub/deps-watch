export type Feasibility =
  | 'ok'
  | 'update_now'
  | 'plan_major'
  | 'vuln_no_fix'

export type DepKind = 'dependency' | 'devDependency' | 'transitive'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface ProjectConfig {
  id: string
  name: string
  path: string
  /** npm script name or full command, e.g. "typecheck" or "npm run test:ci" */
  verifyScript?: string
  /** Detected at runtime from package.json; optional if stored later */
  framework?: string
  frameworkId?: string
}

export interface ProjectsFile {
  projects: ProjectConfig[]
}

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
  rootKind: Exclude<DepKind, 'transitive'>
  rootRange: string
  chain: string[]
  immediateRange: string
}

export type FixRunner = 'npm' | 'ng'

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
  severity: Severity
  priority: number
  ignored: boolean
  /** Security fix exists but requires crossing a major version. */
  securityRequiresMajor?: boolean
  isGroup?: boolean
  groupMembers?: GroupMember[]
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
  error?: string
}

export interface ScanReport {
  scannedAt: string
  durationMs: number
  projects: ProjectSummary[]
  findings: PackageFinding[]
}

export interface IgnoreEntry {
  projectId: string
  name: string
  until: string | null
  reason?: string
  createdAt: string
}

export interface VerifyCommand {
  label: string
  runner: FixRunner
  args: string[]
}

export interface FixJobRequest {
  projectId: string
  actionId: string
  findingName: string
  verify?: boolean
}

export type FixJobStatus = 'queued' | 'running' | 'verifying' | 'done' | 'error'

export interface FixJob {
  id: string
  projectId: string
  projectName: string
  projectPath: string
  status: FixJobStatus
  command: string
  runner: FixRunner
  args: string[]
  logs: string[]
  exitCode: number | null
  startedAt: string
  finishedAt: string | null
  error: string | null
  verifyRequested: boolean
  verifyLabel: string | null
  verifyStatus: 'skipped' | 'pending' | 'running' | 'passed' | 'failed'
}
