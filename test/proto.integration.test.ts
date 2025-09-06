import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';

// Import targets at runtime so our env overrides (HOME, CODEX_BIN) apply

let prevHome: string | undefined;
let tmpHome = '';
let prevCodex: string | undefined;

beforeEach(async () => {
  prevHome = process.env.HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-int-'));
  process.env.HOME = tmpHome;
  // Point to our fake codex binary
  prevCodex = process.env.CODEX_BIN;
  process.env.CODEX_BIN = path.resolve('test/fixtures/fake-codex.js');
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevCodex === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = prevCodex;
  await fs.remove(tmpHome).catch(() => {});
});

describe('integration: proto with cwd and handshake', () => {
  it('spawns codex proto in worktree cwd and completes a turn', async () => {
    const { spawnPersistentCodex } = await import('../src/sessionProc.ts');
    const { CodexProtoSession } = await import('../src/proto.ts');

    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-wt-'));

    const realWorktree = await fs.realpath(worktree);
    const { proc, logPath } = await spawnPersistentCodex({ worktree });
    if (!proc) throw new Error('no process');

    const proto = new CodexProtoSession(proc);
    await proto.configureSession(worktree, { approval_policy: 'never' });

    const text = 'Hello integration';
    const runId = crypto.randomUUID();
    proto.sendUserInput(text, runId);
    const out = await proto.awaitTaskComplete(runId, 2000);
    expect(out).toContain('Echo: Hello integration');

    // Verify the child process cwd via the log output from the fake codex
    // Allow a brief delay for the log to flush
    await new Promise((r) => setTimeout(r, 50));
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    expect(log).toContain(`CWD:${realWorktree}`);

    try { proc.kill('SIGTERM'); } catch {}
  });
});

// oneshot mode removed; persistent-only
