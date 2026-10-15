import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { assertGitReadyForFix } from './gitSafety.ts'
import { loadProjectConfigs } from './loadProjects.ts'
import { loadProjectReport } from './scan.ts'
import { detectVerifyCommand } from './verify.ts'
import type {
  FixAction,
  FixJob,
  FixJobRequest,
  FixRunner,
  PackageFinding,
} from './types.ts'

const jobs = new Map<string, FixJob>()
let activeJobId: string | null = null

const PKG_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
const VER_RE = /^(latest|[\w.+-]+)$/
/** Dirty trees are blocked by gitSafety — do not allow --allow-dirty. */
const NG_FLAGS = new Set(['--force', '--create-commits'])

export function getFixJob(id: string): FixJob | null {
  return jobs.get(id) ?? null
}

function findAction(
  finding: PackageFinding,
  actionId: string,
): FixAction | null {
  return finding.fixActions.find((a) => a.id === actionId) ?? null
}

function splitInstallTarget(arg: string): { name: string; version: string } {
  if (arg.startsWith('@')) {
    const slash = arg.indexOf('/')
    if (slash === -1) throw new Error(`Invalid scoped package: ${arg}`)
    const cut = arg.lastIndexOf('@')
    if (cut === 0) return { name: arg, version: 'latest' }
    return { name: arg.slice(0, cut), version: arg.slice(cut + 1) }
  }
  const cut = arg.lastIndexOf('@')
  if (cut <= 0) return { name: arg, version: 'latest' }
  return { name: arg.slice(0, cut), version: arg.slice(cut + 1) }
}

function assertNpmArgs(args: string[]): void {
  if (args.length < 2) throw new Error('Invalid npm fix command')
  const cmd = args[0]
  if (cmd !== 'install' && cmd !== 'update' && cmd !== 'run') {
    throw new Error(`Unsupported npm command: ${cmd}`)
  }

  if (cmd === 'run') {
    if (args.length < 2 || !/^[\w.:-]+$/.test(args[1]!)) {
      throw new Error('Invalid npm run script')
    }
    return
  }

  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (!['--save', '--save-dev', '-D', '-P'].includes(arg)) {
        throw new Error(`Unsupported npm flag: ${arg}`)
      }
      continue
    }
    if (arg === 'install' || arg === 'update') continue

    if (cmd === 'update') {
      if (!PKG_RE.test(arg)) throw new Error(`Invalid package name: ${arg}`)
      continue
    }

    const { name, version } = splitInstallTarget(arg)
    if (!PKG_RE.test(name) || !VER_RE.test(version)) {
      throw new Error(`Invalid package target: ${arg}`)
    }
  }
}

function assertNgArgs(args: string[]): void {
  if (args[0] !== 'update' && args[0] !== 'build') {
    // allow ng build for verify
    if (args[0] === 'build') return
    throw new Error(`Unsupported ng command: ${args[0] ?? '(empty)'}`)
  }
  if (args[0] === 'update') {
    if (args.length < 2) throw new Error('ng update requires package arguments')
    for (const arg of args.slice(1)) {
      if (arg.startsWith('-')) {
        if (!NG_FLAGS.has(arg)) throw new Error(`Unsupported ng flag: ${arg}`)
        continue
      }
      const { name, version } = splitInstallTarget(arg)
      if (!PKG_RE.test(name) || !VER_RE.test(version)) {
        throw new Error(`Invalid ng update target: ${arg}`)
      }
      if (
        !name.startsWith('@angular/') &&
        !name.startsWith('@angular-devkit/') &&
        !name.startsWith('@angular-eslint/') &&
        !name.startsWith('@schematics/angular')
      ) {
        throw new Error(`ng update blocked for non-Angular package: ${name}`)
      }
    }
  }
}

function resolveRunner(action: FixAction): FixRunner {
  return action.runner ?? (action.command.startsWith('ng ') ? 'ng' : 'npm')
}

function assertSafeAction(action: FixAction): FixRunner {
  const runner = resolveRunner(action)
  if (runner === 'ng') assertNgArgs(action.args)
  else assertNpmArgs(action.args)
  return runner
}

