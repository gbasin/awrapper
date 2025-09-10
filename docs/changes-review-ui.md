# In‑Progress Changes Review — UX Spec

Status: Draft

## Overview

Provide a single, consistent UX to review and control code changes during a session whether or not write approvals are required. Unify two sources of truth:
- Proposed changes: agent‑emitted `apply_patch_approval_request` events (pre‑write) for review/approval.
- Applied changes: uncommitted Git changes (staged + unstaged) in the session worktree after writes are allowed or already occurred.

This lets users review before writes when approvals are needed, and review/curate after writes when approvals are pre‑granted or unnecessary — all in one “Changes” panel.

## Goals

- Show a live list of modifications “in progress” per session.
- Support both workflows: with approvals and without (pre‑granted/disabled).
- Offer hunk‑level accept/reject and freeform edits for changed files.
- Keep operations scoped to the session worktree and safe.

## Non‑Goals

- Full Git client in the browser (rebase, branches, etc.).
- Persisting diffs beyond what Git already tracks.
- Designing long‑term policy semantics beyond existing approvals flow.

## Terminology

- Proposed changes: from agent events before writing (apply_patch requests).
- Applied changes: uncommitted diffs vs the worktree’s current `HEAD` (staged and unstaged).

## Data Sources & Events

- Agent events (JSONL in logs):
  - `apply_patch_approval_request` with `call_id` and `changes` map → proposed pre‑write content/diffs.
  - `exec_command_*`, `task_started`, `task_complete`, `agent_message*`, `token_count` → timeline context.
- Git state in the session worktree (`<repo>/.awrapper-worktrees/<session_id>`):
  - Unstaged + staged deltas vs current `HEAD` reflect applied in‑progress edits.

## Server API Additions

Add minimal endpoints under `/sessions/:id/*` that operate only within the worktree path stored in DB.

- `GET /changes`
  - Returns a snapshot of uncommitted changes with staged/unstaged breakdown.
  - Implementation: parse `git status --porcelain=v2 -z` and map entries (better rename/copy detection and robust quoting).
  - Response (example):
    ```json
    {
      "head": "<commit>",
      "staged": [ { "path": "src/a.ts", "status": "M" } ],
      "unstaged": [ { "path": "src/b.ts", "status": "R", "renamed_from": "src/old-b.ts" } ]
    }
    ```

- `GET /diff?path=...&side=worktree|index|head&context=3` (optional `?paths=...` for batching)
  - Returns unified diff vs `HEAD` for the requested side. Default `side=worktree`.
  - Implementation: `git diff --unified=<context> -- <path>` for worktree vs HEAD; `git diff --cached --unified=<context> -- <path>` for index vs HEAD. Serve metadata for binary files instead of text hunks.

- `GET /file?path=...&rev=head|index|worktree`
  - Returns file content from `HEAD` (via `git show`), the index (via `git show :path`), or the worktree (via fs).
  - Include an `etag` (content hash) in the response for optimistic concurrency.

- `PUT /file`
  - Body: `{ path, content, stage?: boolean, expected_etag?: string, expected_head_oid?: string, expected_index_oid?: string }`
  - Writes new content to the worktree; optionally stages file. Reject when `expected_*` do not match to avoid clobbering concurrent edits.

- `POST /git`
  - Body: one of
    - `{ op: 'stage', paths: string[] }`
    - `{ op: 'unstage', paths: string[] }`
    - `{ op: 'discardWorktree', paths: string[] }` (uses `git restore --worktree`)
    - `{ op: 'discardIndex', paths: string[] }` (uses `git restore --staged`)
    - `{ op: 'commit', message: string }` (feature-flagged; disabled by default)

Security/validation:
- Validate paths are under the session worktree using `realpath` prefix checks.
- Block following or writing through symlinks (always blocked; no override).
- Rate‑limit and bound diff sizes, file sizes, and request durations.
- Default limits (tunable): per-file diff ≤ 500 KB; total diff payload ≤ 2 MB; max changed files listed = 200; server timeout per diff = 2s.
- Preflight checks for Promote/PR: verify remote exists, default branch detection, ahead/behind state, and `gh` availability (when selected). Provide graceful fallbacks.

