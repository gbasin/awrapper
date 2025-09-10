import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'

// Mock process spawns for codex so tests don't require the binary
vi.mock('../src/sessionProc.js', () => {
  const mkProc = () => ({ pid: 12345, once: (_evt: string, _cb: any) => {} }) as any
  const home = os.homedir()
  const logs = path.join(home, '.awrapper', 'logs')
  const artifacts = path.join(home, '.awrapper', 'artifacts')
  return {
    setupPaths: async (id: string) => {
      const logPath = path.join(logs, `session-${id}.log`)
      const artifactDir = path.join(artifacts, `session-${id}`)
      await fs.ensureDir(path.dirname(logPath))
      await fs.ensureDir(artifactDir)
      return { logPath, artifactDir }
    },
    spawnOneshotCodex: async () => ({ proc: mkProc(), logPath: path.join(logs, 'dummy.log'), artifactDir: path.join(artifacts, 'dummy') }),
    spawnPersistentCodex: async () => ({ proc: mkProc(), logPath: path.join(logs, 'dummy.log'), artifactDir: path.join(artifacts, 'dummy') })
  }
})

// Mock proto session
vi.mock('../src/proto.js', () => {
  class CodexProtoSession {
    constructor(_proc: any) {}
    onEvent(_cb: any) { return () => {} }
    sendUserInput(_text: string, runId = crypto.randomUUID()) { return runId }
    async awaitTaskComplete(_runId: string) { return 'ok' }
    async configureSession() {}
    sendApprovalDecision() {}
  }
  return { CodexProtoSession }
})

describe('promote flag', () => {
  describe('disabled by default', () => {
    let app: import('fastify').FastifyInstance
    let repoDir: string
    beforeAll(async () => {
      delete process.env.AWRAPPER_ENABLE_PROMOTE
      delete process.env.AWRAPPER_GIT_PROMOTE
      vi.resetModules()

      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-promote-off-'))
      process.env.HOME = tmpHome
      process.env.USERPROFILE = tmpHome

      repoDir = path.join(tmpHome, 'repo')
      await fs.ensureDir(repoDir)
      // minimal repo; promote endpoints should 404 regardless
      await fs.writeFile(path.join(repoDir, 'a.txt'), 'A\n')

      const { ensureDataDirs } = await import('../src/config.js')
      await ensureDataDirs()
      const { ensureAgentsRegistry } = await import('../src/agents.js')
      ensureAgentsRegistry()
      const { buildServer } = await import('../src/server.js')
      app = await buildServer({ listen: false })
    })
    afterAll(async () => { await app.close() })

    it('returns 404 for preflight and promote when disabled', async () => {
      const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir, use_worktree: false }, headers: { 'content-type': 'application/json' } })
      expect(create.statusCode).toBe(200)
      const { id } = create.json() as any
      const pf = await app.inject({ method: 'GET', url: `/sessions/${id}/promote/preflight` })
      expect(pf.statusCode).toBe(404)
      const pr = await app.inject({ method: 'POST', url: `/sessions/${id}/promote`, payload: { message: 'x' }, headers: { 'content-type': 'application/json' } })
      expect(pr.statusCode).toBe(404)
    })
  })
})

