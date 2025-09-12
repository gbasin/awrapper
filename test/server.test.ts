import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

// Mock process spawns for codex so tests don't require the binary
vi.mock('../src/sessionProc.js', () => {
  const mkProc = () => ({ pid: 12345, once: (_evt: string, _cb: any) => {} }) as any;
  const home = os.homedir();
  const logs = path.join(home, '.awrapper', 'logs');
  const artifacts = path.join(home, '.awrapper', 'artifacts');
  return {
    setupPaths: async (id: string) => {
      const logPath = path.join(logs, `session-${id}.log`);
      const artifactDir = path.join(artifacts, `session-${id}`);
      await fs.ensureDir(path.dirname(logPath));
      await fs.ensureDir(artifactDir);
      return { logPath, artifactDir };
    },
    spawnOneshotCodex: async () => ({ proc: mkProc(), logPath: path.join(logs, 'dummy.log'), artifactDir: path.join(artifacts, 'dummy') }),
    spawnPersistentCodex: async () => ({ proc: mkProc(), logPath: path.join(logs, 'dummy.log'), artifactDir: path.join(artifacts, 'dummy') })
  };
});

// Mock proto session to avoid needing a real Codex process; emulate quick streaming
vi.mock('../src/proto.js', () => {
  class CodexProtoSession {
    constructor(_proc: any) {}
    onEvent(_cb: any) { return () => {}; }
    sendUserInput(_text: string, runId = crypto.randomUUID()) { return runId; }
    async awaitTaskComplete(_runId: string) {
      // Simulate a short-running turn to keep the lock briefly
      await new Promise((r) => setTimeout(r, 100));
      return 'ok';
    }
    async configureSession() { /* no-op */ }
    sendApprovalDecision() { /* no-op */ }
  }
  return { CodexProtoSession };
});

let app: import('fastify').FastifyInstance;
let repoDir: string;

beforeAll(async () => {
  // Isolate runtime data under a tmp HOME
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-test-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome; // for Windows, just in case

  // Create a real git repo with an initial commit
  repoDir = path.join(tmpHome, 'repo');
  await fs.ensureDir(repoDir);
  await execa('git', ['init'], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, 'README.md'), 'test');
  await execa('git', ['add', '.'], { cwd: repoDir });
  await execa('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], { cwd: repoDir });

  const { ensureDataDirs } = await import('../src/config.js');
  await ensureDataDirs();
  const { ensureAgentsRegistry } = await import('../src/agents.js');
  ensureAgentsRegistry();
  const { buildServer } = await import('../src/server.js');
  app = await buildServer({ listen: false });
});

afterAll(async () => {
  await app.close();
});

describe('sessions routes', () => {
  it('accepts application/x-www-form-urlencoded and redirects', async () => {
    const body = new URLSearchParams({ repo_path: repoDir, initial_message: 'hello' }).toString();
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(303);
    const loc = res.headers['location'] as string;
    expect(loc).toMatch(/^\/sessions\//);
  });

  it('accepts application/json and returns id', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir, initial_message: 'hi' }, headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(typeof json.id).toBe('string');
    expect(json.id.length).toBeGreaterThan(8);
  });

  it('session HTML uses Accept: application/json in inline fetches', async () => {
    // create a session so the page renders the messaging UI
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } });
    expect(create.statusCode).toBe(200);
    const { id } = create.json() as any;

    // Request HTML explicitly like a browser would
    const page = await app.inject({ method: 'GET', url: `/sessions/${id}`, headers: { 'accept': 'text/html' } });
    expect(page.statusCode).toBe(200);
    const html = page.body as string;
    expect(html).toContain('<!doctype html>');
    // Guard that client-side fetch forces JSON Accept header to avoid negotiation issues
    expect(html).toContain("fetch('/sessions/' + id, { headers: { 'Accept': 'application/json' } })");
    expect(html).toContain("fetch('/sessions/' + id + '/messages?after=', { headers: { 'Accept': 'application/json' } })");
    // Guard that polling failures are contained and do not break event wiring
    expect(html).toContain('poll().catch(() => {})');
  });

  it('POST /messages acknowledges immediately and enforces lock', async () => {
    // Create a fresh session
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } });
    expect(create.statusCode).toBe(200);
    const { id } = create.json() as any;

    // Send a message and verify quick ACK with IDs
    const t0 = Date.now();
    const res1 = await app.inject({ method: 'POST', url: `/sessions/${id}/messages`, payload: { content: 'hello' }, headers: { 'content-type': 'application/json' } });
    const dt = Date.now() - t0;
    expect(res1.statusCode).toBe(200);
    // Should not block for long; allow a generous threshold
    expect(dt).toBeLessThan(500);
    const j1 = res1.json() as any;
    expect(typeof j1.turn_id).toBe('string');
    expect(typeof j1.user_message_id).toBe('string');
    expect(typeof j1.assistant_message_id).toBe('string');

    // Assistant placeholder should be present immediately
    const msgs = await app.inject({ method: 'GET', url: `/sessions/${id}/messages` });
    expect(msgs.statusCode).toBe(200);
    const arr = msgs.json() as any[];
    const assistant = arr.find((m) => m.id === j1.assistant_message_id);
    expect(assistant).toBeTruthy();

    // While the background turn is in flight, a second POST should be rejected
    const res2 = await app.inject({ method: 'POST', url: `/sessions/${id}/messages`, payload: { content: 'second' }, headers: { 'content-type': 'application/json' } });
    expect(res2.statusCode).toBe(409);
  });

  it('stores block_while_running per session and allows updating it', async () => {
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir }, headers: { 'content-type': 'application/json' } });
    expect(create.statusCode).toBe(200);
    const { id } = create.json() as any;

    const s1 = await app.inject({ method: 'GET', url: `/sessions/${id}` });
    expect(s1.statusCode).toBe(200);
    const j1 = s1.json() as any;
    expect(j1.block_while_running === 1 || j1.block_while_running === true).toBeTruthy();

    const upd = await app.inject({ method: 'PATCH', url: `/sessions/${id}`, payload: { block_while_running: false }, headers: { 'content-type': 'application/json' } });
    expect(upd.statusCode).toBe(200);
    const j2 = upd.json() as any;
    expect(j2.block_while_running === 0 || j2.block_while_running === false).toBeTruthy();
  });

  it('persists session settings (model/tools/policies)', async () => {
    const body = {
      repo_path: repoDir,
      model: 'gpt-5-high',
      approval_policy: 'never',
      sandbox_mode: 'workspace-write',
      include_plan_tool: true,
      web_search: true,
      include_apply_patch_tool: false,
      include_view_image_tool: true,
    };
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'content-type': 'application/json' } });
    expect(create.statusCode).toBe(200);
    const { id } = create.json() as any;
    const s1 = await app.inject({ method: 'GET', url: `/sessions/${id}` });
    expect(s1.statusCode).toBe(200);
    const row = s1.json() as any;
    expect(row.model).toBe('gpt-5-high');
    expect(row.approval_policy).toBe('never');
    expect(row.sandbox_mode).toBe('workspace-write');
    expect(row.include_plan_tool === 1 || row.include_plan_tool === true).toBeTruthy();
    expect(row.web_search === 1 || row.web_search === true).toBeTruthy();
    expect(row.include_apply_patch_tool === 0 || row.include_apply_patch_tool === false).toBeTruthy();
    expect(row.include_view_image_tool === 1 || row.include_view_image_tool === true).toBeTruthy();
  });
});
