0) TL;DR (shape of v1)
	•	Client: Web app that’s a PWA (installable on phone). Same UI on desktop & mobile. Real‑time via WebSocket.
	•	Server: Single service (TypeScript) with a Runner that spawns each agent CLI as an OS process with a PTY. No k8s; one box (or one container) to start.
	•	Data: Postgres for metadata, S3‑compatible object store for logs + artifacts (MinIO in dev).
	•	Auth: Standard browser OAuth (PKCE) in the client; server exchanges code, stores provider tokens, and issues short‑lived, run‑scoped credentials to the runner so CLIs can authenticate.
	•	Concurrency: ~5 runs in parallel, simple in‑app queue, default soft timeout (30m), single retry on “known transient” exits.
	•	Persistence: Keep everything forever (events, text logs, artifacts).
	•	UI: Left Run List, right Run Detail (tabbed sub‑panes). Attach to a live run with interactive terminal stream. Fork Run is the single high‑impact quick action. Optional Side‑by‑Side Compare of final outputs across agents.
	•	Notifications: Web Push for start/finish/error + “human input requested.”
	•	Ensemble: Simple “task” spawns N agents in parallel off the same workspace snapshot; you manually pick a winner in v1.

⸻

1) Goals & non‑goals

Goals
	•	Run and attach to interactive CLI agents (e.g., Claude Code, OpenAI‑based CLI) with real‑time streaming.
	•	Manage multiple parallel sessions with lightweight queuing.
	•	Persist everything: prompts, logs, deltas, artifacts.
	•	Mobile: trigger runs and review/attach from phone with snappy UX.
	•	Enable ensemble (N agents), compare, and select winner.

Non‑goals (v1)
	•	Team/collab roles & approvals.
	•	GitHub webhooks/Checks, CI integration.
	•	Advanced viewers (notebooks, images, JSON trees), cost accounting.
	•	GPUs, sandboxed VMs/containers per run.

⸻

2) Assumptions locked from your answers
	•	Interactive CLIs with back‑and‑forth; must support PTY and attach/detach.
	•	Cloud‑hosted single‑user deployment initially.
	•	CPU‑only.
	•	OAuth via the thin client; CLIs run headless on the server but get the right tokens behind the scenes.
	•	Workspace can have a checked‑out repo; simplest flow first.
	•	“Whatever” for most policies ⇒ pick sane defaults.

⸻

3) Primary user stories (MVP)
	1.	Start a run
As a user, I pick an agent adapter + config (repo/workspace optional), click Run, see live logs immediately.
	2.	Attach & interact
While a run is live, I click Attach, type instructions/questions, see agent responses in real time.
	3.	Fork run
From any run, I click Fork, tweak parameters (prompt/env), and run again—without re‑wiring auth or workspace.
	4.	Ensemble a task
I provide a task spec, choose 2–5 agents, it runs them in parallel from the same snapshot, I compare outputs and mark the winner.
	5.	Mobile parity
From my phone (PWA), I can start/attach/cancel/fork, receive push notifications, and scroll long histories smoothly.
	6.	Browse history
I can filter recent runs, open any run, and see timeline, artifacts, exit code, and environment used.

⸻

4) System overview (components)
	•	Web App (PWA, React/TypeScript)
  	•	Real‑time run view (WebSocket).
  	•	Service worker for push + offline shell.
  	•	Virtualized log viewer for large histories.
	•	API + Runner (TypeScript)
  	•	API: REST + WebSocket. Issues run tokens, persists metadata, proxies attach input.
  	•	Runner: Spawns CLI processes with PTY, streams stdout/stderr as structured events (when available) or text lines.
  	•	Queue: Simple Postgres‑backed queue with concurrency limit and retry policy.
	•	State & Storage
  	•	Postgres: runs, events index, credentials, notifications, settings.
  	•	Object store (S3/MinIO): log chunks, artifacts, run bundles (e.g., tar of workspace diffs).

⸻

5) Functional scope (v1)

5.1 Agents & adapters
	•	External CLI First: adapters map your configuration to spawn(cmd, args, env, cwd) with a PTY.
	•	Structured output: Prefer newline‑delimited JSON events from the CLI (if available). Fallback: parse tagged lines; store raw text regardless.
	•	Adapter registry: JSON descriptors define:
  	•	Display name, version.
  	•	Required env vars/secrets.
  	•	Default args, supported flags.
  	•	“Supports interactive attach” (yes).

5.2 OAuth & credential bridging
	•	Browser performs OAuth (PKCE) → API exchanges code with provider(s).
	•	API stores tokens encrypted; runner gets ephemeral run‑scoped credentials (JWT‑minted, short TTL) and injects provider tokens into the process env only for that run.
	•	Device or browser login? We’ll default to browser OAuth (your preference), but adapter can optionally support device code for providers that require it.

