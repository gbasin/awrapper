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
import { spawnPersistentCodex } from './sessionProc.js';
import { DEFAULT_BIND, DEFAULT_PORT, BROWSE_ROOTS, DEBUG, HTTP_LOG, PROTO_TRY_CONFIGURE, LOG_LEVEL, TURN_TIMEOUT_SECS } from './config.js';
import fs from 'fs-extra';
import { CodexProtoSession } from './proto.js';
import { ensureAgentsRegistry } from './agents.js';

export async function buildServer(opts?: { listen?: boolean }) {
  const app = Fastify({
    logger: { transport: { target: 'pino-pretty' }, level: LOG_LEVEL },
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
        // Help avoid stale SPA shells by preventing index.html from being cached
        setHeaders: (res: any, filePath: string) => {
          try {
            if (filePath && filePath.endsWith(path.sep + 'index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          } catch {}
        },
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

  // Legacy HTML index at /__legacy removed

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
    const initial_message = body.initial_message as string | undefined;
    app.log.info({ agent_id, repo_path, branch, has_initial: !!(initial_message && String(initial_message).trim()) }, 'Create session request');
    if (agent_id !== 'codex') return reply.code(400).send({ error: 'Unsupported agent' });
    if (!(await isGitRepo(repo_path))) return reply.code(400).send({ error: 'repo_path is not a Git repo' });
    const db = getDb();
    const id = crypto.randomUUID();
    const worktree_path = await ensureWorktree(repo_path, branch, id);

    const { logPath, artifactDir } = await (await import('./sessionProc.js')).setupPaths(id);
    const now = Date.now();
    db.prepare(
      `insert into sessions (id, agent_id, repo_path, branch, worktree_path, status, started_at, log_path, agent_log_hint, artifact_dir)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, agent_id, repo_path, branch || null, worktree_path, 'queued', now, logPath, '~/.codex/log/codex-tui.log', artifactDir);

    try {
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
            // Insert a placeholder assistant message immediately and stream updates
            const asstMsgId = crypto.randomUUID();
            db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
              .run(asstMsgId, id, turnId, 'assistant', '', Date.now());

            // Stream assistant deltas into the placeholder row
            let assistantContent = '';
            // Throttled DB update for streaming deltas
            let flushTimer: NodeJS.Timeout | null = null;
            const flushMs = 200; // max ~5 updates/sec
            const flushSoon = () => {
              if (flushTimer) return;
              flushTimer = setTimeout(() => {
                try { db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId); } catch {}
                flushTimer = null;
              }, flushMs);
            };

            const off = proto.onEvent((ev) => {
              try {
                if (ev.id !== runId) return;
                const t = ev.msg?.type;
                if (t === 'agent_message_delta') {
                  assistantContent += String(ev.msg?.delta || '');
                  flushSoon();
                } else if (t === 'agent_message') {
                  assistantContent = String(ev.msg?.message || '');
                  try { db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId); } catch {}
                }
              } catch (_) { /* best-effort streaming */ }
            });
            try {
              assistantContent = await proto.awaitTaskComplete(runId, TURN_TIMEOUT_SECS * 1000);
            } catch (err: any) {
              assistantContent = `Error: ${String(err?.message || err)}`;
            }
            try { off(); } catch {}
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            // Finalize assistant content
            db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId);
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
    } catch (err: any) {
      const msg = String(err?.shortMessage || err?.message || err || 'Failed to start agent');
      const hint = err?.code === 'ENOENT'
        ? 'codex binary not found. Install Codex CLI or set CODEX_BIN.'
        : (!process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY may be missing for the Codex process.' : undefined);
      const full = hint ? `${msg} (${hint})` : msg;
      db.prepare('update sessions set status = ?, error_message = ? where id = ?').run('error', full, id);
      (req as any).log.error({ err: msg, id }, 'Failed to spawn persistent Codex agent');
      const ctype2 = String(req.headers['content-type'] || '');
      if (ctype2.includes('application/x-www-form-urlencoded')) {
        return reply.redirect(`/sessions/${id}`, 303);
      }
      return reply.code(500).send({ error: 'Failed to start agent process', message: full, id });
    }

    const ctype = String(req.headers['content-type'] || '');
    if (ctype.includes('application/x-www-form-urlencoded')) {
      return reply.redirect(`/sessions/${id}`, 303);
    }
    reply.send({ id, worktree_path });
  });

  app.get('/sessions', async (_req, reply) => {
    const db = getDb();
    const rows = db.prepare('select * from sessions order by started_at desc limit 100').all() as any[];
    const withDerived = rows.map((r) => ({ ...r, status: computeDisplayStatus(r) }));
    reply.send(withDerived);
  });

  app.get('/sessions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const db = getDb();
    const row = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    (row as any).status = computeDisplayStatus(row as any);
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
        <p>agent: <b>${row.agent_id}</b> • status: <b>${row.status}</b></p>
        <p class="muted">repo: ${escapeHtml(row.repo_path)}${row.branch ? ' @ ' + escapeHtml(row.branch) : ''}</p>
        <div class="row">
          <form id="msgform">
            <textarea id="msg" placeholder="Type message"></textarea>
            <div><button type="submit">Send</button></div>
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
          const msg = String(e?.shortMessage || e?.message || e || 'Failed to revive agent');
          const hint = e?.code === 'ENOENT'
            ? 'codex binary not found. Install Codex CLI or set CODEX_BIN.'
            : (!process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY may be missing for the Codex process.' : undefined);
          const full = hint ? `${msg} (${hint})` : msg;
          db.prepare('update sessions set status = ?, error_message = ? where id = ?').run('error', full, id);
          (req as any).log.warn({ id, err: msg }, 'Failed to revive session process');
          return reply.code(503).send({ error: 'Failed to revive agent process', message: full });
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
      // Insert a placeholder assistant message immediately and stream updates
      const asstMsgId = crypto.randomUUID();
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(asstMsgId, id, turnId, 'assistant', '', Date.now());
      let assistantContent = '';
      // Throttled DB update for streaming deltas
      let flushTimer: NodeJS.Timeout | null = null;
      const flushMs = 200; // max ~5 updates/sec
      const flushSoon = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          try { db.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId); } catch {}
          flushTimer = null;
        }, flushMs);
      };

      const off = proto.onEvent((ev) => {
        try {
          if (ev.id !== runId) return;
          const t = ev.msg?.type;
          if (t === 'agent_message_delta') {
            assistantContent += String(ev.msg?.delta || '');
            flushSoon();
          } else if (t === 'agent_message') {
            assistantContent = String(ev.msg?.message || '');
            try { db.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId); } catch {}
          }
        } catch (_) { /* best-effort streaming */ }
      });
      try {
        assistantContent = await proto.awaitTaskComplete(runId, TURN_TIMEOUT_SECS * 1000);
      } catch (err: any) {
        assistantContent = `Error: ${String(err?.message || err)}`;
      }
      try { off(); } catch {}
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      // Finalize assistant content
      db.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId);
      if (DEBUG) (req as any).log.info({ id, turnId, userMsgId, asstMsgId, alen: assistantContent.length }, 'Assistant message persisted');
      return reply.send({ turn_id: turnId, user_message_id: userMsgId, assistant_message_id: asstMsgId });
    } finally {
      releaseLock(id);
    }
  });

  app.get('/sessions/:id/log', async (req, reply) => {
    const { id } = req.params as any;
    const tailParam = String((req.query as any).tail || '200');
    const db = getDb();
    const s = db.prepare('select log_path from sessions where id = ?').get(id) as { log_path: string } | undefined;
    if (!s) return reply.code(404).send('');
    try {
      let text = '';
      if (tailParam === 'all') {
        text = await readWholeFile(s.log_path);
      } else {
        const tail = Number(tailParam || 200);
        text = await tailFile(s.log_path, Number.isFinite(tail) && tail > 0 ? tail : 200);
      }
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

  // SPA fallback for client-side routes (exclude API endpoints)
  // Use notFound handler that serves web/dist/index.html when present.
  app.setNotFoundHandler(async (req, reply) => {
    try {
      const rawUrl = String((req as any).raw?.url || '');
      const method = String((req as any).raw?.method || 'GET');
      if (method !== 'GET') return reply.code(404).send({ error: 'Not found' });
      if (rawUrl.startsWith('/sessions') || rawUrl.startsWith('/browse') || rawUrl.startsWith('/client-log')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const webDist = path.resolve(process.cwd(), 'web/dist');
      const indexPath = path.join(webDist, 'index.html');
      if (await fs.pathExists(indexPath)) {
        const html = await fs.readFile(indexPath, 'utf8');
        return reply.type('text/html').send(html);
      }
      return reply.code(404).send({ error: 'Not found' });
    } catch {
      return reply.code(404).send({ error: 'Not found' });
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

async function readWholeFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
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

// Determine if a PID is currently alive on this system.
function isPidAlive(pid?: number | null): boolean {
  if (!pid || typeof pid !== 'number') return false;
  try {
    // Signal 0 performs error checking without actually sending a signal
    process.kill(pid, 0 as any);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but we lack permission to signal it
    return !!(err && err.code === 'EPERM');
  }
}

  // Compute a user-facing status. If a session says 'running' but the
  // PID is not alive (e.g., server restarted or process exited), mark it 'stale'.
  function computeDisplayStatus(row: { status: string; pid?: number | null }): string {
    const s = String(row?.status || '');
    if (s === 'running') {
      return isPidAlive(row.pid) ? 'running' : 'stale';
    }
    if (s === 'starting') {
      // If there's no living PID for a long-starting session, surface as stale
      return isPidAlive(row.pid) ? 'starting' : 'stale';
    }
    return s;
  }
