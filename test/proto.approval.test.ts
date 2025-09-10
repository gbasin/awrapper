import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'fs-extra'

let prevHome: string | undefined
let tmpHome = ''
let prevCodex: string | undefined

beforeEach(async () => {
  prevHome = process.env.HOME
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-int-'))
  process.env.HOME = tmpHome
  // Point to our fake codex binary that supports approval requests
  prevCodex = process.env.CODEX_BIN
  process.env.CODEX_BIN = path.resolve('test/fixtures/fake-codex.js')
})

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
  if (prevCodex === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = prevCodex
  await fs.remove(tmpHome).catch(() => {})
})

describe('proto approval pause', () => {
  it('does not timeout while awaiting approval and completes after decision', async () => {
    const { spawnPersistentCodex } = await import('../src/sessionProc.ts')
    const { CodexProtoSession } = await import('../src/proto.ts')

    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-wt-'))
    const { proc } = await spawnPersistentCodex({ worktree })
    if (!proc) throw new Error('no process')

    const proto = new CodexProtoSession(proc)
    await proto.configureSession(worktree, { approval_policy: 'never' })

    // Start a run that triggers approval
    const runId = crypto.randomUUID()
    proto.sendUserInput('REQUEST_APPROVAL please', runId)

    // Capture the call id from the approval event
    const callId = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no approval event')), 1000)
      const off = proto.onEvent((ev) => {
        if (ev.id === runId && ev.msg?.type === 'apply_patch_approval_request') {
          clearTimeout(t)
          off()
          resolve(String(ev.msg?.call_id || ''))
        }
      })
    })
    expect(callId).toBeTruthy()

    // Wait longer than the very short inactivity timeout we pass into awaitTaskComplete,
    // to ensure it would have timed out if the pause logic did not work.
    await new Promise((r) => setTimeout(r, 250))

    // Approve the request and ensure the run completes
    proto.sendApprovalDecision(callId, 'approve', { scope: 'once' })
    const out = await proto.awaitTaskComplete(runId, 100) // tiny inactivity timeout, but paused during wait
    expect(out).toContain('Approval approve')

    try { proc.kill('SIGTERM') } catch {}
  })
})

