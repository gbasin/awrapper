# PRD v1 (MVP): Launch CLI Agents From Phone

## Goal
- From a mobile web app, start a named CLI “agent” with simple parameters on a always-on server, then see status, basic logs, and final outputs. No live TTY passthrough or terminal fidelity.

## Non‑Goals (MVP)
- No raw PTY/TTY streaming or interactive shells.
- No multi‑user/teams, RBAC, GPUs, or k8s.
- No advanced viewers, artifact previews, or complex orchestration.

## User Flows
- Create Run: pick an agent, set params, tap Start.
- View Run: see status and last N log lines, download full log/artifacts after finish.
- Manage: cancel a running job; optionally fork (re-run with tweaks).

## Scope (What’s In)
- Predefined agents registry: safe, whitelisted commands + allowed params.
- Basic run lifecycle: queued → running → finished | failed | canceled | timed_out.
- Log capture: append stdout/stderr to files; UI shows last ~200 lines with polling.
- Artifacts: optional file outputs saved and downloadable.
- Single-user auth (simple token) to protect the UI/API.

## Architecture (Simple, Single Box)
- Web App (PWA, mobile-first):
  - Pages: Runs List, New Run, Run Detail (status, log tail, artifacts, cancel).
  - Polling every ~5s for status/log tail (no WebSockets needed for MVP).
- API Server:
  - REST endpoints to create/list runs, fetch status/logs, cancel, list artifacts.
  - Maintains a lightweight queue; persists run metadata.
- Worker (same service/process or sidecar):
  - Dequeues jobs and spawns the agent process.
  - Captures stdout/stderr to rotating files; tracks exit code and duration.
  - Enforces timeouts; marks final state; records artifacts.
- Storage:
  - Metadata: SQLite (simplest) or Postgres.
  - Logs/artifacts: local filesystem paths (or S3 later).
- Supervision:
  - Run API/Worker under systemd or PM2 on a small VM. No containers required.

## Minimal Data Model
- Agent: id, name, command_template, allowed_params (schema), env_defaults.
- Run: id, agent_id, params_json, status, started_at, finished_at, exit_code,
  log_path, artifact_paths[], error_message.

## REST Endpoints
- POST `/runs` — body: `{ agent_id, params }` → `{ id }`.
- GET `/runs` — list recent runs with status.
- GET `/runs/:id` — run detail (status, times, exit_code, summary).
- GET `/runs/:id/log?tail=200` — last N lines; `?full=1` to download full log.
- POST `/runs/:id/cancel` — best-effort terminate.
- GET `/runs/:id/artifacts` — list artifact filenames + download URLs.

## Security (MVP)
- Single-user bearer token in env; required for all endpoints.
- Agents registry prevents arbitrary command execution; only whitelisted agents run.
- Basic redaction of obvious secrets from logs (tokens, keys) where feasible.

## Deployment
- One Linux VM (e.g., 1–2 vCPU, 2–4GB RAM).
- Install runtime, create data directory, run service under systemd/PM2.
- Point domain to VM; serve web app + API behind HTTPS (Caddy or nginx).

## Success Criteria
- Launch a run from phone in <10s end-to-end (UI → queued → running).
- See live status updates and log tail without page refresh.
- Runs complete reliably without dying when the phone sleeps.
- Can cancel a run and retrieve artifacts/logs after completion.

## Later (v1.x, not required now)
- Web push notifications for start/finish/error.
- Postgres + S3 for durability; role-based access; multi-user.
- Structured events; richer viewers; optional WebSocket streaming.
- Agent templates editable in UI.

## Open Questions
- Which 2–3 agents are first (names/commands/params)?
- SQLite vs Postgres for the initial deploy?
- Log retention policy (days/size) for the VM disk?

