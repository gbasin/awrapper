# PRD v1: Architecture & Requirements (Simplified)

## Guiding Decision
- Do not stream raw PTY bytes to the UI. The runner keeps the PTY locally, post‑processes output into a normalized event stream, and sends events to the client over WebSocket. Attach/detach and input are preserved; the browser avoids terminal fidelity complexity.

## Goals
- Run and attach to interactive CLI agents with real‑time streaming.
- Manage multiple parallel runs with lightweight queuing and timeouts.
- Persist runs, logs, and artifacts with simple, durable storage.
- Provide a mobile‑friendly PWA with snappy, virtualized log viewing.
- Support simple “ensemble” tasks (run N agents in parallel, compare, pick a winner).

## Non‑Goals (v1)
- Team roles/approvals, CI/GitHub integrations, advanced viewers, GPUs/VM isolation.
- Full terminal emulation in the browser; no raw PTY passthrough.

## Architecture Overview

### Web App (PWA, React/TypeScript)
- Connects via WebSocket for live run updates.
- Virtualized “Live Output” viewer (not a TTY); input box sends text to the run.
- Service worker for push notifications and basic offline shell.

### API + Runner (TypeScript)
- API exposes REST + WebSocket; issues short‑lived run tokens; persists metadata; proxies attach input.
- Runner spawns each agent CLI as an OS process with a PTY. It normalizes stdout/stderr (strip/annotate ANSI, collapse carriage‑return updates, optional color tags), performs light redaction, and emits a derived event stream to the API/UI.
- Simple queue limits concurrency (e.g., ~5), applies default timeout, and retries once on known transient exits.

### Storage
- Postgres for runs, minimal event indexes, settings, and credentials.
- S3‑compatible object store (MinIO in dev) for raw log chunks and artifacts.

### Deployment
- Single service, single box/container, CPU‑only. No k8s required for v1.

## Core Requirements

### Runs & Concurrency
- States: queued → starting → running → finishing → finished | failed | canceled | timed_out.
- Default timeout (e.g., 30m). Single retry on obvious transient failures.
- Attach/detach at any time for live runs; input proxied in line‑mode initially.

### Streaming & Attach (Derived Events)
- Runner buffers PTY output to lines or timed flush (e.g., 100–250 ms), strips/normalizes ANSI, collapses CR progress updates, and sends events over WebSocket with monotonic ordering.
- UI renders a live, virtualized text stream; no terminal cursor control or alt‑screen support.
- For adapters that output structured markers (e.g., tagged JSON lines), pass through as structured events; otherwise treat as plain text.

### Adapters (Minimal Contract)
- External CLI first: runner calls spawn(cmd, args, env, cwd) with a PTY.
- Env injection: runner provides provider tokens and run metadata via environment variables for the lifetime of the run.
- Prefer structured side‑channel via tagged lines when available; fallback to text.
- TUIs discouraged: set safe defaults (`TERM=dumb`, `NO_COLOR=1`) to minimize TUI behavior.

### Persistence
- Stream to client in real time.
- Append full raw stdout/stderr to object storage in rotating chunks (e.g., 1–5 MB). Database keeps only indexes and short previews for search/list views.
- Keep all runs, events, and artifacts indefinitely (subject to ops policy later).

### Artifacts
- Runner records files produced by agents as artifacts with paths, sizes, and object keys. UI lists and downloads artifacts; diff/preview can come later.

### Security & Auth
- Browser OAuth (PKCE). API exchanges and encrypts provider tokens at rest.
- On run start, server mints ephemeral, run‑scoped credentials; runner injects provider tokens into the process env only for that run.
- Basic redaction pass on logs to reduce accidental secret leakage.

### Notifications & Mobile
- Web Push for start/finish/error and “human input requested”.
- Mobile parity for start/attach/cancel/fork, with smooth scrolling of large logs.

### Observability
- Minimal metrics: runs started/finished, failure rate, queue depth, average runtime.

## UI Outline
- Run List (left): filterable by status/agent/project; shows status, start time, duration, and last message snippet.
- Run Detail (right, tabs):
  - Live: live output stream (not a full terminal) + input box; quick actions (Cancel, Fork, Attach/Detach).
  - Timeline: structured milestones (start, prompts, human input requests, errors, finish).
  - Artifacts: list and download.
  - Config: agent, args/env summary, workspace snapshot pointer.
- Compare View (optional v1): side‑by‑side of final outputs or last N lines; select a winner for ensemble runs.

## Key Trade‑offs
- Simplicity and reliability over fidelity: by not transporting raw PTY to the browser, we avoid terminal emulation edge cases, reduce bandwidth, and improve mobile UX while preserving interactivity for typical agent CLIs.
- Debugging preserved: full raw logs are stored as artifacts for deep inspection, even if the UI shows normalized text.

## Upgrade Path
- v1.1: optional color tags in events and UI rendering; richer artifact previews.
- v1.2: opt‑in raw PTY passthrough for specific adapters behind a feature flag if truly needed.

## Risks & Mitigations
- TUIs/curses and dynamic progress bars render poorly in text streams: discourage via env defaults; collapse CR updates; link to raw logs for fidelity.
- Secret leakage in output: apply conservative redaction patterns; allow per‑adapter redaction hooks.

## Open Questions
- Minimal adapter registry format and discovery mechanism.
- Policy for log retention/pruning beyond “keep everything”.
- Exact retryable exit codes and transient failure heuristics.
