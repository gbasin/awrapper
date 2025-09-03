# PRD v1 (MVP): Launch CLI Agents From Phone + Multi‑Turn Sessions

## Goal
- From a mobile-friendly web app, start a named CLI “agent” with simple parameters on an always‑on server, then see status, basic logs, and final outputs. No live TTY passthrough or terminal fidelity.
- Support multi‑turn conversational sessions with a headless CLI agent (initially just `codex`) attached to a Git worktree; send/receive messages over REST with post‑processed responses.

## Non‑Goals (MVP)
- No raw PTY/TTY streaming to the browser; the session process can use a server‑side PTY if required by the CLI.
- No multi‑user/teams, RBAC, GPUs, or k8s.
- No advanced viewers, artifact previews, or complex orchestration.

## User Flows
- Create Run: pick an agent, set params, tap Start.
- View Run: see status and last N log lines, download full log/artifacts after finish.
- Manage Run: cancel a running job; optionally fork (re‑run with tweaks).
- Create Session: pick `codex`, choose repo + branch (defaults to currently checked out), server creates an auto‑named Git worktree and starts the headless CLI session, optional initial message.
- Send Message: type a user message; receive a post‑processed assistant response. Enforce one in‑flight message per session.
- View Session: see transcript (messages), session status, associated repo/branch/worktree.

## Scope (What’s In)
- Predefined agents registry: safe, whitelisted commands + allowed params. Initial agents: `codex` (OAI) CLI binary.
- Runs (one‑shot): queued → running → finished | failed | canceled | timed_out.
- Sessions (multi‑turn): persistent headless CLI process per session, attached to a Git worktree and executed inside a rootless container for isolation. No idle timeout; sessions close when the underlying process exits.
- Containerized sessions: per‑session container with the worktree bind‑mounted as the working directory and a persistent HOME volume for language/tool caches. No per‑language adapters required.
- Git worktrees: on session start, create an auto‑named worktree for the selected branch under the provided repo path. Agent runs inside the worktree.
- Log capture for runs: append stdout/stderr to files; UI shows last ~200 lines with polling.
- Basic transcripts for sessions: store user/assistant messages; return post‑processed assistant replies (no token streaming in MVP).
- Single‑user auth (simple token) to protect the UI/API.

## Architecture (Simple, Single Box)
- Web App (PWA, mobile‑first):
  - Pages: Runs List, New Run, Run Detail (status, log tail, artifacts, cancel).
  - Pages: Sessions List, New Session, Session Detail (transcript, repo/branch, input box).
  - Polling every ~100s for status/log tail and new messages (no WebSockets in MVP).
- API Server:
  - REST endpoints for runs (create/list/status/logs/cancel) and sessions/messages.
  - Maintains a lightweight queue for runs and a per‑session in‑flight lock for messages.
  - Persists runs, sessions, and messages in SQLite.
- Worker (same service/process or sidecar):
  - Runs: dequeues jobs and spawns the agent process, captures logs, tracks exit.
  - Sessions: creates and supervises a long‑lived rootless container per session. The Git worktree is bind‑mounted as `/work`; a named volume provides a persistent `$HOME` for caches. Commands run via `exec` in the container (PTY if required). Feeds user messages to stdin; collects output and emits a single post‑processed assistant message per user turn.
  - Simple end‑of‑turn detection: CLI‑specific markers when available; otherwise quiet‑period flush or process prompt heuristics.
- Storage:
  - Metadata: SQLite (simplest) for runs, sessions, and messages.
  - Logs/artifacts: local filesystem paths (or S3 later). Session raw stdout/stderr optional; transcripts are required.
- Supervision:
  - Run API/Worker under systemd or PM2 on a small VM. Sessions use rootless containers for isolation; no k8s.

## Networking & Ports (MVP)
- Non‑cooperative default: assume apps may hardcode ports (e.g., 3000). Each session gets its own container network namespace to avoid collisions.
- Host exposure: allocate a host port per session and publish it to a fixed container port (default 3000). The worker writes `ports.json` in the worktree and returns port info in the Session detail.
- Discovery (optional): when the app binds a different internal port, the worker may detect it (e.g., `ss -ltnp` + log hints) and proxy to it from the fixed container port. Preview is best‑effort in MVP; tests can target the discovered internal port directly.
- Access patterns: prefer automated tests and log tails. For manual preview, either reverse proxy `https://preview.example/s/<id>` → `127.0.0.1:<host_port>` or provide an SSH tunnel one‑liner.

## Minimal Data Model
- Agent: id, name, command_template, allowed_params (schema), env_defaults.
- Run: id, agent_id, params_json, status, started_at, finished_at, exit_code,
  log_path, artifact_paths[], error_message.
