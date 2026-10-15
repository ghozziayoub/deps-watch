import { defineConfig, type Plugin } from 'vite'
import { json, readJsonBody } from './server/http.ts'
import {
  addIgnore,
  loadIgnores,
  removeIgnore,
  applyIgnoresToFindings,
} from './server/ignores.ts'
import { checkGitReady } from './server/gitSafety.ts'
import { getFixJob, startFixJob } from './server/fix.ts'
import {
  loadProjectReport,
  runScan,
  saveProjectReport,
} from './server/scan.ts'
import { sortByPriority } from './server/priority.ts'
import {
  addProjectFromFolder,
  browseForFolder,
  getProjectConfig,
  listProjectConfigs,
  removeProject,
} from './server/projectsStore.ts'
import { detectFramework } from './server/framework.ts'
import {
  detectPackageManager,
  packageManagerLabel,
} from './server/packageManager.ts'
import { inspectProjectHealth } from './server/projectHealth.ts'
import { detectVerifyCommand } from './server/verify.ts'
import type { FixJobRequest } from './server/types.ts'

function refreshProjectReportIgnores(projectId: string) {
  const report = loadProjectReport(projectId)
  if (!report) return null
  report.findings = sortByPriority(applyIgnoresToFindings(report.findings))
  saveProjectReport(projectId, report)
  return report
}

function projectListPayload() {
  return listProjectConfigs().map((p) => {
    const framework = detectFramework(p.path)
    const health = inspectProjectHealth(p.path)
    const packageManager = health.packageManager || detectPackageManager(p.path)
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      verifyLabel: detectVerifyCommand(p, packageManager)?.label ?? null,
      framework: framework.label,
      frameworkId: framework.id,
      packageManager,
      packageManagerLabel: packageManagerLabel(packageManager),
      healthOk: health.ok,
      healthCode: health.code,
      healthMessage: health.message,
      healthHint: health.hint,
    }
  })
}

function depsWatchApi(): Plugin {
  return {
    name: 'deps-watch-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? ''
        const url = rawUrl.split('?')[0]
        const qs = new URL(rawUrl, 'http://localhost').searchParams
        if (!url?.startsWith('/api/')) return next()

        try {
          if (url === '/api/config' && req.method === 'GET') {
            return json(res, 200, { projects: projectListPayload() })
          }

          if (url === '/api/projects/browse' && req.method === 'POST') {
            const path = await browseForFolder()
            return json(res, 200, { path })
          }

          if (url === '/api/projects/add' && req.method === 'POST') {
            const body = await readJsonBody<{ path?: string }>(req)
            if (!body.path?.trim()) {
              return json(res, 400, { error: 'path required' })
            }
            const project = addProjectFromFolder(body.path.trim())
            const projects = projectListPayload()
            const full = projects.find((p) => p.id === project.id)
            return json(res, 200, {
              project: full ?? {
                id: project.id,
                name: project.name,
                path: project.path,
              },
              projects,
            })
          }

          if (url === '/api/projects/remove' && req.method === 'POST') {
            const body = await readJsonBody<{ id?: string }>(req)
            if (!body.id) return json(res, 400, { error: 'id required' })
            removeProject(body.id)
            return json(res, 200, { projects: projectListPayload() })
          }

          if (url === '/api/report' && req.method === 'GET') {
            const projectId = qs.get('projectId')
            if (!projectId) {
              return json(res, 400, { error: 'projectId query required' })
            }
            const report = loadProjectReport(projectId)
            if (!report) {
              return json(res, 404, {
                error: 'No report yet for this project. Run a scan.',
              })
            }
            return json(res, 200, report)
          }

          if (url === '/api/scan' && req.method === 'POST') {
            const body = await readJsonBody<{ projectId?: string }>(req)
            if (!body.projectId) {
              return json(res, 400, { error: 'projectId required' })
            }
            const report = await runScan(body.projectId)
            return json(res, 200, report)
          }

          if (url === '/api/ignores' && req.method === 'GET') {
            return json(res, 200, { items: loadIgnores() })
          }

          if (url === '/api/ignores' && req.method === 'POST') {
            const body = await readJsonBody<{
              projectId: string
              name: string
              days?: number | null
              reason?: string
            }>(req)
            if (!body.projectId || !body.name) {
              return json(res, 400, { error: 'projectId and name required' })
            }
            addIgnore(body)
            const report = refreshProjectReportIgnores(body.projectId)
            return json(res, 200, { items: loadIgnores(), report })
          }

          if (url === '/api/ignores/remove' && req.method === 'POST') {
            const body = await readJsonBody<{
              projectId: string
              name: string
            }>(req)
            removeIgnore(body.projectId, body.name)
            const report = refreshProjectReportIgnores(body.projectId)
            return json(res, 200, { items: loadIgnores(), report })
          }

          if (url === '/api/git-status' && req.method === 'GET') {
            const projectId = qs.get('projectId')
            if (!projectId) {
              return json(res, 400, { error: 'projectId query required' })
            }
            const project = getProjectConfig(projectId)
            if (!project) return json(res, 404, { error: 'Unknown project' })
            const status = await checkGitReady(project.path)
            return json(res, 200, status)
          }

          if (url === '/api/fix' && req.method === 'POST') {
            const body = await readJsonBody<FixJobRequest>(req)
            const job = await startFixJob(body)
            return json(res, 200, job)
          }

          if (url?.startsWith('/api/fix/') && req.method === 'GET') {
            const id = url.slice('/api/fix/'.length)
            if (id.endsWith('/stream')) {
              const jobId = id.slice(0, -'/stream'.length)
              const job = getFixJob(jobId)
              if (!job) return json(res, 404, { error: 'Job not found' })

              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
              })

              let cursor = 0
              const send = () => {
                const current = getFixJob(jobId)
                if (!current) {
                  res.write(
                    `data: ${JSON.stringify({ type: 'error', error: 'Job missing' })}\n\n`,
                  )
                  res.end()
                  return false
                }

                if (cursor < current.logs.length) {
                  const lines = current.logs.slice(cursor)
                  cursor = current.logs.length
                  res.write(
                    `data: ${JSON.stringify({
                      type: 'log',
                      lines,
                      status: current.status,
                      verifyStatus: current.verifyStatus,
                    })}\n\n`,
                  )
                }

                if (current.status === 'done' || current.status === 'error') {
                  res.write(
                    `data: ${JSON.stringify({
                      type: 'done',
                      status: current.status,
                      exitCode: current.exitCode,
                      error: current.error,
                      job: current,
                    })}\n\n`,
                  )
                  res.end()
                  return false
                }
                return true
              }

              res.write(`data: ${JSON.stringify({ type: 'hello', job })}\n\n`)
              const timer = setInterval(() => {
                if (!send()) clearInterval(timer)
              }, 400)
              req.on('close', () => clearInterval(timer))
              return
            }

            const job = getFixJob(id)
            if (!job) return json(res, 404, { error: 'Job not found' })
            return json(res, 200, job)
          }

          return json(res, 404, { error: 'Not found' })
        } catch (error) {
          return json(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [depsWatchApi()],
  server: {
    port: 5179,
    strictPort: true,
  },
})
