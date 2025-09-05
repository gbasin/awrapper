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

describe('integration: oneshot exec writes last message and uses cwd', () => {
  it('exec writes last-message.txt and runs in cwd', async () => {
    const { spawnOneshotCodex } = await import('../src/sessionProc.ts');

    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-wt1-'));
    const prompt = 'ping';
    const { proc, artifactDir, logPath } = await spawnOneshotCodex({ worktree, prompt });
    if (!proc) throw new Error('no process');

    await proc; // wait for completion

    const realWorktree = await fs.realpath(worktree);
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    expect(log).toContain(`CWD:${realWorktree}`);
    const expectedLast = path.join(artifactDir, 'last-message.txt');
    // Inspect ARGS dumped by fake codex to ensure flag is present
    const argsLine = (log.split('\n').find((l) => l.startsWith('ARGS:')) || 'ARGS:[]').slice(5);
    let parsedArgs: string[] = [];
    try { parsedArgs = JSON.parse(argsLine); } catch {}
    expect(parsedArgs).toContain('--output-last-message');
    const idx = parsedArgs.indexOf('--output-last-message');
    expect(parsedArgs[idx + 1]).toBe(expectedLast);
    // Wait briefly for the file to appear in case of FS lag
    for (let i = 0; i < 25; i++) {
      // eslint-disable-next-line no-await-in-loop
      if (await fs.pathExists(expectedLast)) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }
    const content = await fs.readFile(expectedLast, 'utf8');
    expect(content).toContain('Echo: ping');

    // already asserted cwd via log above
  });
});
