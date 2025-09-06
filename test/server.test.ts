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
    const body = new URLSearchParams({ repo_path: repoDir, lifecycle: 'oneshot', initial_message: 'hello' }).toString();
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(303);
    const loc = res.headers['location'] as string;
    expect(loc).toMatch(/^\/sessions\//);
  });

  it('accepts application/json and returns id', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir, lifecycle: 'oneshot', initial_message: 'hi' }, headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(typeof json.id).toBe('string');
    expect(json.id.length).toBeGreaterThan(8);
  });

  it('session HTML uses Accept: application/json in inline fetches', async () => {
    // create a persistent session so the page renders the messaging UI
    const create = await app.inject({ method: 'POST', url: '/sessions', payload: { repo_path: repoDir, lifecycle: 'persistent' }, headers: { 'content-type': 'application/json' } });
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
});