export async function startFixJob(request: FixJobRequest): Promise<FixJob> {
  if (activeJobId) {
    const active = jobs.get(activeJobId)
    if (
      active &&
      (active.status === 'queued' ||
        active.status === 'running' ||
        active.status === 'verifying')
    ) {
      throw new Error('Another fix is already running. Wait for it to finish.')
    }
  }

  const projects = loadProjectConfigs()
  const project = projects.find((p) => p.id === request.projectId)
  if (!project) throw new Error(`Unknown project: ${request.projectId}`)

  await assertGitReadyForFix(project.path)

  const report = loadProjectReport(request.projectId)
  if (!report) throw new Error('No scan report found for this project. Run a scan first.')

  const finding = report.findings.find(
    (f) => f.projectId === request.projectId && f.name === request.findingName,
  )
  if (!finding) {
    throw new Error(
      `Finding ${request.findingName} not found for project ${request.projectId}. Re-scan and try again.`,
    )
  }

  const action = findAction(finding, request.actionId)
  if (!action) throw new Error(`Unknown fix action: ${request.actionId}`)

  const runner = assertSafeAction(action)
  const verifyCmd = detectVerifyCommand(project)
  const verifyRequested = Boolean(request.verify && verifyCmd)

  const job: FixJob = {
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    status: 'queued',
    command: action.command,
    runner,
    args: action.args,
    logs: [],
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    verifyRequested,
    verifyLabel: verifyCmd?.label ?? null,
    verifyStatus: verifyRequested ? 'pending' : 'skipped',
  }

  jobs.set(job.id, job)
  activeJobId = job.id
  void runJob(job, verifyCmd)
  return job
}

function appendLog(job: FixJob, line: string): void {
  const text = line.replace(/\r/g, '')
  if (!text) return
  job.logs.push(text)
  if (job.logs.length > 4000) job.logs.splice(0, job.logs.length - 4000)
}

function runSpawn(
  bin: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        npm_config_yes: 'true',
        NG_CLI_ANALYTICS: 'false',
        CI: 'true',
      },
    })

    child.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split('\n')) onLine(line)
    })
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split('\n')) onLine(line)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function runJob(
  job: FixJob,
  verifyCmd: ReturnType<typeof detectVerifyCommand>,
): Promise<void> {
  job.status = 'running'
  appendLog(job, `> ${job.command}`)
  appendLog(job, `cwd: ${job.projectPath}`)

  try {
    const exitCode = await runSpawn(
      job.runner === 'ng' ? 'ng' : 'npm',
      job.args,
      job.projectPath,
      (line) => appendLog(job, line),
    )

    job.exitCode = exitCode
    if (exitCode !== 0) {
      job.status = 'error'
      job.finishedAt = new Date().toISOString()
      job.error = `${job.runner} exited with code ${exitCode}`
      appendLog(job, job.error)
      return
    }

    appendLog(job, `Fix finished successfully (exit ${exitCode}).`)

    if (job.verifyRequested && verifyCmd) {
      job.status = 'verifying'
      job.verifyStatus = 'running'
      appendLog(job, '')
      appendLog(job, `--- Verify: ${verifyCmd.label} ---`)
      const verifyCode = await runSpawn(
        verifyCmd.runner === 'ng' ? 'ng' : 'npm',
        verifyCmd.args,
        job.projectPath,
        (line) => appendLog(job, line),
      )
      if (verifyCode === 0) {
        job.verifyStatus = 'passed'
        appendLog(job, `Verify passed (exit ${verifyCode}).`)
        job.status = 'done'
      } else {
        job.verifyStatus = 'failed'
        job.status = 'error'
        job.error = `Verify failed (${verifyCmd.label}) exit ${verifyCode}`
        appendLog(job, job.error)
      }
    } else {
      job.status = 'done'
      appendLog(job, 'Verify skipped. Re-scan when ready.')
    }

    job.finishedAt = new Date().toISOString()
  } catch (error) {
    job.status = 'error'
    job.finishedAt = new Date().toISOString()
    job.error = error instanceof Error ? error.message : String(error)
    if (job.verifyStatus === 'running') job.verifyStatus = 'failed'
    appendLog(job, job.error)
  } finally {
    if (activeJobId === job.id) activeJobId = null
  }
}
