import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { layout, escapeHtml } from './ui.js';
import { getDb, type Session, type Message } from './db.js';
import { ensureWorktree, isGitRepo } from './git.js';
import { acquireLock, procs, releaseLock } from './state.js';
import { spawnOneshotCodex, spawnPersistentCodex } from './sessionProc.js';
import { DEFAULT_BIND, DEFAULT_PORT } from './config.js';
import fs from 'fs-extra';

export async function buildServer() {
  const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } }).withTypeProvider<ZodTypeProvider>();

  app.get('/', async (_req, reply) => {
    const db = getDb();
    const sessions = db.prepare('select id, agent_id, lifecycle, status, repo_path, branch, started_at, last_activity_at from sessions order by started_at desc limit 50').all() as any[];
    const rows = sessions
      .map(
        (s) => `<tr>
          <td><a href="/sessions/${s.id}">${s.id}</a></td>
          <td>${escapeHtml(s.agent_id)}</td>
          <td>${escapeHtml(s.lifecycle)}</td>
          <td>${escapeHtml(s.status)}</td>
          <td class="muted">${escapeHtml(s.repo_path)}${s.branch ? ' @ ' + escapeHtml(s.branch) : ''}</td>
        </tr>`
      )
      .join('');
    const page = layout(
      'awrapper',
      `
      <h1>Sessions</h1>
      <form method="post" action="/sessions" style="margin-bottom: 16px">
        <div class="row">
          <input name="repo_path" placeholder="/path/to/repo" size="40" required />
          <input name="branch" placeholder="branch (optional)" />
          <select name="lifecycle">
            <option value="persistent" selected>persistent (default)</option>
            <option value="oneshot">oneshot</option>
          </select>
        </div>
        <div style="margin-top:8px">
          <textarea name="initial_message" placeholder="Initial message (optional)"></textarea>
        </div>
        <div style="margin-top:8px">
          <button type="submit">Create session</button>
        </div>
      </form>
      <table>
        <tr><th>id</th><th>agent</th><th>lifecycle</th><th>status</th><th>repo</th></tr>
        ${rows}
      </table>
      `
    );
    reply.type('text/html').send(page);
  });

  app.post('/sessions', {
    schema: {
      body: z.object({
        agent_id: z.string().default('codex'),
        repo_path: z.string(),
        branch: z.string().optional(),
        lifecycle: z.enum(['oneshot', 'persistent']).default('persistent'),
        params: z.record(z.any()).optional(),
        initial_message: z.string().optional()
      })
    }
  }, async (req, reply) => {
    const { agent_id, repo_path, branch, lifecycle, initial_message } = req.body as any;
    if (agent_id !== 'codex') return reply.code(400).send({ error: 'Unsupported agent' });
    if (!(await isGitRepo(repo_path))) return reply.code(400).send({ error: 'repo_path is not a Git repo' });
    const db = getDb();
    const id = crypto.randomUUID();
    const worktree_path = await ensureWorktree(repo_path, branch, id);

    const { logPath, artifactDir } = await (await import('./sessionProc.js')).setupPaths(id);
    const now = Date.now();
    db.prepare(
      `insert into sessions (id, agent_id, repo_path, branch, worktree_path, lifecycle, status, started_at, log_path, agent_log_hint, artifact_dir)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, agent_id, repo_path, branch || null, worktree_path, lifecycle, 'queued', now, logPath, '~/.codex/log/codex-tui.log', artifactDir);

    // Spawn according to lifecycle
    if (lifecycle === 'oneshot') {
      // Default prompt if none provided
      const prompt = initial_message?.trim() || 'Start';
      db.prepare('update sessions set status = ? where id = ?').run('running', id);
      const { proc } = await spawnOneshotCodex({ worktree: worktree_path, prompt });
      procs.set(id, proc!);
      proc!.once('exit', async (code) => {
        const db2 = getDb();
        db2.prepare('update sessions set status = ?, exit_code = ?, closed_at = ?, pid = NULL where id = ?')
          .run('closed', code ?? null, Date.now(), id);
        procs.delete(id);

        // Try to persist last message if present
        try {
          const lastPath = `${artifactDir}/last-message.txt`;
          if (await fs.pathExists(lastPath)) {
            const content = await fs.readFile(lastPath, 'utf8');
            const msgId = crypto.randomUUID();
            db2.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
              .run(msgId, id, null, 'assistant', content, Date.now());
          }
        } catch {}
      });
    } else {
      db.prepare('update sessions set status = ? where id = ?').run('starting', id);
      const { proc } = await spawnPersistentCodex({ worktree: worktree_path });
      db.prepare('update sessions set status = ?, pid = ? where id = ?').run('running', proc!.pid, id);
      procs.set(id, proc!);
      proc!.once('exit', (code) => {
        const db3 = getDb();
        db3.prepare('update sessions set status = ?, exit_code = ?, closed_at = ?, pid = NULL where id = ?')
          .run('closed', code ?? null, Date.now(), id);
        procs.delete(id);
      });
    }

    reply.send({ id, worktree_path });
  });

  app.get('/sessions', async (_req, reply) => {
    const db = getDb();
    const rows = db.prepare('select * from sessions order by started_at desc limit 100').all();
    reply.send(rows);
  });

  app.get('/sessions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const db = getDb();
    const row = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    const msgs = db.prepare('select * from messages where session_id = ? order by created_at asc limit 200').all(id) as Message[];

    // If HTML requested, render page
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      const html = layout(
        `Session ${id}`,
        `
        <p><a href="/">← back</a></p>
        <h2>Session ${id}</h2>
        <p>agent: <b>${row.agent_id}</b> • lifecycle: <b>${row.lifecycle}</b> • status: <b>${row.status}</b></p>
        <p class="muted">repo: ${escapeHtml(row.repo_path)}${row.branch ? ' @ ' + escapeHtml(row.branch) : ''}</p>
        <div class="row">
          <form id="msgform">
            <textarea id="msg" placeholder="Type message" ${row.lifecycle === 'persistent' ? '' : 'disabled'}></textarea>
            <div><button type="submit" ${row.lifecycle === 'persistent' ? '' : 'disabled'}>Send</button></div>
          </form>
          <form method="post" action="/sessions/${id}/cancel"><button>Cancel</button></form>
        </div>
        <h3>Transcript</h3>
        <div id="msgs" class="mono"></div>
        <h3>Log</h3>
        <div id="log" class="log mono"></div>
        <script>
          const id = ${JSON.stringify(id)};
          async function poll() {
            const res = await fetch('/sessions/' + id);
            const data = await res.json();
            const msgsRes = await fetch('/sessions/' + id + '/messages?after=');
            const msgs = await msgsRes.json();
            document.getElementById('msgs').textContent = msgs.map(m => '['+new Date(m.created_at).toLocaleTimeString()+'] ' + m.role + ': ' + m.content).join('\n');
            const logRes = await fetch('/sessions/' + id + '/log?tail=500');
            document.getElementById('log').textContent = await logRes.text();
          }
          setInterval(poll, 250);
          poll();

          document.getElementById('msgform').addEventListener('submit', async (e) => {
            e.preventDefault();
            const content = document.getElementById('msg').value;
            if (!content.trim()) return;
            await fetch('/sessions/' + id + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
            document.getElementById('msg').value='';
          });
        </script>
        `
      );
      return reply.type('text/html').send(html);
    }
    reply.send({ ...row, messages: msgs.slice(-20) });
  });

  app.get('/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as any;
    const after = (req.query as any).after as string | undefined;
    const db = getDb();
    const sql = after
      ? 'select * from messages where session_id = ? and id > ? order by created_at asc limit 200'
      : 'select * from messages where session_id = ? order by created_at asc limit 200';
    const rows = after ? db.prepare(sql).all(id, after) : db.prepare(sql).all(id);
    reply.send(rows);
  });

  app.post('/sessions/:id/messages', {
    schema: { body: z.object({ content: z.string().min(1) }) }
  }, async (req, reply) => {
    const { id } = req.params as any;
    const { content } = req.body as any;
    const db = getDb();
    const s = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.lifecycle !== 'persistent') return reply.code(400).send({ error: 'messages only valid for persistent sessions' });
    if (!acquireLock(id)) return reply.code(409).send({ error: 'turn in flight' });
    try {
      // TODO: wire codex proto protocol. For now, return 501 to make behavior explicit.
      return reply.code(501).send({ error: 'persistent messaging via codex proto not implemented yet' });
    } finally {
      releaseLock(id);
    }
  });

  app.get('/sessions/:id/log', async (req, reply) => {
    const { id } = req.params as any;
    const tail = Number((req.query as any).tail || 200);
    const db = getDb();
    const s = db.prepare('select log_path from sessions where id = ?').get(id) as { log_path: string } | undefined;
    if (!s) return reply.code(404).send('');
    try {
      const text = await tailFile(s.log_path, tail);
      reply.type('text/plain').send(text);
    } catch {
      reply.type('text/plain').send('');
    }
  });

  app.post('/sessions/:id/cancel', async (req, reply) => {
    const { id } = req.params as any;
    const p = procs.get(id);
    const db = getDb();
    if (p) {
      try { p.kill('SIGTERM', { forceKillAfterTimeout: 2000 }); } catch {}
      procs.delete(id);
      db.prepare('update sessions set status = ?, closed_at = ? where id = ?').run('canceled', Date.now(), id);
    }
    reply.redirect(`/sessions/${id}`);
  });

  await app.listen({ host: DEFAULT_BIND, port: DEFAULT_PORT });
  return app;
}

async function tailFile(filePath: string, n: number): Promise<string> {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const lines = data.split(/\r?\n/);
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

