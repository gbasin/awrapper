import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
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
import { DEFAULT_BIND, DEFAULT_PORT, BROWSE_ROOTS, DEBUG, HTTP_LOG, PROTO_TRY_CONFIGURE } from './config.js';
import fs from 'fs-extra';
import { CodexProtoSession } from './proto.js';
import { ensureAgentsRegistry } from './agents.js';

export async function buildServer(opts?: { listen?: boolean }) {
  const app = Fastify({
    logger: { transport: { target: 'pino-pretty' }, level: DEBUG ? 'info' : 'warn' },
    disableRequestLogging: !HTTP_LOG
  }).withTypeProvider<ZodTypeProvider>();
  // Enable parsing of application/x-www-form-urlencoded for HTML forms
  await app.register(formbody);

  // Serve built SPA if available
  try {
    const webDist = path.resolve(process.cwd(), 'web/dist');
    if (await fs.pathExists(webDist)) {
      await app.register(fastifyStatic as any, {
        root: webDist,
        prefix: '/',
        index: ['index.html'],
        decorateReply: false,
      } as any);
      app.log.info({ webDist }, 'Static SPA enabled');
    } else {
      app.log.info({ webDist }, 'Static SPA not found; skipping');
    }
  } catch (e: any) {
    app.log.warn({ err: String(e?.message || e) }, 'Failed to enable static SPA');
  }

  // Ensure DB and default agents are initialized when server is built directly (e.g., in tests)
  try {
    getDb();
    ensureAgentsRegistry();
  } catch (_) {
    // Best-effort; routes will still work without crashing if init fails
  }

  // Minimal placeholder favicon to avoid 404 noise
  app.get('/favicon.ico', async (_req, reply) => {
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
      'base64'
    );
    reply.header('Cache-Control', 'public, max-age=86400').type('image/png').send(png1x1);
  });

  // SSR homepage has been replaced by SPA at '/'; keep legacy HTML available under '/__legacy' temporarily
  app.get('/__legacy', async (_req, reply) => {
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
          var currentData = null; // last payload from /browse
          var onlyGit = (function(){ try { return localStorage.getItem('awrapper:browseOnlyGit') !== '0'; } catch(_) { return true; } })();

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
            currentPath = data.path || null;
            currentData = data;
            var html = '<div style="display:flex; justify-content: space-between; align-items: center">'
              + '<div>Path: <span class="muted">' + escapeHtml(data.path) + '</span></div>'
              + '<div>'
              + '<label style="margin-right:8px; font-weight:normal"><input type="checkbox" id="onlyGitToggle" ' + (onlyGit ? 'checked' : '') + '> Only Git repos</label>'
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
            var entries = data.entries || [];
            if (onlyGit) entries = entries.filter(function(e){ return !!e.is_repo; });
            html += '<ul style="margin-top:6px">';
            for (var i=0;i<entries.length;i++) {
              var e = entries[i];
              var label = e.name + (e.is_repo ? ' • git' : '');
              html += '<li><a href="#" data-path="' + encodeURIComponent(e.path) + '" class="nav">' + escapeHtml(label) + '</a>'
                + ' <button type="button" class="sel" data-path="' + encodeURIComponent(e.path) + '">Select</button>'
                + '</li>';
            }
            html += '</ul>';
            if (entries.length === 0) {
              html += '<div class="muted">No git repos here.</div>';
            }
            box.innerHTML = html;
            wireEvents();
            var selHere = document.getElementById('selectHere');
            if (selHere) selHere.addEventListener('click', function() { input.value = data.path; box.style.display='none'; });
            var tog = document.getElementById('onlyGitToggle');
            if (tog) tog.addEventListener('change', function(){ onlyGit = this.checked; try { localStorage.setItem('awrapper:browseOnlyGit', onlyGit ? '1' : '0'); } catch(_){}; renderListing(currentData); });
          }

          async function load(path) {
            var url = '/browse' + (path ? ('?path=' + encodeURIComponent(path)) : '');
            var res = await fetch(url);
            var data = await res.json();
            if (data.roots) { currentData = data; renderRoots(data); } else { renderListing(data); }
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
    app.log.info({ agent_id, lifecycle, repo_path, branch, has_initial: !!(initial_message && String(initial_message).trim()) }, 'Create session request');
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
      if (PROTO_TRY_CONFIGURE) {
        try { await proto.configureSession(worktree_path); } catch {}
      }
      // If an initial message was provided for a persistent session,
      // send it asynchronously and persist both sides of the turn.
      if (initial_message && String(initial_message).trim()) {
        const text = String(initial_message).trim();
        (async () => {
          // Acquire a turn lock to avoid racing with immediate user input
          const got = acquireLock(id);
          try {
            const db4 = getDb();
            const turnId = crypto.randomUUID();
            const now = Date.now();
            const userMsgId = crypto.randomUUID();
            if (DEBUG) app.log.info({ id, turnId }, 'Bootstrap turn: sending initial user message');
            db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
              .run(userMsgId, id, turnId, 'user', text, now);
            db4.prepare('update sessions set last_activity_at = ? where id = ?').run(now, id);

            const runId = proto.sendUserInput(text, turnId);
            let assistantContent = '';
            try {
              assistantContent = await proto.awaitTaskComplete(runId, 120_000);
            } catch (err: any) {
              assistantContent = `Error: ${String(err?.message || err)}`;
            }
            const asstMsgId = crypto.randomUUID();
            db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
              .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
            if (DEBUG) app.log.info({ id, turnId, userMsgId, asstMsgId, alen: assistantContent.length }, 'Bootstrap turn: assistant response persisted');
          } catch (_) {
            // swallow; best-effort bootstrap message
          } finally {
            if (got) releaseLock(id);
          }
        })().catch(() => {});
      }
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
      return reply.redirect(`/sessions/${id}`, 303);
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
      const q = req.query as any;
      const debug = DEBUG || q.debug === '1' || q.debug === 'true';
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
        <h3>Agent Trace</h3>
        <div id="trace" class="mono" style="border:1px solid #eee; padding:8px; border-radius:6px"></div>
        <h3>Log</h3>
        <div id="log" class="log mono"></div>
        <script>
          (function(){
            var id = ${JSON.stringify(id)};
            var DEBUG = ${JSON.stringify(!!debug)};
            function dbg(){ if(!DEBUG) return; try{ console.log.apply(console, arguments); }catch(_){}}
            function assign(t, s){ if(!s) return t; for (var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }
          function dbgPost(evt, extra){ if(!DEBUG) return; try{ var payload = assign({ evt: evt, id: id, t: Date.now() }, extra || {}); navigator.sendBeacon('/client-log', JSON.stringify(payload)); } catch(_){} }
          function escapeHtml(s){ return String(s==null? '': s).replace(/[&<>"]/g, function(ch){ return ch==='&'?'&amp;': ch==='<'?'&lt;': ch==='>'?'&gt;': '&quot;'; }); }
          function parseProtoEvents(text){
            var events = [];
            if (!text) return events;
            var lines = text.split(/\r?\n/);
            for (var i=0;i<lines.length;i++){
              var line = lines[i].trim();
              if (!line) continue;
              // Fast path: JSON lines usually start with '{'
              if (line[0] !== '{') continue;
              try {
                var obj = JSON.parse(line);
                if (obj && typeof obj === 'object' && obj.msg && typeof obj.msg.type === 'string') {
                  events.push({ id: obj.id || '', type: obj.msg.type, msg: obj.msg, raw: obj });
                }
              } catch(_) { /* ignore non-JSON */ }
            }
            return events;
          }
          function summarizeEvents(events){
            // Group by run id (last task_started is considered active)
            var lastRunId = null;
            for (var i=events.length-1;i>=0;i--){ if (events[i].type === 'task_started') { lastRunId = events[i].id; break; } }
            // Fallback: use last event id if no task_started present
            if (!lastRunId && events.length) lastRunId = events[events.length-1].id;
            var active = lastRunId ? events.filter(function(e){ return e.id === lastRunId; }) : [];
            var reasoning = [];
            var message = '';
            var tokens = null;
            var others = [];
            for (var i=0;i<active.length;i++){
              var e = active[i];
              if (e.type === 'agent_reasoning_delta') {
                reasoning.push(String(e.msg.delta || ''));
              } else if (e.type === 'agent_reasoning') {
                // Full text snapshot; prefer it over accumulated deltas
                reasoning = [String(e.msg.text || '')];
              } else if (e.type === 'agent_message_delta') {
                message += String(e.msg.delta || '');
              } else if (e.type === 'agent_message') {
                message = String(e.msg.message || '');
              } else if (e.type === 'token_count') {
                tokens = { input: e.msg.input_tokens, output: e.msg.output_tokens, total: e.msg.total_tokens };
              } else {
                others.push(e);
              }
            }
            return { runId: lastRunId || '', events: active, reasoning: reasoning.join(''), message: message, tokens: tokens, others: others };
          }
          function renderTrace(section, info){
            if (!section) return;
            if (!info || !info.runId) { section.innerHTML = '<div class="muted">No recent agent events.</div>'; return; }
            var parts = [];
            var title = 'Agent trace for run ' + escapeHtml(info.runId) + ' (' + info.events.length + ' events)';
            parts.push('<details><summary>' + title + '</summary>');
            if (info.tokens) {
              parts.push('<div>Tokens: input ' + escapeHtml(info.tokens.input) + ', output ' + escapeHtml(info.tokens.output) + ', total ' + escapeHtml(info.tokens.total) + '</div>');
            }
            if (info.reasoning && info.reasoning.trim()) {
              var r = info.reasoning;
              var preview = r.length > 220 ? r.slice(0,220) + '…' : r;
              parts.push('<details style="margin-top:6px"><summary>Reasoning (' + r.length + ' chars)</summary><pre style="white-space:pre-wrap">' + escapeHtml(r) + '</pre></details>');
            }
            if (info.message && info.message.trim()) {
              var m = info.message;
              parts.push('<details style="margin-top:6px"><summary>Assistant Message (' + m.length + ' chars)</summary><pre style="white-space:pre-wrap">' + escapeHtml(m) + '</pre></details>');
            }
            if (info.others && info.others.length){
              parts.push('<details style="margin-top:6px"><summary>Other Events (' + info.others.length + ')</summary>');
              for (var i=0;i<info.others.length;i++){
                var e = info.others[i];
                var label = '[' + escapeHtml(e.type) + ']';
                // Include short payload preview for common fields
                var extra = '';
                if (typeof e.msg.message === 'string') extra = ' ' + escapeHtml((e.msg.message || '').slice(0,200));
                if (e.msg && (e.msg.tool || e.msg.tool_name)) extra += ' tool=' + escapeHtml(e.msg.tool || e.msg.tool_name);
                if (Array.isArray(e.msg.command)) extra += ' command=' + escapeHtml(e.msg.command.join(' ')).slice(0,200);
                parts.push('<div>' + label + extra + '</div>');
              }
              parts.push('</details>');
            }
            if (info.events && info.events.length){
              // Raw JSON for power users
              var raw = info.events.map(function(e){ try { return JSON.stringify(e.raw); } catch(_) { return ''; } }).filter(Boolean).join('\n');
              parts.push('<details style="margin-top:6px"><summary>Raw Events JSON (' + info.events.length + ')</summary><pre style="white-space:pre-wrap">' + escapeHtml(raw) + '</pre></details>');
            }
            parts.push('</details>');
            section.innerHTML = parts.join('');
          }
          function poll(){
            dbg('poll: start');
            return fetch('/sessions/' + id, { headers: { 'Accept': 'application/json' } })
              .then(function(res){ return res.json(); })
              .then(function(data){ dbg('poll: session ok', data && data.id); return fetch('/sessions/' + id + '/messages?after=', { headers: { 'Accept': 'application/json' } }); })
              .then(function(res){ return res.json(); })
              .then(function(msgs){ dbg('poll: msgs', Array.isArray(msgs) ? msgs.length : typeof msgs); var out=''; for(var i=0;i<msgs.length;i++){ var m=msgs[i]; if(i) out+=String.fromCharCode(10); out += '['+new Date(m.created_at).toLocaleTimeString()+'] ' + m.role + ': ' + m.content; } document.getElementById('msgs').textContent = out; return fetch('/sessions/' + id + '/log?tail=800'); })
              .then(function(res){ return res.text(); })
              .then(function(logText){ dbg('poll: log bytes', logText.length); document.getElementById('log').textContent = logText; try { var evs = parseProtoEvents(logText); var info = summarizeEvents(evs); renderTrace(document.getElementById('trace'), info); } catch(e) { dbg('trace parse error', e && e.message); } dbg('poll: done'); })
              .catch(function(e){ dbg('poll error', e && e.message); dbgPost('poll-error', { message: String(e && e.message) }); });
          }
          setInterval(function(){ poll().catch(() => {}); }, 1000);
          poll().catch(() => {});

            var form = document.getElementById('msgform');
            if (form) form.addEventListener('submit', function(e){
              e.preventDefault();
              var content = document.getElementById('msg').value;
              if (!content || !content.trim()) return;
              dbg('submit: sending'); dbgPost('submit');
              fetch('/sessions/' + id + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ content: content }) })
                .then(function(){ document.getElementById('msg').value=''; dbg('submit: sent'); })
                .catch(function(e){ dbg('submit error', e && e.message); dbgPost('submit-error', { message: String(e && e.message) }); });
            });
            window.addEventListener('error', function(ev){ dbg('window error', ev && ev.message); dbgPost('window-error', { message: String(ev && ev.message) }); });
          })();
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
      let proto = protoSessions.get(id);
      let revivedNow = false;
      // If the in-memory proto session is missing (e.g., server restart), try to revive it lazily
      if (!proto) {
        try {
          (req as any).log.info({ id }, 'Reviving persistent agent process for session');
          // Mark as starting then spawn a fresh persistent Codex process
          db.prepare('update sessions set status = ? where id = ?').run('starting', id);
          const { proc } = await spawnPersistentCodex({ worktree: s.worktree_path });
          db.prepare('update sessions set status = ?, pid = ? where id = ?').run('running', proc!.pid, id);
          procs.set(id, proc!);
          const revived = new CodexProtoSession(proc!);
          protoSessions.set(id, revived);
          if (PROTO_TRY_CONFIGURE) {
            try { await revived.configureSession(s.worktree_path); } catch {}
          }
          // Re-attach exit handler to keep DB and in-memory maps consistent
          proc!.once('exit', (code: number | null) => {
            const db3 = getDb();
            db3.prepare('update sessions set status = ?, exit_code = ?, closed_at = ?, pid = NULL where id = ?')
              .run('closed', code ?? null, Date.now(), id);
            procs.delete(id);
            protoSessions.delete(id);
          });
          proto = revived;
          revivedNow = true;
        } catch (e: any) {
          (req as any).log.warn({ id, err: String(e?.message || e) }, 'Failed to revive session process');
          return reply.code(503).send({ error: 'session process not available' });
        }
      }
      // Persist user message
      const turnId = crypto.randomUUID();
      const now = Date.now();
      const userMsgId = crypto.randomUUID();
      if (DEBUG) {
        const preview = typeof content === 'string' ? content.slice(0, 120) : String(content).slice(0, 120);
        (req as any).log.info({ id, turnId, preview, len: (content || '').length }, 'Incoming user message');
      }
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(userMsgId, id, turnId, 'user', content, now);
      db.prepare('update sessions set last_activity_at = ? where id = ?').run(now, id);

      // Build content to send to the agent (hydrate with prior transcript if we just revived)
      let contentToSend = content;
      if (revivedNow) {
        const rows = db
          .prepare('select role, content from messages where session_id = ? order by created_at asc')
          .all(id) as Array<{ role: string; content: string }>;
        const lines = rows.map((r) => `${r.role[0].toUpperCase()}${r.role.slice(1)}: ${r.content}`);
        const transcript = lines.join('\n');
        const preface = [
          'Context: Resumed persistent session. Full prior transcript follows (most recent last):',
          '',
          transcript,
          '',
          '— End transcript —',
          '',
          // Append the fresh user request clearly demarcated
          `User: ${content}`
        ].join('\n');
        contentToSend = preface;
        if (DEBUG) (req as any).log.info({ id, messages: rows.length, clen: preface.length }, 'Hydrated turn after revive');
      }

      const runId = proto.sendUserInput(contentToSend, turnId);
      let assistantContent = '';
      try {
        assistantContent = await proto.awaitTaskComplete(runId, 120_000);
      } catch (err: any) {
        assistantContent = `Error: ${String(err?.message || err)}`;
      }
      const asstMsgId = crypto.randomUUID();
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
      if (DEBUG) (req as any).log.info({ id, turnId, userMsgId, asstMsgId, alen: assistantContent.length }, 'Assistant message persisted');
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

  // Client-side debug logging endpoint (enabled always; no data persisted)
  app.post('/client-log', async (req, reply) => {
    try {
      let body: any = (req.body as any);
      if (Buffer.isBuffer(body)) body = body.toString('utf8');
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = { raw: body }; }
      }
      const evt = String(body?.evt || '');
      const record = { client: true, evt, id: body?.id, message: body?.message } as any;
      // Only log noisy poll events if HTTP_LOG is enabled; otherwise keep just errors and submits
      const isPollNoise = evt.startsWith('poll-') && !evt.includes('error');
      if (!isPollNoise) {
        app.log.info(record, 'client-log');
      }
      reply.send({ ok: true });
    } catch {
      reply.send({ ok: false });
    }
  });

  if (opts?.listen !== false) {
    try {
      const url = await app.listen({ host: DEFAULT_BIND, port: DEFAULT_PORT });
      app.log.info({ url }, 'Server listening');
    } catch (err: any) {
      // If default port is busy, fall back to an ephemeral port (0)
      if (err && err.code === 'EADDRINUSE') {
        app.log.warn({ port: DEFAULT_PORT }, 'Port in use; falling back to a random free port');
        const url = await app.listen({ host: DEFAULT_BIND, port: 0 });
        app.log.info({ url }, 'Server listening');
      } else {
        throw err;
      }
    }
  }

  // SPA fallback for client-side routes (exclude API endpoints)
  app.setNotFoundHandler((req, reply) => {
    const url = String((req as any).raw?.url || '')
    const method = String((req as any).raw?.method || 'GET')
    if (method !== 'GET') return reply.code(404).send({ error: 'Not found' })
    if (url.startsWith('/sessions') || url.startsWith('/browse') || url.startsWith('/client-log')) {
      return reply.code(404).send({ error: 'Not found' })
    }
    try {
      // @ts-ignore fastify-static sendFile
      return (reply as any).sendFile('index.html')
    } catch {
      return reply.code(404).send({ error: 'Not found' })
    }
  });
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
