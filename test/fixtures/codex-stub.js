#!/usr/bin/env node
/*
  Minimal stub that emulates "codex" CLI for tests:
  - "exec --json -C <worktree> --output-last-message <file> <prompt>"
    writes a simple response to the file and exits 0.
  - "-a=never proto -C <worktree>"
    reads JSONL from stdin and emits JSONL responses for
    configure_session and user_input ops.
*/
import fs from 'node:fs';

const argv = process.argv.slice(2);

function isExec() {
  return argv[0] === 'exec';
}

function isProto() {
  return argv.includes('proto');
}

if (isExec()) {
  // Find --output-last-message path and prompt (last arg)
  const outIdx = argv.indexOf('--output-last-message');
  const outPath = outIdx !== -1 ? argv[outIdx + 1] : null;
  const prompt = argv[argv.length - 1] || '';
  if (outPath) {
    fs.writeFileSync(outPath, `stub-output: ${prompt}`);
  }
  // Emit a JSON line to stdout to simulate codex output
  process.stdout.write(JSON.stringify({ id: 'oneshot', msg: { type: 'task_complete', last_agent_message: `stub-output: ${prompt}` } }) + '\n');
  process.exit(0);
}

if (isProto()) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        handle(msg);
      } catch {
        // ignore
      }
    }
  });
  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
  function handle(m) {
    if (m?.op?.type === 'configure_session') {
      send({ id: m.id, msg: { type: 'session_configured', session_id: 's1', model: 'stub', history_log_id: 1, history_entry_count: 0 } });
      return;
    }
    if (m?.op?.type === 'user_input') {
      const text = (m.op.items?.find?.((i) => i?.type === 'text')?.text) || '';
      // Simulate small delay to allow 409 test
      setTimeout(() => {
        send({ id: m.id, msg: { type: 'agent_message', message: `Echo: ${text}` } });
        send({ id: m.id, msg: { type: 'task_complete', last_agent_message: `Echo: ${text}` } });
      }, 150);
      return;
    }
  }
} else {
  console.error('Unknown invocation', argv.join(' '));
  process.exit(2);
}

