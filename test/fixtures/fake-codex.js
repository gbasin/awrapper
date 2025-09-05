#!/usr/bin/env node
// Minimal fake Codex CLI for integration tests
// Supports:
// - exec --json --output-last-message <path> <prompt>
// - [-a=never] proto (JSONL over stdin/stdout)

import fs from 'fs';
import readline from 'readline';
import path from 'node:path';

const argv = process.argv.slice(2);

function printCwd() {
  process.stdout.write(`CWD:${process.cwd()}\n`);
}

async function runExec(args) {
  printCwd();
  process.stdout.write(`ARGS:${JSON.stringify(args)}\n`);
  const outIdx = args.indexOf('--output-last-message');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const prompt = args[args.length - 1];
  if (outPath) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `Echo: ${prompt}`);
    } catch (e) {
      // ignore
    }
  }
  // Emit a trivially valid JSON line when --json provided
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ type: 'done', ok: true }) + '\n');
  }
  process.exit(0);
}

async function runProto() {
  printCwd();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      const id = obj.id || 'unknown';
      const op = obj.op || {};
      if (op.type === 'configure_session') {
        const evt = { id, msg: { type: 'session_configured', cwd: process.cwd() } };
        process.stdout.write(JSON.stringify(evt) + '\n');
      } else if (op.type === 'user_input') {
        const text = (op.items && op.items[0] && op.items[0].text) || '';
        const msg1 = { id, msg: { type: 'agent_message', message: `Echo: ${text}` } };
        const msg2 = { id, msg: { type: 'task_complete' } };
        process.stdout.write(JSON.stringify(msg1) + '\n');
        process.stdout.write(JSON.stringify(msg2) + '\n');
      }
    } catch (_) {
      // ignore
    }
  });
  // keep alive until SIGTERM
  process.on('SIGTERM', () => process.exit(0));
}

async function main() {
  if (argv.length === 0) {
    console.error('usage: codex <exec|proto> ...');
    process.exit(2);
  }
  // Allow optional -a=never before subcommand
  const argsNoPolicy = argv[0].startsWith('-a=') ? argv.slice(1) : argv;
  const cmd = argsNoPolicy[0];
  const rest = argsNoPolicy.slice(1);
  if (cmd === 'exec') {
    await runExec(rest);
  } else if (cmd === 'proto') {
    await runProto();
  } else {
    console.error('unknown subcommand:', cmd);
    process.exit(2);
  }
}

main();
