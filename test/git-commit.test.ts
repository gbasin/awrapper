import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { execa } from 'execa'

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

describe('commit op feature flag', () => {
  describe('disabled by default', () => {
    let app: import('fastify').FastifyInstance
    let repoDir: string
    beforeAll(async () => {
      delete process.env.AWRAPPER_ENABLE_COMMIT
      delete process.env.AWRAPPER_GIT_COMMIT
      vi.resetModules()

      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-commit-off-'))
      process.env.HOME = tmpHome
      process.env.USERPROFILE = tmpHome

      repoDir = path.join(tmpHome, 'repo')
      await fs.ensureDir(repoDir)
      await execa('git', ['init', '-b', 'main'], { cwd: repoDir })
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir })
      await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir })
      await fs.writeFile(path.join(repoDir, 'a.txt'), 'A\n')
      await execa('git', ['add', '.'], { cwd: repoDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: repoDir })

      const { ensureDataDirs } = await import('../src/config.js')
      await ensureDataDirs()
      const { ensureAgentsRegistry } = await import('../src/agents.js')
      ensureAgentsRegistry()
      const { buildServer } = await import('../src/server.js')
      app = await buildServer({ listen: false })
    })
    afterAll(async () => { await app.close() })

    it('returns 404 for commit op when disabled', async () => {
      const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
      expect(create.statusCode).toBe(200)
      const { id } = create.json() as any
      const res = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'commit', message: 'test' }, headers: { 'content-type': 'application/json' } })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('enabled via env', () => {
    let app: import('fastify').FastifyInstance
    let repoDir: string
    beforeAll(async () => {
      process.env.AWRAPPER_ENABLE_COMMIT = '1'
      vi.resetModules()

      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-commit-on-'))
      process.env.HOME = tmpHome
      process.env.USERPROFILE = tmpHome

      repoDir = path.join(tmpHome, 'repo')
      await fs.ensureDir(repoDir)
      await execa('git', ['init', '-b', 'main'], { cwd: repoDir })
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir })
      await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir })
      await fs.writeFile(path.join(repoDir, 'a.txt'), 'A\n')
      await execa('git', ['add', '.'], { cwd: repoDir })
      await execa('git', ['commit', '-m', 'init'], { cwd: repoDir })

      const { ensureDataDirs } = await import('../src/config.js')
      await ensureDataDirs()
      const { ensureAgentsRegistry } = await import('../src/agents.js')
      ensureAgentsRegistry()
      const { buildServer } = await import('../src/server.js')
      app = await buildServer({ listen: false })
    })
    afterAll(async () => { await app.close() })

    it('commits staged changes only', async () => {
      const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
      expect(create.statusCode).toBe(200)
      const { id } = create.json() as any
      const sess = await app.inject({ method: 'GET', url: `/sessions/${id}` })
      const wt = (sess.json() as any).worktree_path as string

      // Create one staged file and one unstaged file
      await fs.writeFile(path.join(wt, 'staged.txt'), 'S\n')
      await execa('git', ['-C', wt, 'add', '--', 'staged.txt'])
      await fs.writeFile(path.join(wt, 'unstaged.txt'), 'U\n')

      // Commit
      const res = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'commit', message: 'test commit' }, headers: { 'content-type': 'application/json' } })
      expect(res.statusCode).toBe(200)

      // After commit: staged is empty; unstaged remains
      const ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
      const cj = ch.json() as any
      expect(Array.isArray(cj.staged)).toBe(true)
      expect(cj.staged.length === 0 || !cj.staged.some((e: any) => e.path === 'staged.txt')).toBeTruthy()
      expect(cj.unstaged.some((e: any) => e.path === 'unstaged.txt')).toBe(true)
    })
  })
})

