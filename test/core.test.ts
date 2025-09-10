import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

// Defer imports so we can set HOME and env first
let buildServer: any;
let ensureDataDirs: any;
let ensureAgentsRegistry: any;

async function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awrapper-repo-'));
  await execa('git', ['init', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  await execa('git', ['add', '.'], { cwd: dir });
  await execa('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('awrapper core flow', () => {
  const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'awrapper-home-'));
  const stubPath = path.resolve('test/fixtures/codex-stub.js');
  let app: any;

  beforeAll(async () => {
    process.env.HOME = TMP_HOME;
    process.env.CODEX_BIN = stubPath;
    // Make stub executable (for POSIX)
    try { fs.chmodSync(stubPath, 0o755); } catch {}
    // Dynamic imports after env
    ({ ensureDataDirs } = await import('../src/config.js'));
    await ensureDataDirs();
    ({ ensureAgentsRegistry } = await import('../src/agents.js'));
    ensureAgentsRegistry();
    ({ buildServer } = await import('../src/server.js'));
    app = await buildServer({ listen: false });
  });

  afterAll(async () => {
    try { await app?.close(); } catch {}
  });

  it('creates a session and processes an initial message', async () => {
    const repo = await makeTempGitRepo();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        repo_path: repo,
        initial_message: 'do it'
      }
    });
    expect(res.statusCode).toBe(200);
    const { id } = res.json();
    expect(id).toBeTruthy();

    // Fetch messages and find assistant reply from bootstrap turn
    let got = '';
    for (let i = 0; i < 40; i++) {
      const list = await app.inject({ method: 'GET', url: `/sessions/${id}/messages` });
      const arr = list.json();
      const assts = arr.filter((m: any) => m.role === 'assistant');
      if (assts.length) { got = assts[assts.length - 1].content; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(got).toContain('Echo: do it');
  });

  it('supports persistent session messaging via proto', async () => {
    const repo = await makeTempGitRepo();
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repo } });
    expect(res.statusCode).toBe(200);
    const { id } = res.json();
    expect(id).toBeTruthy();

    // Send a message
    const msgRes = await app.inject({
      method: 'POST',
      url: `/sessions/${id}/messages`,
      payload: { content: 'Hello' }
    });
    expect(msgRes.statusCode).toBe(200);

    // Fetch messages and find assistant reply with non-empty content
    // Poll briefly to tolerate async streaming updates
    let got = '';
    for (let i = 0; i < 20; i++) {
      const list = await app.inject({ method: 'GET', url: `/sessions/${id}/messages` });
      const arr = list.json();
      const assts = arr.filter((m: any) => m.role === 'assistant');
      if (assts.length) {
        const last = assts[assts.length - 1];
        if (last.content && String(last.content).length > 0) {
          got = last.content;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(got).toBe('Echo: Hello');
  });

  it('enforces one in-flight turn with 409', async () => {
    const repo = await makeTempGitRepo();
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repo } });
    const { id } = res.json();

    // Fire two requests almost at once; second should 409 because stub delays ~150ms
    const p1 = app.inject({ method: 'POST', url: `/sessions/${id}/messages`, payload: { content: 'First' } });
    const p2 = app.inject({ method: 'POST', url: `/sessions/${id}/messages`, payload: { content: 'Second' } });
    const r1 = await p1;
    const r2 = await p2;
    // One should be 200, the other 409
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });
});