## UI / Interaction Design

Pinned “Changes” panel in the Session page (similar to the Plan panel). Two sections:

- Proposed (pre‑write):
  - Render each `apply_patch_approval_request` from the trace with a diff/preview and concise summary.
  - Actions: Approve once, Deny, Approve for session, Approve for path (POST `/approvals` with `call_id`, `decision`, `scope`, `path`).
  - After approval, changes will be applied by the agent and then appear under Applied.

- Applied (uncommitted):
  - Tabs: Unstaged | Staged.
  - List changed files; expanding a file loads a merge/diff view (see Library) with accept/reject hunk controls and an editor for manual tweaks.
  - Side toggle: Worktree | Index | HEAD for clarity and predictability.
  - Actions per file: Save (PUT `/file`), Stage/Unstage (POST `/git`), Discard (POST `/git` with `discardWorktree`/`discardIndex`). Bulk actions for selected files.
  - Auto‑refresh while a turn is running; manual refresh button otherwise. Add filter: “Only new since this turn”.
  - Promote to repo (feature-flagged primary header action): opens a Dry Run Summary modal before performing any operations.

Dry Run Summary (modal before Promote)
- Shows: staged files (count, sizes), diff summary (insertions/deletions), proposed commit message (editable or link to open composer), suggested branch name, target base branch, remote name, PR title/body preview, and whether PR is draft.
- Preflight results: remote present, branch state (ahead/behind/diverged), auth/`gh` availability when selected; surface fixes or fallback to compare URL.
- Safety: no writes until confirm. Primary action “Promote” runs commit → branch create/switch (if needed) → push → create PR; secondary actions “Back to changes” and “Cancel”.

Per‑turn context:
- When `task_started` appears, snapshot the current file list in the client; annotate newly changed files as “since this turn”. This requires no extra server state.

Empty states:
- If not a Git repo (or `use_worktree=false` without git): hide Applied section; show info banner “Git not detected; only proposed changes are available.”

## Library Choice for Diff/Merge

Recommended: CodeMirror 6 Merge (merge view)
- Pros: built‑in 2‑/3‑way merge UI, per‑hunk accept/reject, editable result, light footprint, easy React integration.
- Usage: show base=HEAD vs current=worktree; accept/reject copies from base→current (or vice versa) and writes result via PUT `/file`.

Alternatives:
- Monaco Diff: excellent editor; lacks first‑class accept/reject UI; heavier integration.
- react-diff-view / react-diff-viewer: strong diff components; requires wiring hunk apply logic (via unidiff/jsdiff) and an editor yourself.
- diff2html: view‑only; no accept/reject.

Decision: Start with CodeMirror Merge for hunk‑level control + manual edits.

## Git Semantics & Invariants

- Baseline: current `HEAD` of the session worktree. Users typically won’t commit in the session; if they do, diffs remain relative to the new `HEAD` (acceptable for v1). Optional: display initial HEAD in the panel header.
- Scope: operate only on uncommitted changes. We’re not rewriting history.
- Explicit sides: when showing diffs, prefer an explicit side (worktree/index/head) rather than auto-picking unstaged vs staged.
- Performance: for large diffs, virtualize lists and stream per‑file diffs on demand; cap payload sizes.

## Approvals Interplay

- Before write: proposed changes card presents an auditable preview; user approves/denies.
- After write or pre‑granted: curated in Applied (Git) regardless of approvals policy; hunk‑level accept/reject is local and does not require agent approval.
- If the agent later emits an `apply_patch_approval_result` event, use it to trigger an immediate refresh of `/changes`.

## Edge Cases

- Non‑Git directories: Applied pane hidden; Proposed still works.
- Binary files: show metadata (size/hash) and offer Replace/Discard; skip merge UI. Surface `isBinary`, `size`, and `sha` in `/diff`.
- Renames: surface from porcelain status; show `renamed_from` in UI.
- Conflicts: if PUT `/file` detects `expected_*` mismatch, prompt user to refresh and reapply decisions.
- Symlinks: do not write through symlinks by default; show a warning banner if encountered.

