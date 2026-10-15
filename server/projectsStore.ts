import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getAppRoot } from './paths.ts'
import type { ProjectConfig, ProjectsFile } from './types.ts'

function configPath(): string {
  return path.join(getAppRoot(), 'projects.config.json')
}

function readConfigFile(): ProjectsFile {
  const file = configPath()
  if (!existsSync(file)) return { projects: [] }
  return JSON.parse(readFileSync(file, 'utf8')) as ProjectsFile
}

function writeConfigFile(data: ProjectsFile): void {
  writeFileSync(configPath(), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function listProjectConfigs(): ProjectConfig[] {
  const root = getAppRoot()
  return readConfigFile().projects.map((project) => ({
    ...project,
    path: path.resolve(root, project.path),
  }))
}

export function getProjectConfig(id: string): ProjectConfig | null {
  return listProjectConfigs().find((p) => p.id === id) ?? null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'project'
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

function toStoredPath(absolutePath: string): string {
  const root = getAppRoot()
  const rel = path.relative(root, absolutePath)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/')
  }
  return absolutePath
}

export function addProjectFromFolder(absolutePath: string): ProjectConfig {
  const resolved = path.resolve(absolutePath)
  if (!existsSync(resolved) || !existsSync(path.join(resolved, 'package.json'))) {
    throw new Error('Folder must exist and contain a package.json')
  }

  const file = readConfigFile()
  const ids = new Set(file.projects.map((p) => p.id))
  const absSet = new Set(
    file.projects.map((p) => path.resolve(getAppRoot(), p.path).toLowerCase()),
  )
  if (absSet.has(resolved.toLowerCase())) {
    throw new Error('That folder is already in the project list')
  }

  let displayName = path.basename(resolved)
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(resolved, 'package.json'), 'utf8'),
    ) as { name?: string }
    if (pkg.name && !pkg.name.startsWith('@')) displayName = pkg.name
    else if (pkg.name) displayName = pkg.name.split('/').pop() || displayName
  } catch {
    // keep folder name
  }

  const id = uniqueId(slugify(displayName), ids)
  const project: ProjectConfig = {
    id,
    name: displayName,
    path: toStoredPath(resolved),
  }

  file.projects.push(project)
  writeConfigFile(file)

  return {
    ...project,
    path: path.resolve(getAppRoot(), project.path),
  }
}

export function removeProject(id: string): void {
  const file = readConfigFile()
  const next = file.projects.filter((p) => p.id !== id)
  if (next.length === file.projects.length) {
    throw new Error(`Unknown project: ${id}`)
  }
  writeConfigFile({ projects: next })

  const reportFile = path.join(getAppRoot(), 'data', 'reports', `${id}.json`)
  if (existsSync(reportFile)) {
    try {
      unlinkSync(reportFile)
    } catch {
      // ignore
    }
  }
}

/**
 * Opens a modern file picker (same style as &lt;input type="file"&gt;).
 * User selects package.json; we return its parent folder.
 */
export function browseForFolder(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select the project package.json'
$dialog.Filter = 'package.json|package.json|JSON files (*.json)|*.json|All files (*.*)|*.*'
$dialog.FilterIndex = 1
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
$dialog.Multiselect = $false
$dialog.RestoreDirectory = $true
$dialog.FileName = 'package.json'
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  $file = $dialog.FileName
  if ([System.IO.Path]::GetFileName($file) -ieq 'package.json') {
    [Console]::Out.Write([System.IO.Path]::GetDirectoryName($file))
  }
}
`
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', script],
        { windowsHide: true },
      )
      let out = ''
      child.stdout.on('data', (b: Buffer) => {
        out += b.toString('utf8')
      })
      child.on('close', () => {
        const selected = out.trim()
        resolve(selected || null)
      })
      child.on('error', () => resolve(null))
      return
    }

    // Non-Windows: no GUI picker in this setup
    resolve(null)
  })
}

export function ensureReportsDir(): void {
  mkdirSync(path.join(getAppRoot(), 'data', 'reports'), { recursive: true })
}
