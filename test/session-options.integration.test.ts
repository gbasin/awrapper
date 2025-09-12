import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';

let prevHome: string | undefined;
let tmpHome = '';
let prevCodex: string | undefined;

beforeEach(async () => {
  prevHome = process.env.HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-int-'));
  process.env.HOME = tmpHome;
  prevCodex = process.env.CODEX_BIN;
  process.env.CODEX_BIN = path.resolve('test/fixtures/fake-codex.js');
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevCodex === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = prevCodex;
  await fs.remove(tmpHome).catch(() => {});
});

describe('spawnPersistentCodex passes -c overrides', () => {
  it('includes model/tools/approvals/sandbox flags', async () => {
    const { spawnPersistentCodex } = await import('../src/sessionProc.ts');
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-wt-'));
    const { proc, logPath } = await spawnPersistentCodex({ worktree, options: {
      model: 'gpt-5-high',
      approval_policy: 'never',
      sandbox_mode: 'workspace-write',
      include_plan_tool: true,
      web_search: true,
      include_apply_patch_tool: true,
      include_view_image_tool: true,
    }});
    if (!proc) throw new Error('no process');
    // Give the stub a moment to flush
    await new Promise((r) => setTimeout(r, 200));
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    expect(log).toContain('ARGS:');
    // Basic presence assertions (tokens in argv)
    expect(log).toContain('model=gpt-5-high');
    expect(log).toContain('approval_policy=never');
    expect(log).toContain('sandbox_mode=workspace-write');
    expect(log).toContain('include_plan_tool=true');
    expect(log).toContain('tools.web_search=true');
    expect(log).toContain('include_apply_patch_tool=true');
    expect(log).toContain('include_view_image_tool=true');
    try { proc.kill('SIGTERM'); } catch {}
  });
});
