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
  await fs.writeFile(path.join(repoDir, 'README.md'), 'hello\n')
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

describe('changes/diff/file API', () => {
  it('lists staged/unstaged changes and diffs', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any
    const sess = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    expect(sess.statusCode).toBe(200)
    const srow = sess.json() as any
    const wt = srow.worktree_path as string
    // create a new file (unstaged)
    await fs.writeFile(path.join(wt, 'foo.txt'), 'one\n')

    const ch1 = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    expect(ch1.statusCode).toBe(200)
    const j1 = ch1.json() as any
    expect(j1.gitAvailable).not.toBe(false)
    const hasUn = j1.unstaged.some((e: any) => e.path === 'foo.txt')
    expect(hasUn).toBe(true)

    // stage it
    await execa('git', ['add', 'foo.txt'], { cwd: wt })
    const ch2 = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    const j2 = ch2.json() as any
    const hasSt = j2.staged.some((e: any) => e.path === 'foo.txt')
    expect(hasSt).toBe(true)

    const diff = await app.inject({ method: 'GET', url: `/sessions/${id}/diff?path=foo.txt&side=index&context=2` })
    expect(diff.statusCode).toBe(200)
    const dj = diff.json() as any
    expect(dj.isBinary).toBe(false)
    expect(typeof dj.diff).toBe('string')
    expect(dj.diff).toContain('foo.txt')
  })

  it('gets and writes file content with etag', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any
    const sess = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    const wt = (sess.json() as any).worktree_path as string

    const getHead = await app.inject({ method: 'GET', url: `/sessions/${id}/file?path=README.md&rev=head` })
    expect(getHead.statusCode).toBe(200)
    const g1 = getHead.json() as any
    expect(typeof g1.content).toBe('string')
    expect(typeof g1.etag).toBe('string')

    // Write a new file
    const put = await app.inject({ method: 'PUT', url: `/sessions/${id}/file`, payload: { path: 'bar.txt', content: 'abc\n', stage: false }, headers: { 'content-type': 'application/json' } })
    expect(put.statusCode).toBe(200)
    const exists = await fs.pathExists(path.join(wt, 'bar.txt'))
    expect(exists).toBe(true)

    // Concurrency guard: read etag then write with same etag succeeds
    const getWork = await app.inject({ method: 'GET', url: `/sessions/${id}/file?path=bar.txt&rev=worktree` })
    const g2 = getWork.json() as any
    const put2 = await app.inject({ method: 'PUT', url: `/sessions/${id}/file`, payload: { path: 'bar.txt', content: 'abcd\n', expected_etag: g2.etag }, headers: { 'content-type': 'application/json' } })
    expect(put2.statusCode).toBe(200)
  })

  it('handles non-git directories', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-non-git-'))
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: tmp, use_worktree: false }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any
    const ch = await app.inject({ method: 'GET', url: `/sessions/${id}/changes` })
    const j = ch.json() as any
    expect(j.gitAvailable).toBe(false)
  })

  it('rejects path traversal', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
    const { id } = create.json() as any
    const bad = await app.inject({ method: 'GET', url: `/sessions/${id}/diff?path=../etc/passwd` })
    expect(bad.statusCode).toBe(400)
  })
})

