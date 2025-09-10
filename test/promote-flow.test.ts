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

describe('promote flow', () => {
  let app: import('fastify').FastifyInstance
  let repoDir: string
  let remoteDir: string

  beforeAll(async () => {
    // Enable promote feature
    process.env.AWRAPPER_ENABLE_PROMOTE = '1'
    vi.resetModules()

    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-promote-'))
    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome

    // Create a bare remote repo
    remoteDir = path.join(tmpHome, 'remote.git')
    await execa('git', ['init', '--bare', remoteDir])

    // Create working repo and add remote
    repoDir = path.join(tmpHome, 'repo')
    await fs.ensureDir(repoDir)
    await execa('git', ['init', '-b', 'main'], { cwd: repoDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir })
    await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir })
    await fs.writeFile(path.join(repoDir, 'a.txt'), 'A\n')
    await execa('git', ['add', '.'], { cwd: repoDir })
    await execa('git', ['commit', '-m', 'init'], { cwd: repoDir })
    await execa('git', ['remote', 'add', 'origin', remoteDir], { cwd: repoDir })

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

  it('stages, commits, pushes, and returns branch info', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any
    const sess = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    const wt = (sess.json() as any).worktree_path as string

    // Create a change in worktree
    await fs.writeFile(path.join(wt, 'b.txt'), 'B\n')

    // Promote with explicit branch name so we can assert
    const branch = 'awrapper/test-branch'
    const promote = await app.inject({ method: 'POST', url: `/sessions/${id}/promote`, payload: { message: 'test promote', branch }, headers: { 'content-type': 'application/json' } })
    expect(promote.statusCode).toBe(200)
    const pj = promote.json() as any
    expect(pj.ok).toBe(true)
    expect(pj.branch).toBe(branch)
    expect(pj.pushed).toBe(true)

    // Verify remote received the branch
    const { stdout } = await execa('git', ['ls-remote', '--heads', remoteDir, branch])
    expect((stdout || '').includes(`refs/heads/${branch}`)).toBe(true)
  })
})

