# awrapper

Local orchestrator for CLI agents (initial focus: Codex). v0.1 provides a single-process Fastify server, SQLite persistence, and a unified Sessions model with oneshot and persistent lifecycles.

Quickstart

- Prereqs: Node.js 20+, Git, Codex CLI installed (`brew install codex` or `npm i -g @openai/codex`).
- Use pnpm: `pnpm install`
- Run dev: `pnpm dev`
- Build: `pnpm build`
- Tests: `pnpm test`
- Open: `http://127.0.0.1:8787`

Notes

- Default lifecycle is `persistent`; multi-turn messaging is implemented via `codex proto` with a simple JSONL protocol. One in-flight user turn per session is enforced.
- Data lives under `~/.awrapper` (DB, logs, artifacts). Worktrees are created under `<repo>/.awrapper-worktrees/<session_id>` and are not auto-cleaned.
