import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import { getDb, type Session, type Message } from './db.js';
import { ensureWorktree, isGitRepo, currentBranch } from './git.js';
import { acquireLock, procs, protoSessions, releaseLock, locks, sessionApprovalWaits } from './state.js';
import { spawnPersistentCodex } from './sessionProc.js';
import { DEFAULT_BIND, DEFAULT_PORT, BROWSE_ROOTS, DEBUG, HTTP_LOG, PROTO_TRY_CONFIGURE, LOG_LEVEL, TURN_TIMEOUT_SECS, DEFAULT_USE_WORKTREE } from './config.js';
import fs from 'fs-extra';
import { CodexProtoSession } from './proto.js';
import { ensureAgentsRegistry } from './agents.js';
import { execa } from 'execa';

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

  // Detect and log which Codex binary/version will be used for sessions
  try {
    const configured = process.env.CODEX_BIN || 'codex';
    let resolved = configured;
    if (!configured.includes(path.sep)) {
      try {
        const which = await execa('bash', ['-lc', `command -v ${configured} || which ${configured} || true`]);
        resolved = (which.stdout || configured).trim() || configured;
      } catch {
        // keep fallback
      }
    }
    let version = '';
    try {
      const v = await execa(configured, ['--version']);
      version = (v.stdout || '').trim();
    } catch (e: any) {
      version = `unavailable (${String(e?.shortMessage || e?.message || e || '')})`;
    }
    app.log.info({ codex_bin: configured, resolved_path: resolved, version }, 'Codex binary detected');
  } catch (e: any) {
    app.log.warn({ err: String(e?.message || e) }, 'Failed to detect Codex binary');
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
  // Also surface minimal runtime config for the SPA
  app.get('/config', async (_req, reply) => {
    reply.send({ default_use_worktree: DEFAULT_USE_WORKTREE });
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
    const use_worktree = typeof body.use_worktree === 'boolean' ? body.use_worktree : DEFAULT_USE_WORKTREE;
    const initial_message = body.initial_message as string | undefined;
    const block_while_running = typeof body.block_while_running === 'boolean' ? !!body.block_while_running : true;
    app.log.info({ agent_id, repo_path, branch, use_worktree, block_while_running, has_initial: !!(initial_message && String(initial_message).trim()) }, 'Create session request');
    if (agent_id !== 'codex') return reply.code(400).send({ error: 'Unsupported agent' });
    // Validate repo path
    try {
      const st = await fs.stat(repo_path);
      if (!st.isDirectory()) return reply.code(400).send({ error: 'repo_path must be a directory' });
    } catch (e: any) {
      return reply.code(400).send({ error: 'repo_path does not exist or is not accessible' });
    }
    const isRepo = await isGitRepo(repo_path);
    if (use_worktree && !isRepo) return reply.code(400).send({ error: 'repo_path is not a Git repo' });
    // Strict branch semantics when not using a worktree
    if (!use_worktree && branch && branch.trim()) {
      if (!isRepo) return reply.code(400).send({ error: 'Branch specified but repo_path is not a Git repo' });
      const cur = await currentBranch(repo_path);
      if (!cur || cur !== branch) {
        return reply.code(400).send({ error: `Branch mismatch: repo is on '${cur ?? 'unknown'}', requested '${branch}'` });
      }
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const worktree_path = use_worktree ? await ensureWorktree(repo_path, branch, id) : repo_path;

    const { logPath, artifactDir } = await (await import('./sessionProc.js')).setupPaths(id);
    const now = Date.now();
    db.prepare(
      `insert into sessions (id, agent_id, repo_path, branch, worktree_path, status, started_at, log_path, agent_log_hint, artifact_dir, block_while_running)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, agent_id, repo_path, branch || null, worktree_path, 'queued', now, logPath, '~/.codex/log/codex-tui.log', artifactDir, block_while_running ? 1 : 0);

    try {
      db.prepare('update sessions set status = ? where id = ?').run('starting', id);
      const { proc } = await spawnPersistentCodex({ worktree: worktree_path });
      db.prepare('update sessions set status = ?, pid = ? where id = ?').run('running', proc!.pid, id);
      procs.set(id, proc!);
      // Attach proto session handler
      const proto = new CodexProtoSession(proc!);
      protoSessions.set(id, proto);
      // Track approval wait state to surface in /sessions
      const offApproval = proto.onEvent((ev) => {
        try {
          const runId = String(ev.id || '');
          if (!runId) return;
          const t = String(ev.msg?.type || '');
          let set = sessionApprovalWaits.get(id);
          if (!set) { set = new Set<string>(); }
          if (t === 'apply_patch_approval_request') {
            set.add(runId);
            sessionApprovalWaits.set(id, set);
          } else if (set.has(runId)) {
            set.delete(runId);
            if (set.size === 0) sessionApprovalWaits.delete(id); else sessionApprovalWaits.set(id, set);
          }
        } catch {}
      });
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
            // Stream assistant deltas and persist once content is available
            let assistantContent = '';
            let asstMsgId: string | null = null;
            // Throttled DB update for streaming deltas
            let flushTimer: NodeJS.Timeout | null = null;
            const flushMs = 200; // max ~5 updates/sec
            const flushSoon = () => {
              if (flushTimer) return;
              flushTimer = setTimeout(() => {
                try {
                  if (!asstMsgId && assistantContent) {
                    // Create assistant row on first content
                    asstMsgId = crypto.randomUUID();
                    db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
                      .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
                  } else if (asstMsgId) {
                    db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId);
                  }
                } catch {}
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
                  try {
                    if (!asstMsgId) {
                      asstMsgId = crypto.randomUUID();
                      db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
                        .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
                    } else {
                      db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId);
                    }
                  } catch {}
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
            // Finalize assistant content: ensure row exists
            try {
              if (!asstMsgId && assistantContent) {
                asstMsgId = crypto.randomUUID();
                db4.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
                  .run(asstMsgId, id, turnId, 'assistant', assistantContent, Date.now());
              } else if (asstMsgId) {
                db4.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId);
              }
            } catch {}
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
        try { offApproval(); } catch {}
        try { sessionApprovalWaits.delete(id); } catch {}
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
    const withDerived = rows.map((r) => ({
      ...r,
      status: computeDisplayStatus(r),
      busy: !!locks.get(r.id),
      pending_approval: !!sessionApprovalWaits.get(r.id),
    }));
    reply.send(withDerived);
  });

  app.get('/sessions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const db = getDb();
    const row = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    (row as any).status = computeDisplayStatus(row as any);
    (row as any).busy = !!locks.get(id);
    (row as any).pending_approval = !!sessionApprovalWaits.get(id);
    const msgs = db.prepare('select * from messages where session_id = ? order by created_at asc limit 200').all(id) as Message[];
    const accept = String(req.headers['accept'] || '');
    // If the client explicitly asks for HTML, serve a minimal session UI shell
    if (accept.includes('text/html')) {
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Session</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; }
      #log { white-space: pre-wrap; border: 1px solid #ddd; padding: 12px; border-radius: 8px; min-height: 120px; }
      textarea { width: 100%; min-height: 80px; }
      button { padding: 6px 12px; }
    </style>
  </head>
  <body>
    <h1>Session</h1>
    <div id="status"></div>
    <div id="log"></div>
    <div style="margin-top:12px;">
      <textarea id="msg" placeholder="Type a message..."></textarea>
      <div style="margin-top:8px;"><button id="send">Send</button></div>
    </div>
    <script>
      const id = (function(){ try { const parts = location.pathname.split('/'); return parts[parts.length - 1] || ''; } catch { return ''; } })();
      const statusEl = document.getElementById('status');
      const logEl = document.getElementById('log');
      function append(line){ logEl.textContent += (logEl.textContent ? '\n' : '') + line; logEl.scrollTop = logEl.scrollHeight; }

      // Fetch session details (force JSON Accept header)
      fetch('/sessions/' + id, { headers: { 'Accept': 'application/json' } })
        .then(r => r.json())
        .then(s => { statusEl.textContent = 'Status: ' + (s.status || 'unknown'); (s.messages||[]).forEach(m => append(m.role + ': ' + m.content)); })
        .catch(() => {});

      // Simple polling for new messages using after cursor
      let after = '';
      function poll(){
        return fetch('/sessions/' + id + '/messages?after=', { headers: { 'Accept': 'application/json' } })
          .then(r => r.json())
          .then(arr => {
            if (Array.isArray(arr) && arr.length) {
              // Advance cursor to the last id
              after = arr[arr.length - 1].id || after;
              arr.forEach(m => append(m.role + ': ' + m.content));
            }
            setTimeout(() => { poll().catch(() => {}); }, 1000);
          })
      }
      poll().catch(() => {});

      // Send message helper
      document.getElementById('send').addEventListener('click', () => {
        const v = String((document.getElementById('msg').value || '')).trim();
        if (!v) return;
        fetch('/sessions/' + id + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ content: v })
        }).then(() => { (document.getElementById('msg').value = ''); }).catch(() => {});
      });
    </script>
  </body>
</html>`;
      return reply.type('text/html').send(html);
    }
    // Default: JSON API response
    reply.send({ ...row, messages: msgs.slice(-20) });
  });

  // Update session options (currently supports block_while_running)
  app.patch('/sessions/:id', async (req, reply) => {
    const { id } = req.params as any;
    const body = (req.body as any) || {};
    const db = getDb();
    const row = db.prepare('select * from sessions where id = ?').get(id) as Session | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (typeof body.block_while_running === 'boolean') {
      db.prepare('update sessions set block_while_running = ? where id = ?').run(body.block_while_running ? 1 : 0, id);
    }
    const updated = db.prepare('select * from sessions where id = ?').get(id) as any;
    updated.status = computeDisplayStatus(updated);
    updated.busy = !!locks.get(id);
    reply.send(updated);
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
          releaseLock(id);
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

      const runId = proto!.sendUserInput(contentToSend, turnId);
      // Insert a placeholder assistant message immediately and stream updates
      const asstMsgId = crypto.randomUUID();
      db.prepare('insert into messages (id, session_id, turn_id, role, content, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(asstMsgId, id, turnId, 'assistant', '', Date.now());

      // ACK immediately so the client can reset UI state
      reply.send({ turn_id: turnId, user_message_id: userMsgId, assistant_message_id: asstMsgId });

      // Continue streaming in the background and release the lock when done
      (async () => {
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

        const off = proto!.onEvent((ev) => {
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
          assistantContent = await proto!.awaitTaskComplete(runId, TURN_TIMEOUT_SECS * 1000);
        } catch (err: any) {
          assistantContent = `Error: ${String(err?.message || err)}`;
        }
        try { off(); } catch {}
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        // Finalize assistant content
        try { db.prepare('update messages set content = ? where id = ?').run(assistantContent, asstMsgId); } catch {}
        if (DEBUG) (req as any).log.info({ id, turnId, userMsgId, asstMsgId, alen: assistantContent.length }, 'Assistant message persisted');
        releaseLock(id);
      })().catch(() => { try { releaseLock(id); } catch {} });
    } catch (e: any) {
      // On synchronous failure, ensure lock is released and surface error
      try { releaseLock(id); } catch {}
      return reply.code(500).send({ error: String(e?.message || e || 'failed to start turn') });
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

  // Minimal approvals endpoint: forward approve/deny to the agent process
  app.post('/sessions/:id/approvals', async (req, reply) => {
    const { id } = req.params as any;
    const body = (req.body as any) || {};
    const callId = String(body.call_id || '').trim();
    const decision = String(body.decision || '').trim();
    const scope = body.scope ? String(body.scope) as any : undefined;
    const pathScope = body.path ? String(body.path) : undefined;
    if (!callId || (decision !== 'approve' && decision !== 'deny')) {
      return reply.code(400).send({ error: 'invalid request' });
    }
    const proto = protoSessions.get(id);
    if (!proto) return reply.code(409).send({ error: 'session not active' });
    try {
      (req as any).log.info({ id, callId, decision, scope, pathScope }, 'Forwarding approval decision');
      proto.sendApprovalDecision(callId, decision as any, { scope, path: pathScope });
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.code(500).send({ error: String(e?.message || e || 'failed to send decision') });
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