## Implementation Plan (Phased)

Phase 1 — Server + basic UI
- Add `/changes`, `/diff`, `/file` (GET/PUT) endpoints and validations. Use porcelain v2 and explicit `side`/`rev` params.
- Render Changes panel with file lists for unstaged/staged and per‑file unified diff view (read‑only).

Phase 2 — Merge & controls
- Integrate CodeMirror Merge for per‑file hunk accept/reject and inline edits.
- Wire Save/Stage/Unstage/Discard actions using `git restore`.

Phase 3 — Commits (feature-flagged)
- `POST /git op=commit` behind a feature flag; commit staged changes only. Commit composer UI with templates.
- Optional: create/switch branch helpers for isolation.

Phase 4 — Push + PR (feature-flagged)
- Detect remote and auth. Provide push via `git push` and PR creation via `gh pr create` when available (preferred). Fallback to opening a hosted compare URL. Add Octokit REST later as an additional option.
- Minimal PR body template that can include a link to the session transcript.
- “Promote to repo” one-click flow (header action in Applied panel): orchestrates commit → branch create/switch (if needed) → push → open PR to default branch.
  - Includes a required Dry Run Summary modal (see UI section) with preflight checks and edit affordances before execution.

Phase 5 — Polish & telemetry
- Turn‑scoped “since this turn” labels and “Only new since this turn” filter.
- Batch operations, keyboard shortcuts, virtualization, size/time caps, and instrumentation.

## Acceptance Criteria & Test Plan

Acceptance is scoped per phase, with hard pass/fail checks and a minimal test suite outline. Server tests use Vitest and Fastify’s inject; Git interactions run against temporary repos.

Acceptance (Phase 1 — Server + basic UI)
- Changes listing: `GET /sessions/:id/changes` returns `{ head, staged[], unstaged[] }`; when a rename exists, the entry includes `renamed_from`. Non‑Git worktrees return `{ gitAvailable:false }` with empty arrays.
- Diff retrieval: `GET /sessions/:id/diff?path=...&side=worktree|index|head` returns unified text diff when text; returns `{ isBinary:true, size, sha }` when binary. Default side is `worktree`. `context` param adjusts hunk context.
- File retrieval: `GET /sessions/:id/file?path=...&rev=head|index|worktree` returns `{ content, etag }`. Unknown path or rev returns 404.
- Limits: Requests exceeding caps (per‑file diff > 500 KB or total payload > 2 MB) return 413 with a concise error body.
- Path safety: Requests attempting path traversal or outside worktree return 400; symlink targets are rejected (400).
- UI lists: The Changes panel renders Proposed cards from trace and Applied lists from `/changes`; per‑file read‑only diff loads on expand; “Only new since this turn” filter hides older entries when toggled.

Acceptance (Phase 2 — Merge & controls)
- Hunk controls: Merge view supports accept/reject; saving writes combined result via `PUT /file` and refreshes diff.
- Stage/Unstage/Discard: `POST /git` with `op=stage|unstage|discardWorktree|discardIndex` updates `/changes` accordingly.
- Concurrency safety: `PUT /file` with stale `expected_etag` (or OIDs) returns 409; UI shows a refresh affordance.

Acceptance (Phase 3 — Commits, feature‑flagged)
- Feature flag off: commit UI and API are hidden/disabled by default; attempts to call commit op return 404/400.
- Commit path: with flag on, `POST /git { op:'commit', message }` creates a commit for staged files only; `/changes` becomes empty or reflects remaining unstaged edits.

Acceptance (Phase 4 — Push + PR, feature‑flagged)
- GH‑first PR: when `gh` CLI is available, “Create PR” uses `gh pr create`; on absence/failure, a compare URL opens.
- Promote flow: “Promote to repo” opens Dry Run Summary; confirm performs commit→branch create/switch if needed→push→PR to default branch. No writes occur before confirm.

