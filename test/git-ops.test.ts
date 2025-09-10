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

let app: import('fastify').FastifyInstance
let repoDir: string

beforeAll(async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-'))
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

afterAll(async () => {
  await app.close()
})

describe('git ops endpoint', () => {
  it('stages, unstages, and discards changes', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any
    const sess = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    const wt = (sess.json() as any).worktree_path as string

    // Add an unstaged change
    await fs.writeFile(path.join(wt, 'b.txt'), 'B\n')
    let ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    let cj = ch.json() as any
    expect(cj.unstaged.some((e: any) => e.path === 'b.txt')).toBe(true)

    // Stage it via API
    const st = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'stage', paths: ['b.txt'] }, headers: { 'content-type': 'application/json' } })
    expect(st.statusCode).toBe(200)
    ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    cj = ch.json() as any
    expect(cj.staged.some((e: any) => e.path === 'b.txt')).toBe(true)

    // Unstage
    const un = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'unstage', paths: ['b.txt'] }, headers: { 'content-type': 'application/json' } })
    expect(un.statusCode).toBe(200)
    ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    cj = ch.json() as any
    expect(cj.unstaged.some((e: any) => e.path === 'b.txt')).toBe(true)

    // Discard worktree
    const dw = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'discardWorktree', paths: ['b.txt'] }, headers: { 'content-type': 'application/json' } })
    expect(dw.statusCode).toBe(200)
    ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    cj = ch.json() as any
    expect(cj.unstaged.some((e: any) => e.path === 'b.txt')).toBe(false)

    // Create a staged change and discard from index
    await fs.writeFile(path.join(wt, 'c.txt'), 'C\n')
    await execa('git', ['-C', wt, 'add', '--', 'c.txt'])
    ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    cj = ch.json() as any
    expect(cj.staged.some((e: any) => e.path === 'c.txt')).toBe(true)
    const di = await app.inject({ method: 'POST', url: `/sessions/${id}/git`, payload: { op: 'discardIndex', paths: ['c.txt'] }, headers: { 'content-type': 'application/json' } })
    expect(di.statusCode).toBe(200)
    ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    cj = ch.json() as any
    expect(cj.staged.some((e: any) => e.path === 'c.txt')).toBe(false)
  })
})