5.3 Runs, queueing, lifecycle
	•	States: queued → starting → running → (waiting_human_input?) → finishing → finished|failed|canceled|timed_out.
	•	Timeout default: 30 minutes (visible and editable per run).
	•	Retry: 1 automatic retry on exit codes in a small allow‑list (e.g., transient network).
	•	Cancel: send SIGINT; after 10s grace, SIGKILL.

5.4 Attach & terminal
	•	Multiple concurrent viewers can attach read‑only; one controller at a time (you).
	•	Keystrokes/lines are transmitted over WS as input events to the PTY.
	•	Input is logged as events for full auditability (single‑user now, still useful).

5.5 Workspaces & repos
	•	Each Project has an optional Workspace path on the runner host.
	•	Repo source: start with HTTPS clone (PAT provided via OAuth or pasted once), stored encrypted.
	•	Shared workspace by default (fast); runs may request a snapshot (copy) for isolation when using ensemble.
	•	File outputs: Agents may write files; the runner captures changed files as artifacts and optionally auto‑commit to a temp branch (off by default in v1).

5.6 Ensemble mode
	•	Create a Task with N agents + shared input.
	•	Runner snapshots workspace, fans out runs, then blocks on completion.
	•	UI shows a compare strip (artifacts or last N lines). You pick a winner; we can copy winner’s artifacts back to the shared workspace.

5.7 Notifications
	•	Web Push: start, finish, error, and human‑input requested.
	•	Per‑run toggle “watch” to suppress noise when desired.

5.8 Persistence & search (v1)
	•	Store all events, stdout/stderr chunks, artifacts, exit metadata, env summary.
	•	Basic filters: by agent, status, project, date.
	•	Full‑text search later (out of v1).

⸻

6) Non‑functional requirements
	•	Performance: Low‑latency streaming (<200ms typical round‑trip on WS). Virtualized log view supports 100k+ lines smoothly.
	•	Reliability: Runs survive web client reloads; server restarts should not orphan processes (PID tracking + graceful shutdown).
	•	Security:
  	•	Provider tokens encrypted at rest (DB) and never written to disk inside workspaces.
  	•	Run‑scoped tokens expire fast; minimal blast radius.
  	•	Network open by default (simplest) with a future toggle to restrict egress per project.
	•	Portability: Single binary/container deploy.
	•	Observability: Basic metrics: runs started/finished, failure rate, queue depth, avg runtime.

⸻

7) UI scope & flows

7.1 Main layout
	•	Left column: Run List
  	•	Filters: status, agent, project.
  	•	Each item: agent name, status pill, start time, duration, last message snippet.
	•	Right pane: Run Detail with tabs:
  	1.	Live: terminal stream + input box (Attach/Detach), quick actions (Cancel, Fork).
  	2.	Timeline: structured events (start, prompt, human_input, error, finish).
  	3.	Artifacts: downloadable files, diffs vs workspace (simple file list first).
  	4.	Config: agent, args, env summary, workspace snapshot used.
	•	Top bar actions: New Run, New Ensemble Task.

7.2 Compare view
	•	Lightweight side‑by‑side of either:
  	•	Final artifact list (with sizes) and link to open, or
  	•	Last N (configurable) lines of output.
	•	A “Choose winner” button writes back a note and (optionally) applies artifacts to workspace.

7.3 Mobile
	•	Same screens; left Run List collapses into a drawer.
	•	Terminal supports attach, input, cancel.
	•	Long logs: infinite scroll + jump to latest.
	•	Push notifications via service worker.

⸻

8) Data model (initial)
	•	Project: id, name, default agent, repo config (url, auth method), settings.
	•	Workspace: id, project_id, path, repo branch, last sync, dirty state.
	•	AgentAdapter: id, name, version, requires: [vars], defaults.
	•	Run: id, project_id, agent_id, status, start_at, end_at, exit_code, timeout_ms, retry_of, ensemble_task_id?, workspace_snapshot_id?.
	•	RunEvent: id, run_id, ts, type, payload (JSON), idx (monotonic).
	  •	Types (minimal): start, stdout, stderr, input, prompt, human_input_request, artifact_written, error, finish.
	•	Artifact: id, run_id, path, size, content_addr (object store key), mime_guess.
	•	Credential: id, provider, account_label, enc_payload, created_at, last_used_at.
	•	NotificationSubscription: id, user_id, endpoint, keys, created_at.
	•	EnsembleTask: id, project_id, spec_json, created_at, completed_at, winner_run_id?
	•	WorkspaceSnapshot: id, project_id, base_commit, created_at, diff_addr.

⸻

9) Run event format & logging
	•	Transport: WebSocket frames carry event envelopes: `{ runId, idx, ts, type, payload }`
	•	Log storage:
  	•	Stream to client in real time.
  	•	Also chunk stdout/stderr into object store at, say, 1–5 MB rotations.
  	•	DB keeps only indexes and summaries (first N chars for preview).
	•	Attach input events are stored (type=input) with a short payload and a pointer to the full text if large.

