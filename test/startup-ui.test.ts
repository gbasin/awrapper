import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

let app: import('fastify').FastifyInstance;
let startedUrl = '';

describe('server startup and UI', () => {
  beforeAll(async () => {
    // Isolate HOME to avoid polluting real user dirs
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'awrapper-startup-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;

    const { buildServer } = await import('../src/server.js');
    app = await buildServer({ listen: false });
    // Start on an ephemeral port to verify bind works
    startedUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    try { await app?.close(); } catch {}
  });

  it('starts listening on an ephemeral port', () => {
    expect(typeof startedUrl).toBe('string');
    const u = new URL(startedUrl);
    expect(u.protocol).toMatch(/^http/);
    expect(Number(u.port)).toBeGreaterThan(0);
  });

  it('serves SPA index.html at root (if built)', async () => {
    const indexPath = path.resolve(process.cwd(), 'web/dist/index.html');
    const hasIndex = await fs.pathExists(indexPath);
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    if (hasIndex) {
      expect(res.statusCode).toBe(200);
      const body = res.body || '';
      expect(body.toLowerCase()).toContain('<!doctype html>');
    } else {
      // If the SPA bundle is not present, root should 404 rather than crash
      expect([404, 200]).toContain(res.statusCode);
    }
  });

  it('SPA fallback serves index.html for client routes (if built)', async () => {
    const indexPath = path.resolve(process.cwd(), 'web/dist/index.html');
    const hasIndex = await fs.pathExists(indexPath);
    const res = await app.inject({ method: 'GET', url: '/some/spa/route', headers: { accept: 'text/html' } });
    if (hasIndex) {
      expect(res.statusCode).toBe(200);
      const body = res.body || '';
      expect(body.toLowerCase()).toContain('<!doctype html>');
    } else {
      expect([404, 200]).toContain(res.statusCode);
    }
  });
});

