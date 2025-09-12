# Agents

This project currently ships a single built‑in agent: `codex` (OpenAI Codex CLI).

Overview

- Registry: A default `codex` agent row is inserted in SQLite on first run.
- Sessions: persistent `codex -c model="gpt-5-high" -c include_plan_tool=true -c include_apply_patch_tool=true -c include_view_image_tool=true -c tools.web_search=true -c approval_policy="never" -c sandbox_mode="workspace-write" proto` process with a minimal JSONL protocol over stdio.
- Logs: agent stdout/stderr are tee’d into `~/.awrapper/logs/session-<id>.log` and viewable in the session page.

Requirements

- Codex CLI installed and on PATH, or set `CODEX_BIN` to the binary path.
- `OPENAI_API_KEY` available in the Codex process environment for API calls.

Spawn

- Command: `codex -c model="gpt-5-high" -c include_plan_tool=true -c include_apply_patch_tool=true -c include_view_image_tool=true -c tools.web_search=true -c approval_policy="never" -c sandbox_mode="workspace-write" proto`
- Session configure: configuration is passed via `-c` overrides at spawn time (e.g., `-c model="gpt-4o-mini"`). The Proto stream does not accept a `configure_session` submission; it emits a `session_configured` event derived from the effective config.
- Turns: awrapper sends `user_input` with a generated turn id, waits for `task_complete`, accumulating any `agent_message` strings into the assistant message.

Initial message

- If a session is created with an Initial message, awrapper immediately sends it and persists both user/assistant messages so the transcript appears without typing.

Tuning

- Environment variables (read at spawn time):
  - `CODEX_BIN`: override codex binary path
  - `OPENAI_API_KEY`: OpenAI API key (Codex reads this)
  - Standard HTTP proxy variables if your environment requires them
- Provider/model defaults can be set via `-c` (e.g., `-c model="gpt-4o-mini"`) or profiles in `~/.codex/config.toml`. The plan tool is enabled explicitly with `-c include_plan_tool=true`.

Troubleshooting

- No response: check `~/.awrapper/logs/session-<id>.log` for Codex CLI errors.
- Network/API errors: ensure `OPENAI_API_KEY` is set for the spawned Codex process.
- Browser shows nothing: open the session URL with `?debug=1` to emit client logs and mirror them to the server (`POST /client-log`).

Code‑aware search (ast-grep)

- Purpose: prefer AST-aware search/replace over regex for multi-file refactors.
- Install: `brew install ast-grep` or `npm i -g @ast-grep/cli`.
- Search: `sg -l ts -p 'console.log($X)' src` to find patterns in TS/JS.
- Rewrite (dry-run): `sg -l ts -p 'oldFn($A, $B)' --rewrite 'newFn($B, $A)' --dry-run`.
- Apply: drop `--dry-run` after reviewing the proposed changes.
- Scope: use when the change is mechanical and patternable; otherwise edit surgically.
