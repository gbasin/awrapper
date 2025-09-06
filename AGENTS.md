# Agents

This project currently ships a single built‑in agent: `codex` (OpenAI Codex CLI).

Overview

- Registry: A default `codex` agent row is inserted in SQLite on first run.
- Sessions: persistent `codex -a=never proto` process with a minimal JSONL protocol over stdio.
- Logs: agent stdout/stderr are tee’d into `~/.awrapper/logs/session-<id>.log` and viewable in the session page.

Requirements

- Codex CLI installed and on PATH, or set `CODEX_BIN` to the binary path.
- `OPENAI_API_KEY` available in the Codex process environment for API calls.

Spawn

- Command: `codex -a=never proto`
- Session configure: awrapper sends a `configure_session` op (provider/model/approval policy + `cwd`). Missing confirmations time out leniently to tolerate older Codex builds.
- Turns: awrapper sends `user_input` with a generated turn id, waits for `task_complete`, accumulating any `agent_message` strings into the assistant message.

Initial message

- If a session is created with an Initial message, awrapper immediately sends it and persists both user/assistant messages so the transcript appears without typing.

Tuning

- Environment variables (read at spawn time):
  - `CODEX_BIN`: override codex binary path
  - `OPENAI_API_KEY`: OpenAI API key (Codex reads this)
  - Standard HTTP proxy variables if your environment requires them
- Provider/model defaults are set when configuring the proto session (provider `OpenAI`, wire API `responses`, model `o4-mini`). You can change these defaults in `src/proto.ts` if needed.

Troubleshooting

- No response: check `~/.awrapper/logs/session-<id>.log` for Codex CLI errors.
- Network/API errors: ensure `OPENAI_API_KEY` is set for the spawned Codex process.
- Browser shows nothing: open the session URL with `?debug=1` to emit client logs and mirror them to the server (`POST /client-log`).
