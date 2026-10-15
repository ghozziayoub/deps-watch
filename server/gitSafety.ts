import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type GitSafetyStatus = {
  ok: boolean
  hasGit: boolean
  isRepo: boolean
  clean: boolean
  reason: string | null
  /** Short summary for UI */
  label: string
}

function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    child.on('error', () => {
      resolve({ code: 127, stdout: '', stderr: 'git not found' })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function inProgressReason(cwd: string): string | null {
  const gitDir = path.join(cwd, '.git')
  // worktree: .git may be a file; still check common in-progress markers via git
  if (existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    return 'Git merge in progress — finish or abort it first.'
  }
  if (
    existsSync(path.join(gitDir, 'rebase-merge')) ||
    existsSync(path.join(gitDir, 'rebase-apply'))
  ) {
    return 'Git rebase in progress — finish or abort it first.'
  }
  if (existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return 'Git cherry-pick in progress — finish or abort it first.'
  }
  return null
}

/** Auto-update is only allowed when the project is a clean git work tree. */
export async function checkGitReady(projectPath: string): Promise<GitSafetyStatus> {
  const version = await runGit(projectPath, ['--version'])
  if (version.code !== 0) {
    return {
      ok: false,
      hasGit: false,
      isRepo: false,
      clean: false,
      reason:
        'Git is not installed or not on PATH. Auto-update needs Git so changes can be undone.',
      label: 'Git missing',
    }
  }

  const inside = await runGit(projectPath, [
    'rev-parse',
    '--is-inside-work-tree',
  ])
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      hasGit: true,
      isRepo: false,
      clean: false,
      reason:
        'This folder is not a Git repository. Run git init and commit your code before using Run here.',
      label: 'Not a git repo',
    }
  }

  // Resolve repo root (project may be in a subdirectory)
  const root = await runGit(projectPath, ['rev-parse', '--show-toplevel'])
  const repoRoot = root.code === 0 ? root.stdout.trim() : projectPath

  const busy = inProgressReason(repoRoot)
  if (busy) {
    return {
      ok: false,
      hasGit: true,
      isRepo: true,
      clean: false,
      reason: busy,
      label: 'Git busy',
    }
  }

  // Also detect merge/rebase via porcelain when .git is a file (worktrees)
  const status = await runGit(projectPath, [
    'status',
    '--porcelain',
    '--untracked-files=normal',
  ])
  if (status.code !== 0) {
    return {
      ok: false,
      hasGit: true,
      isRepo: true,
      clean: false,
      reason: status.stderr.trim() || 'Could not read git status.',
      label: 'Git error',
    }
  }

  const dirty = status.stdout.trim().length > 0
  if (dirty) {
    const lines = status.stdout.trim().split(/\r?\n/).length
    return {
      ok: false,
      hasGit: true,
      isRepo: true,
      clean: false,
      reason: `Working tree is not clean (${lines} change${lines === 1 ? '' : 's'}). Commit or stash everything, then try again.`,
      label: 'Dirty tree',
    }
  }

  return {
    ok: true,
    hasGit: true,
    isRepo: true,
    clean: true,
    reason: null,
    label: 'Clean',
  }
}

export async function assertGitReadyForFix(projectPath: string): Promise<void> {
  const status = await checkGitReady(projectPath)
  if (!status.ok) {
    throw new Error(status.reason ?? 'Git must be clean before auto-update.')
  }
}
