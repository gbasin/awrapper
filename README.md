# awrapper

Local orchestrator for CLI agents (initial focus: Codex). v0.1 provides a single-process Fastify server, SQLite persistence, and a unified Sessions model. All sessions are persistent.

# Quickstart

- Prereqs: Node.js 23.x. This repo has an `.nvmrc` pinned to 23.4.0 — run `nvm use` (or `nvm install`) to match. Also install Git and Codex CLI (`brew install codex` or `npm i -g @openai/codex`).
- Use pnpm: `pnpm install`
- Run dev: `pnpm dev` or `DEBUG=1 pnpm dev` for extra logging
- Typecheck: `pnpm typecheck` (server + web via Turbo)
- Build: `pnpm build` (server build + web build via Turbo)
- Tests: `pnpm test` (runs package tests via Turbo; server uses Vitest)
- Open: `http://127.0.0.1:8787` (append `?debug=1` for debug logging)

# Notes

- Sessions are persistent; multi-turn messaging is implemented via `codex proto` with a simple JSONL protocol. One in-flight user turn per session is enforced.
- Data lives under `~/.awrapper` (DB, logs, artifacts). Worktrees are created under `<repo>/.awrapper-worktrees/<session_id>` and are not auto-cleaned.

## Debugging

- Enable verbose logs: set `AWRAPPER_DEBUG=1` (or `DEBUG=1`) before `pnpm dev`. The server logs creation requests and each user/assistant turn with IDs and byte counts.
- View a session with client debug: append `?debug=1` to the session URL. The page emits console logs (polling steps, submit events) and mirrors errors to the server via `POST /client-log`.
- Tail agent logs: `tail -f ~/.awrapper/logs/session-<id>.log` to see the Codex process output captured by awrapper.
- Check persisted data: `GET /sessions/:id` (Accept: application/json) returns the session row and last 20 messages. `GET /sessions/:id/messages` lists up to 200 messages.
- Common issues:
  - No output, SyntaxError in browser: the session page script is ES5-compatible. If you still see a syntax error, hard-reload or try a different browser; share server logs (plus any `/client-log` lines).
  - `better-sqlite3` NODE_MODULE_VERSION mismatch: rebuild native modules after switching Node versions (see Troubleshooting above).

## Monorepo layout

- Package manager: pnpm workspaces (see `pnpm-workspace.yaml`).
- Orchestration: Turborepo (`turbo.json`).
- Packages:
  - Root (server): Node/Fastify server. Scripts: `build` (tsc), `typecheck` (tsc --noEmit), `test` (Vitest).
  - `web/` (UI): Vite + React. Scripts: `build` (vite build), `typecheck` (tsc --noEmit).

### Commands

- `pnpm typecheck`: runs `typecheck` in server and web via Turbo.
- `pnpm build`: runs server `build` then `turbo run build` for packages (web).
- `pnpm test`: runs server tests then `turbo run test` (other packages with tests).

Web builds include TypeScript checking via `vite-plugin-checker`, so Vite will fail on TS errors. The `typecheck` script also runs `tsc --noEmit` directly for CI and editor workflows.

## Environment

- `PORT` and `BIND_ADDR`: override default bind (`127.0.0.1`) and port (`8787`).
- `AWRAPPER_BROWSE_ROOTS` or `BROWSE_ROOTS`: comma/colon-separated directories allowed for the server-side directory picker. `~` expands to home.
- `CODEX_BIN`: path to `codex` binary if not on PATH.
- `OPENAI_API_KEY`: required for Codex to call OpenAI.
- `AWRAPPER_DEBUG`/`DEBUG`: enable verbose server logs and client debug integration.
- `AWRAPPER_TURN_TIMEOUT_SECS` (or `TURN_TIMEOUT_SECS`): inactivity timeout for a single user turn in persistent sessions. The timer resets on any agent event (reasoning/message/tool/etc). Default 600 seconds. Set to `0` to disable. Note: the timeout is paused while awaiting user approvals (e.g., file write requests).

### Web dev proxy

- `AWRAPPER_API_ORIGIN` or `API_ORIGIN`: backend origin for Vite dev proxy, e.g., `http://127.0.0.1:8787`.
- `AWRAPPER_API_PORT` or `API_PORT`: port-only override used when origin is not set (defaults to `8787`).
- Notes: the server falls back to a random free port if the default is busy; when that happens, set `AWRAPPER_API_ORIGIN` so the dev UI can reach the API.

## How sessions work

- Persistent: spawns `codex -a=never proto` and streams through a minimal JSONL protocol. One user turn at a time is enforced.
- Initial message: if you provide an Initial message on creation, awrapper sends it immediately and persists both user and assistant messages so the transcript updates right away.