- Session: id, agent_id, repo_path, branch, worktree_path, status (open|closed), pid,
  started_at, last_activity_at, error_message,
  container_id, home_volume, isolation_mode (isolated|cooperative, default isolated),
  ports_json (e.g., `{ "web": { "host_port": 34715, "container_port": 3000 } }`).
- Message: id, session_id, role (user|assistant|tool), content, created_at.

## REST Endpoints
- Runs
  - POST `/runs` — body: `{ agent_id, params }` → `{ id }`.
  - GET `/runs` — list recent runs with status.
  - GET `/runs/:id` — run detail (status, times, exit_code, summary).
  - GET `/runs/:id/log?tail=200` — last N lines; `?full=1` to download full log.
  - POST `/runs/:id/cancel` — best‑effort terminate.
  - GET `/runs/:id/artifacts` — list artifact filenames + download URLs.
- Sessions
  - POST `/sessions` — body: `{ agent_id: "codex", repo_path, branch?, initial_message? }` → `{ id, worktree_path }`.
  - GET `/sessions` — list recent sessions with status.
  - GET `/sessions/:id` — session detail (status, repo/branch/worktree, container_id, ports, last_activity_at) + transcript summary (e.g., last N messages).
  - GET `/sessions/:id/messages?after=<message_id>` — list messages after an id.
  - POST `/sessions/:id/messages` — body: `{ content }`; enqueues one user turn and returns `{ message_id }` immediately. Client polls messages to receive the assistant reply when ready. One in‑flight turn per session enforced.

## Security (MVP)
- Single‑user bearer token in env; required for all endpoints.
- Agents registry prevents arbitrary command execution; only whitelisted agents run (`codex` to start) with fixed command templates and safe flags.
- Sessions run inside a Git worktree rooted under a provided repo path; file access is constrained to that subtree by working directory and validations.
- Basic redaction of obvious secrets from logs/transcripts (tokens, keys) where feasible.

## Deployment
- One Linux VM (e.g., 2–4 vCPU, 4–8GB RAM).
- Install runtime, Podman (rootless) with `slirp4netns`, pre‑pull a small "devrunner" image with common tools, create data directory and a named volume for `$HOME` caches.
- Run service under systemd/PM2. Worker starts one container per session: bind‑mount worktree at `/work`, mount `$HOME` volume, publish an allocated host port to container port 3000.
- Point domain to VM; optional reverse proxy for session previews (Caddy/nginx). Keep an allow‑listed host port range open in the firewall.

## Success Criteria
- Launch a run from phone in <10s end‑to‑end (UI → queued → running).
- See live status updates and log tail without page refresh.
- Runs complete reliably without dying when the phone sleeps.
- Can cancel a run and retrieve artifacts/logs after completion.
- Start a session in <10s with an auto‑named worktree on a chosen branch; allocate a container and host port; send at least two user messages and receive post‑processed assistant replies, one in‑flight turn at a time.
- No idle timeout; sessions remain open until the CLI process exits.
- Can run multiple concurrent dev servers that default to the same port (e.g., 3000) without collisions.

## Later (v1.x, not required now)
- Web push notifications for start/finish/error and new assistant replies.
- Postgres + S3 for durability; role‑based access; multi‑user.
- Optional chunked/partial streaming of assistant replies; WebSocket transport.
- Richer viewers, diff/file previews for session outputs; opt‑in raw PTY passthrough for specific adapters if truly needed.
- Agent templates editable in UI.

## Notes on Agent CLIs (Initial)
- `codex` launched inside a per‑session rootless container by the worker (PTY if required).
- Working directory is `/work` (the session worktree bind‑mounted into the container). A named `$HOME` volume preserves language/tool caches across sessions.
- Output is normalized and post‑processed into one assistant message per turn; token‑by‑token streaming is out of scope for MVP.

## Limitations & Drawbacks (MVP)
- Container overhead: slight startup latency and CPU/memory overhead versus host processes; mitigated by long‑lived containers and cached `$HOME` volume.
- Port discovery is best‑effort: truly opaque apps may require a user hint to identify the correct internal port for previews; automated tests can target discovered ports directly.
- Preview fidelity: some dev servers emit absolute URLs (including ports) which can break reverse‑proxy previews. MVP prefers logs/tests; polished previews are a later add.
- Rootless networking limits: dynamic port changes after container start are constrained; publish a fixed container port (e.g., 3000) and proxy internally as needed.
- File watching quirks: some toolchains’ file watchers are less reliable on bind mounts; can be mitigated with polling flags in CI‑like runs.
- GPU/privileged tooling out of scope: containers are unprivileged/rootless; tasks needing elevated capabilities are not supported in MVP.