⸻

10) Adapter contract (for CLIs)

Goal: Minimal requirements so any CLI can participate.
	•	Process model: Spawn with PTY (so it can prompt, render progress, handle ANSI).
	•	Env injection: Runner provides provider secrets via env (PROVIDER_TOKEN=...) and run metadata (RUN_ID, WORKSPACE_DIR).
	•	Structured channel (preferred):
  	•	CLI may emit JSON Lines to stdout prefixed with a tag, e.g., @@JSON{...} or a dedicated side‑channel file descriptor if supported.
  	•	Recognized event kinds: prompt, human_input_request, artifact_written, metrics, finish.
	•	Fallback: If no structure, we still store raw text and try lightweight regex tagging (don’t block on it).

⸻

11) OAuth & secrets (minimal, safe defaults)
	•	Browser OAuth (PKCE) → server token exchange → encrypt at rest (DB).
	•	Run tokenization: On start, server mints a short‑lived JWT for the runner → runner resolves provider credentials from DB and injects into env.
	•	No secrets in artifacts; scrub obvious patterns from stored logs (basic redaction pass).

⸻

12) Queueing & concurrency
	•	Postgres queue using FOR UPDATE SKIP LOCKED.
	•	Concurrency limit configurable (default 5).
	•	Backoff: Exponential on transient failures; 1 retry max.
	•	Rate capping (per provider) is a simple limiter bucket you can tune later.

⸻

13) Deployment plan (simple)
	•	Single image/container with API + Runner.
	•	Postgres (managed or a container).
	•	Object store: S3 in cloud; MinIO locally.
	•	Reverse proxy/SSL (Caddy or Nginx).
	•	Backups: daily DB snapshot + object store lifecycle (no deletion in v1).

⸻

14) Observability & guardrails
	•	Metrics: runs by status, errors by adapter, average runtime, queue depth.
	•	Health checks: liveness/readiness; disk space alarms (logs/artifacts can grow).
	•	Auditing: Every input and state transition is an event.

⸻

15) Risks & mitigations
	•	Very long logs → UI jank
  	•	Mitigate: virtualized list, chunked fetch, “jump to latest,” and a quick “Summarize log” action later.  
	•	Provider auth variability
  	•	Mitigate: start with browser OAuth and an optional device flow per adapter if browser OAuth isn’t supported.
	•	Workspace corruption by buggy agents
  	•	Mitigate: default to shared workspace but allow easy snapshot per run (copy‑on‑write or rsync) and a “revert to last clean” button later.
	•	Secrets leakage in logs
  	•	Mitigate: basic redaction; option to mark events as non‑persisted (off by default).

⸻

16) What “done” means for v1
	•	Start, stream, attach, cancel, and fork runs for at least two real CLIs.
	•	Browser OAuth works; CLIs receive needed tokens headlessly.
	•	Repo checkout to a workspace; runs can write artifacts and you can download them.
	•	Ensemble of ≥2 agents runs in parallel from the same snapshot; compare & pick winner.
	•	PWA installs on phone; push notifications for start/finish/error/human‑input.
	•	Everything is persisted; you can reload any run with timeline + logs intact.
	•	Smooth scrolling with ≥100k log lines.

⸻

17) Nice‑to‑haves soon after v1 (not part of initial scope)
	•	Side‑by‑side diff viewer for code artifacts.
	•	Full‑text search over logs and artifacts.
	•	Simple workflow templates (“promote run config”).
	•	Per‑provider cost counters (estimates).
	•	Egress allow‑list per project.

⸻

18) Defaults I chose where you said “whatever”
	•	Timeout: 30 minutes soft; can be changed per run.
	•	Retry: 1 retry on specific exit codes (network/timeouts).
	•	Cancel: SIGINT → 10s → SIGKILL.
	•	Queue: Postgres‑backed; concurrency limit = 5.
	•	Quick action: Fork Run.
	•	Compare mode: Final artifacts or last 200 lines.
	•	Layout: Run List (left) + Tabbed Run Detail (right).
	•	Ensemble winner: manual selection only in v1.
	•	Transport: WebSocket (SSE fallback only if needed).
	•	Stack: TypeScript end‑to‑end; React (PWA) + Node API/Runner; Postgres + S3/MinIO.
	•	Isolation: OS process with PTY (no containers in v1).
	•	Network: open by default (agents rely on provider permissions).

⸻

19) Open questions (answer later; not blocking v1)
	•	Can your initial CLIs emit any structured markers (e.g., JSON lines or tagged prompts)? If yes, we’ll wire richer timeline events on day one.
	•	For repos, do you prefer we auto‑commit to a temp branch when artifacts change (off now), or keep everything uncommitted until you explicitly commit?
