# awrapper

Local orchestrator for CLI agents (initial focus: Codex). v0.1 provides a single-process Fastify server, SQLite persistence, and a unified Sessions model with oneshot and persistent lifecycles.

Quickstart

- Prereqs: Node.js 20+, Git, Codex CLI installed (`brew install codex` or `npm i -g @openai/codex`).
- Install: `npm install`
- Run dev: `npm run dev`
- Open: `http://127.0.0.1:8787`

Notes

- Default lifecycle is `persistent`, but messaging for persistent sessions via `codex proto` is not wired yet in this scaffold. Use `oneshot` to exercise `codex exec --json` end-to-end.
- Data lives under `~/.awrapper` (DB, logs, artifacts). Worktrees are created under `<repo>/.awrapper-worktrees/<session_id>` and are not auto-cleaned.
