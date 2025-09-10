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
  - Implementation: parse `git status --porcelain=v1 -z` and map entries.
  - Response (example):
    ```json
    {
      "head": "<commit>",
      "staged": [ { "path": "src/a.ts", "status": "M" } ],
      "unstaged": [ { "path": "src/b.ts", "status": "M" } ]
    }
    ```

- `GET /diff?path=...` (or `?all=1` to stream the whole repo diff sparingly)
  - Returns unified diff vs `HEAD` for a file (unstaged if present; else staged).
  - Implementation: `git diff -- unified` or `git diff --cached` as needed.

- `GET /file?path=...&rev=HEAD|worktree`
  - Returns file content from `HEAD` (via `git show`) or the worktree (via fs).

- `PUT /file`
  - Body: `{ path, content, stage?: boolean, expected_base_oid?: string, expected_mtime?: number }`
  - Writes new content to the worktree; optionally stages file. Reject on mismatch to avoid clobbering concurrent edits.

- `POST /git`
  - Body: `{ op: 'stage'|'unstage'|'discard'|'commit', paths?: string[], message?: string }`
  - `discard` resets paths to `HEAD` (`git checkout -- <paths>`); `commit` creates a commit in the worktree if desired (optional, might remain disabled initially).

Security/validation:
- Validate paths are under the session worktree.
- Rate‑limit and bound diff sizes.

## UI / Interaction Design

Pinned “Changes” panel in the Session page (similar to the Plan panel). Two sections:

- Proposed (pre‑write):
  - Render each `apply_patch_approval_request` from the trace with a diff/preview and concise summary.
  - Actions: Approve once, Deny, Approve for session, Approve for path (POST `/approvals` with `call_id`, `decision`, `scope`, `path`).
  - After approval, changes will be applied by the agent and then appear under Applied.

- Applied (uncommitted):
  - Tabs: Unstaged | Staged.
  - List changed files; expanding a file loads a merge/diff view (see Library) with accept/reject hunk controls and an editor for manual tweaks.
  - Actions per file: Save (PUT `/file`), Stage/Unstage (POST `/git`), Discard (POST `/git` op=discard). Bulk actions for selected files.
  - Auto‑refresh while a turn is running; manual refresh button otherwise.

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
- Performance: for large diffs, virtualize lists and stream per‑file diffs on demand.

## Approvals Interplay

- Before write: proposed changes card presents an auditable preview; user approves/denies.
- After write or pre‑granted: curated in Applied (Git) regardless of approvals policy; hunk‑level accept/reject is local and does not require agent approval.
- If the agent later emits an `apply_patch_approval_result` event, use it to trigger an immediate refresh of `/changes`.

## Edge Cases

- Non‑Git directories: Applied pane hidden; Proposed still works.
- Binary files: show metadata (size/hash) and offer Replace/Discard; skip merge UI.
- Renames: surface from porcelain status; show `renamed_from` in UI.
- Conflicts: if PUT `/file` detects `expected_base_oid`/mtime mismatch, prompt user to refresh and reapply decisions.

## Implementation Plan (Phased)

Phase 1 — Server + basic UI
- Add `/changes`, `/diff`, `/file` (GET/PUT) endpoints and validations.
- Render Changes panel with file lists for unstaged/staged and per‑file unified diff view (read‑only).

Phase 2 — Merge & controls
- Integrate CodeMirror Merge for per‑file hunk accept/reject and inline edits.
- Wire Save/Stage/Unstage/Discard actions.

Phase 3 — Polish & telemetry
- Turn‑scoped “since this turn” labels.
- Batch operations, keyboard shortcuts, and performance tuning.
- Optional commit action (guarded/hidden by default).

## References (current repo)

- Approvals endpoint: `src/server.ts:568`
- Log tail (events): `src/server.ts:514`
- Trace parsing (approvals/tools): `web/src/lib/agent-trace.ts:277`
- Session worktrees: `src/git.ts:18`

---

Open Questions
- Should we allow committing from the UI (off by default)?
- Where to surface a “Promote to repo” flow (lift from worktree to the main branch) if desired?
- Do we want server‑side diff generation for all files (`?all=1`) or keep it per‑file only to avoid large payloads?