Acceptance (Phase 5 — Polish & telemetry)
- Performance: large file lists use virtualization; UI remains responsive with 200 changed files and 2 MB diff cap.
- Telemetry: server logs include op, session id, latency, result (success/error) for `/changes`, `/diff`, `/file`, and `/git`.

Security Acceptance
- Realpath prefix checks enforce containment in worktree; all symlink writes are blocked. Attempts are logged and return 400.
- Rate limits and body size limits applied to write endpoints (`PUT /file`, `POST /git`).

Test Plan (Vitest)
- Server unit tests
  - `git porcelain v2` parser: parse rename, modify, delete, intent‑to‑add; robust quoting with special chars.
  - Path guards: traversal (`..`), absolute paths, symlink targets → 400.
  - Binary detection: `/diff` returns `{ isBinary:true, size, sha }` for binary files.
  - Limits: large diffs and payloads return 413.
- Server integration tests (Fastify inject)
  - Temp repo fixture: init repo, create commits, branches, renames, staged vs unstaged changes.
  - `/changes`: correct staged/unstaged classification; rename surfaces `renamed_from`.
  - `/diff`: side switching (worktree/index/head) and `context` param; HEAD and index retrievals.
  - `/file`: returns `etag`; `PUT /file` succeeds with matching `expected_etag` and returns 409 on mismatch; `stage:true` stages the file.
  - `/git`: stage/unstage/discardWorktree/discardIndex behaviors reflect in `/changes`.
- UI tests (lightweight)
  - Component tests with mocked fetch: Proposed cards render from synthetic trace; Applied list renders from `/changes` snapshot; side toggle switches rendered diff source; “Only new since this turn” filter works.
  - Merge view: accept/reject toggles call `PUT /file` with expected payload shape (mocked); stage/unstage buttons call `POST /git`.
- E2E (required)
  - Playwright end-to-end flows run in CI and gate merges. Cover at minimum:
    - Phase 1: view Proposed and Applied lists; open per-file diff; toggle side; “Only new since this turn” filter.
    - Phase 2: accept/reject hunks; save; stage/unstage/discard; verify changes reflect in UI and Git state.
    - Phase 3 (flagged on in test env): commit staged changes; verify `/changes` empties or reflects remaining unstaged.
    - Phase 4 (flagged on in test env): Promote with Dry Run Summary confirmation; branch create/switch if needed; push; PR creation via `gh` or compare URL fallback (mock tokens/CLI as needed).
  - Provide a lightweight mock Git remote and stub `gh` when running in CI to avoid network.

Fixtures & Utilities
- Temp Git repo helper: creates a repo in a temp directory, exposes helpers to create/modify files, stage/commit, and compute expected HEAD/index OIDs.
- Binary fixture: small binary blob (e.g., PNG) to verify `/diff` binary handling.
- Large diff generator: utility to create files large enough to trigger limits.

## References (current repo)

- Approvals endpoint: `src/server.ts:568`
- Log tail (events): `src/server.ts:514`
- Trace parsing (approvals/tools): `web/src/lib/agent-trace.ts:277`
- Session worktrees: `src/git.ts:18`

---

Decisions
- Promote to repo: surface as a primary action in the Applied section header (Changes panel), grouped with Commit and PR (feature-flagged). Also mirror in the session header overflow menu. Flow: commit (staged-only) → create/switch branch if detached → push → open PR to default branch.
- PR creation: prefer `gh pr create` when the GitHub CLI is available; fallback to opening a compare URL. Add Octokit REST support later. Provider priority: GitHub first.
- Limits (defaults; tunable via env/config): per-file diff ≤ 500 KB, total diff payload ≤ 2 MB, maximum listed changed files = 200, server timeout per diff = 2s.
- Symlinks: always block edits through symlinks (no override). Show a non-blocking warning in the UI when encountered.
- Promote flow requires a Dry Run Summary modal with preflight checks and previews; no side effects until confirm.
