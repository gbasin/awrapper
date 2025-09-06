import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';

// Helper to create an isolated HOME so config writes under a temp dir
let prevHome: string | undefined;
let tmpHome: string = '';

beforeEach(async () => {
  prevHome = process.env.HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-'));
  process.env.HOME = tmpHome;
  vi.resetModules();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  await fs.remove(tmpHome).catch(() => {});
});

describe('sessionProc uses cwd instead of -C', () => {
  it('spawnPersistentCodex passes cwd and no -C', async () => {
    (globalThis as any).__execaCalls = [] as Array<{ bin: any; args: any[]; opts: any }>;
    vi.mock('execa', () => {
      const execaFn = vi.fn((bin: string, args: any[], opts: any) => {
        (globalThis as any).__execaCalls.push({ bin, args, opts });
        return { all: { pipe: vi.fn() }, once: vi.fn() } as any;
      });
      return { execa: execaFn };
    });

    const { spawnPersistentCodex } = await import('../src/sessionProc.ts');

    const worktree = path.join(os.tmpdir(), 'fake-worktree-persist');
    await fs.ensureDir(worktree);

    await spawnPersistentCodex({ worktree });

    const calls = (globalThis as any).__execaCalls as Array<{ bin: any; args: any[]; opts: any }>;
    expect(calls.length).toBe(1);
    const c = calls[0];
    expect(c.bin).toBe('codex');
    expect(c.opts?.cwd).toBe(worktree);
    expect(c.args).not.toContain('-C');
    // proto invocation with approval policy flag first
    expect(c.args[0]).toBe('-a=never');
    expect(c.args[1]).toBe('proto');
  });
});
