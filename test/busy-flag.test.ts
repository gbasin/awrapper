import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'

let buildServer: any
let ensureDataDirs: any
let ensureAgentsRegistry: any
let app: import('fastify').FastifyInstance

async function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awrapper-repo-'))
  await execa('git', ['init', '-b', 'main'], { cwd: dir })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n')
  await execa('git', ['add', '.'], { cwd: dir })
  await execa('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

beforeAll(async () => {
  const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'awrapper-home-'))
  process.env.HOME = TMP_HOME
  process.env.CODEX_BIN = path.resolve('test/fixtures/codex-stub.js')
  try { fs.chmodSync(process.env.CODEX_BIN!, 0o755) } catch {}
  ;({ ensureDataDirs } = await import('../src/config.js'))
  await ensureDataDirs()
  ;({ ensureAgentsRegistry } = await import('../src/agents.js'))
  ensureAgentsRegistry()
  ;({ buildServer } = await import('../src/server.js'))
  app = await buildServer({ listen: false })
})

afterAll(async () => {
  try { await app?.close() } catch {}
})

describe('busy flag', () => {
  it('exposes busy=true only while a turn is in-flight', async () => {
    const repo = await makeTempGitRepo()
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repo }, headers: { 'content-type': 'application/json' } })
    expect(create.statusCode).toBe(200)
    const { id } = create.json() as any

    // Initially idle
    const s0 = await app.inject({ method: 'GET', url: `/sessions/${id}` })
    expect(s0.statusCode).toBe(200)
    const j0 = s0.json() as any
    expect(j0.status).toBe('running')
    expect(Boolean(j0.busy)).toBe(false)

    // Kick off an async turn; endpoint acks immediately (200)
    const send = await app.inject({ method: 'POST', url: `/sessions/${id}/messages`, payload: { content: 'hello' }, headers: { 'content-type': 'application/json' } })
    expect(send.statusCode).toBe(200)

    // During the ~150ms stubbed processing window, busy should show up as true at least once
    let sawBusy = false
    for (let i = 0; i < 20 && !sawBusy; i++) {
      const row = await app.inject({ method: 'GET', url: `/sessions/${id}` })
      const js = row.json() as any
      if (js.busy === true) sawBusy = true
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(sawBusy).toBe(true)

    // And it should return to false shortly after completion
    let backToIdle = false
    for (let i = 0; i < 40 && !backToIdle; i++) {
      const row = await app.inject({ method: 'GET', url: `/sessions/${id}` })
      const js = row.json() as any
      if (js.busy === false) backToIdle = true
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(backToIdle).toBe(true)

    // List endpoint also includes busy flag
    const list = await app.inject({ method: 'GET', url: '/sessions' })
    const arr = list.json() as any[]
    const found = arr.find((s) => s.id === id)
    expect(found).toBeTruthy()
    expect(found.busy === false).toBe(true)
  })
})

