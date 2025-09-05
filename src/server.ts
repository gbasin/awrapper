import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { layout, escapeHtml } from './ui.js';
import os from 'node:os';
import path from 'node:path';
import { getDb, type Session, type Message } from './db.js';
import { ensureWorktree, isGitRepo } from './git.js';
import { acquireLock, procs, protoSessions, releaseLock } from './state.js';
import { spawnOneshotCodex, spawnPersistentCodex } from './sessionProc.js';
import { DEFAULT_BIND, DEFAULT_PORT, BROWSE_ROOTS } from './config.js';
import fs from 'fs-extra';
import { CodexProtoSession } from './proto.js';

export async function buildServer(opts?: { listen?: boolean }) {
  const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } }).withTypeProvider<ZodTypeProvider>();
  // Enable parsing of application/x-www-form-urlencoded for HTML forms
  await app.register(formbody);

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
    // Build a datalist of recent repo paths for quick selection
    const seen = new Set<string>();
    const recentRepos = sessions
      .map((s) => s.repo_path as string)
      .filter((p) => {
        if (!p || seen.has(p)) return false;
        seen.add(p);
        return true;
      })
      .slice(0, 10);

    const page = layout(
      'awrapper',
      `
      <h1>Sessions</h1>
      <form method="post" action="/sessions" style="margin-bottom: 16px">
        <div class="row">
          <input id="repo_path" name="repo_path" list="recent-repos" placeholder="/path/to/repo" size="40" required />
          <datalist id="recent-repos">
            ${recentRepos.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('')}
          </datalist>
          <button type="button" id="browseBtn">Browse…</button>
          <input name="branch" placeholder="branch (optional)" />
          <select name="lifecycle">
            <option value="persistent" selected>persistent (default)</option>
            <option value="oneshot">oneshot</option>
          </select>
        </div>
        <div id="browser" class="mono" style="display:none; border: 1px solid #eee; padding: 8px; margin-top: 8px; border-radius: 6px; max-height: 320px; overflow: auto;"></div>
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
      <script>
        // Persist the last used repo path locally for convenience
        (function() {
          try {
            var input = document.getElementById('repo_path');
            if (!input) return;
            var KEY = 'awrapper:lastRepoPath';
            var saved = localStorage.getItem(KEY);
            if (saved && !input.value) input.value = saved;
            input.addEventListener('change', function() { localStorage.setItem(KEY, input.value); });
            var form = input.closest('form');
            if (form) form.addEventListener('submit', function() { localStorage.setItem(KEY, input.value); });
          } catch (_) {}
        })();

        // Simple server-driven directory browser
        (function() {
          var btn = document.getElementById('browseBtn');
          var box = document.getElementById('browser');
          var input = document.getElementById('repo_path');
          if (!btn || !box || !input) return;
          var currentPath = null;

          function escapeHtml(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
          }

          function renderRoots(data) {
            var html = '<div style="display:flex; justify-content: space-between; align-items: center">'
              + '<b>Select a directory</b>'
              + '<button type="button" id="closeBrowser">Close</button>'
              + '</div>';
            html += '<div style="margin-top:6px">Roots:</div><ul>';
            for (var i=0;i<data.roots.length;i++) {
              var r = data.roots[i];
              html += '<li><a href="#" data-path="' + encodeURIComponent(r.path) + '" class="nav">' + escapeHtml(r.label || r.path) + '</a></li>';
            }
            html += '</ul>';
            box.innerHTML = html;
            wireEvents();
          }

          function renderListing(data) {
            var html = '<div style="display:flex; justify-content: space-between; align-items: center">'
              + '<div>Path: <span class="muted">' + escapeHtml(data.path) + '</span></div>'
              + '<div>'
              + '<button type="button" id="selectHere">Use this directory</button> '
              + '<button type="button" id="closeBrowser">Close</button>'
              + '</div>'
              + '</div>';
            html += '<div style="margin-top:6px">';
            if (data.parent) {
              html += '<a href="#" data-path="' + encodeURIComponent(data.parent) + '" class="nav">↑ Up</a>';
            } else {
              html += '<a href="#" class="nav-roots">Roots</a>';
            }
            html += '</div>';
            html += '<ul style="margin-top:6px">';
            for (var i=0;i<data.entries.length;i++) {
              var e = data.entries[i];
              var label = e.name + (e.is_repo ? ' • git' : '');
              html += '<li><a href="#" data-path="' + encodeURIComponent(e.path) + '" class="nav">' + escapeHtml(label) + '</a>'
                + ' <button type="button" class="sel" data-path="' + encodeURIComponent(e.path) + '">Select</button>'
                + '</li>';
            }
            html += '</ul>';
            box.innerHTML = html;
            wireEvents();
            var selHere = document.getElementById('selectHere');
            if (selHere) selHere.addEventListener('click', function() { input.value = data.path; box.style.display='none'; });
          }

          async function load(path) {
            var url = '/browse' + (path ? ('?path=' + encodeURIComponent(path)) : '');
            var res = await fetch(url);
            var data = await res.json();
            if (data.roots) renderRoots(data); else renderListing(data);
          }

          function wireEvents() {
            var close = document.getElementById('closeBrowser');
            if (close) close.addEventListener('click', function(){ box.style.display='none'; });
            var navs = box.querySelectorAll('a.nav');
            for (var i=0;i<navs.length;i++) {
              navs[i].addEventListener('click', function(ev){ ev.preventDefault(); var p = this.getAttribute('data-path'); if(p) load(decodeURIComponent(p)); });
            }
            var roots = box.querySelectorAll('a.nav-roots');
            for (var i=0;i<roots.length;i++) {
              roots[i].addEventListener('click', function(ev){ ev.preventDefault(); load(null); });
            }
            var sels = box.querySelectorAll('button.sel');
            for (var i=0;i<sels.length;i++) {
              sels[i].addEventListener('click', function(){ var p = this.getAttribute('data-path'); if (p) { input.value = decodeURIComponent(p); box.style.display='none'; } });
            }
          }

          btn.addEventListener('click', function(){ box.style.display = (box.style.display === 'none' ? 'block' : 'none'); if (box.style.display === 'block') load(null); });
        })();
      </script>
      `
    );
    reply.type('text/html').send(page);
  });

  // Directory browsing API for server-side picker
  app.get('/browse', async (req, reply) => {
    const q = (req.query as any) || {};
    const reqPath = expandPath(q.path as string | undefined);

    function isUnderRoot(p: string) {
      const rp = path.resolve(p);
      return BROWSE_ROOTS.some((root) => {
        const rel = path.relative(root, rp);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      });
    }

    function parentDir(p: string) {
      const d = path.dirname(p);
      if (d === p) return undefined;
      if (isUnderRoot(d)) return d;
      return undefined;
    }

    if (!reqPath) {
      // Return allowed roots
      return reply.send({ roots: BROWSE_ROOTS.map((p) => ({ path: p, label: p === os.homedir() ? 'Home' : p })) });
    }

    // Guard: only allow paths within allowed roots
    if (!isUnderRoot(reqPath)) {
      return reply.code(400).send({ error: 'Path not allowed' });
    }

    let entries: any[] = [];
    try {
      const dirents = await fs.readdir(reqPath, { withFileTypes: true });
      const dirs = dirents.filter((d) => d.isDirectory());
      entries = await Promise.all(
        dirs.map(async (d) => {
          const p = path.join(reqPath, d.name);
          let isRepo = false;
          try {
            // Lightweight check: presence of .git dir or file
            const gitPath = path.join(p, '.git');
            isRepo = await fs.pathExists(gitPath);
          } catch {}
          return { name: d.name, path: p, is_dir: true, is_repo: isRepo };
        })
      );
    } catch (err: any) {
      return reply.code(400).send({ error: String(err?.message || err) });
    }

    reply.send({ path: path.resolve(reqPath), parent: parentDir(reqPath), entries });
  });

  app.post('/sessions', async (req, reply) => {
    const body = (req.body as any) || {};
    const agent_id = body.agent_id || 'codex';
    const repo_path = expandPath(body.repo_path as string);
    const branch = body.branch as string | undefined;
    const lifecycle: 'oneshot' | 'persistent' = body.lifecycle || 'persistent';
    const initial_message = body.initial_message as string | undefined;
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
      proc!.once('exit', async (code: number | null) => {
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
      // Attach proto session handler
      const proto = new CodexProtoSession(proc!);
      protoSessions.set(id, proto);
      try { await proto.configureSession(worktree_path); } catch {}
      proc!.once('exit', (code: number | null) => {
        const db3 = getDb();
        db3.prepare('update sessions set status = ?, exit_code = ?, closed_at = ?, pid = NULL where id = ?')
          .run('closed', code ?? null, Date.now(), id);
        procs.delete(id);
        protoSessions.delete(id);
      });
    }

    const ctype = String(req.headers['content-type'] || '');
    if (ctype.includes('application/x-www-form-urlencoded')) {
      return reply.redirect(303, `/sessions/${id}`);
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

  app.post('/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as any;
    const { content } = req.body as any;
    const db = getDb();
    const s = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.lifecycle !== 'persistent') return reply.code(400).send({ error: 'messages only valid for persistent sessions' });
    if (!acquireLock(id)) return reply.code(409).send({ error: 'turn in flight' });
    try {
      const proto = protoSessions.get(id);
      if (!proto) return reply.code(503).send({ error: 'session process not available' });
      // Persist user message
      const turnId = crypto.randomUUID();
      const now = Date.now();
      const userMsgId = crypto.randomUUID();
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(userMsgId, id, turnId, 'user', content, now);
      db.prepare('update sessions set last_activity_at = ? where id = ?').run(now, id);

      const runId = proto.sendUserInput(content, turnId);
      let assistantContent = '';
      try {
        assistantContent = await proto.awaitTaskComplete(runId, 120_000);
      } catch (err: any) {
        assistantContent = `Error: ${String(err?.message || err)}`;
      }
      const asstMsgId = crypto.randomUUID();
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
      return reply.send({ turn_id: turnId, user_message_id: userMsgId, assistant_message_id: asstMsgId });
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
      try { p.kill('SIGTERM'); } catch {}
      procs.delete(id);
      db.prepare('update sessions set status = ?, closed_at = ? where id = ?').run('canceled', Date.now(), id);
    }
    reply.redirect(`/sessions/${id}`);
  });

  if (opts?.listen !== false) {
    await app.listen({ host: DEFAULT_BIND, port: DEFAULT_PORT });
  }
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

function expandPath(p: string | undefined): string {
  if (!p) return '';
  if (p.startsWith('~/') || p === '~') {
    const suffix = p.slice(1); // remove leading '~'
    return path.join(os.homedir(), suffix);
  }
  return p;
}
