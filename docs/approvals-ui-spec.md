# Approvals & Permission Requests — UI Spec

Status: Draft

## Overview

Surface and resolve agent permission requests (e.g., file writes) in the session UI with clear context, safe defaults, and an auditable trail. This spec focuses on handling `apply_patch_approval_request` events (e.g., when the agent attempts to write files) and the corresponding user decisions.

## Goals

- Make permission needs obvious and unblock the turn quickly.
- Show exactly what the agent intends to change (who, what, where, why).
- Offer granular approvals (one-time, session, scoped path) with safe defaults.
- Preserve an audit trail with timestamps and identifiers.
- Reduce confusion around worktree vs. repo and follow-ups like promoting changes.

## Non-Goals

- Designing server-side security policy semantics beyond UI integrations.
- Implementing non-patch approvals (e.g., network, long-running tasks) in this iteration; we’ll reuse the same patterns later.

## Triggers & Events

- Input event (from agent): `apply_patch_approval_request`
  - Includes: `call_id`, target path(s), diff preview (or summary), optional justification/preamble, and session worktree path (e.g., `.awrapper-worktrees/<session_id>/…`).
- Future (out of scope here but aligned): network/exec approvals, destructive ops, etc.

## UI Elements

1) Inline Approval Card (in the chat timeline)

- Summary: concise title, e.g., “Write access requested: create `docs/overview.md`”.
- Context: agent’s justification/preamble (first 1–2 lines); expandable for full message.
- Patch Preview: file tree + unified diff viewer with collapsible hunks.
- Target Destination: emphasize session worktree vs. repo; include full path and session id.
- Actions:
  - Approve once (default, safest)
  - Deny
  - Approve for session (applies to subsequent identical scopes in this session)
  - Always allow for this path/folder (scoped allowlist; requires explicit confirmation)
- Metadata: `call_id`, timestamp, and pending state badge; show a countdown tied to the turn timeout (e.g., `AWRAPPER_TURN_TIMEOUT_SECS`).

2) Global Pending Banner

- Sticky banner at top when there are any pending requests.
- Shows count and most recent request summary; clicking focuses the latest inline card.
- Provides quick Approve/Deny for the latest request and a “Review all” drawer button.

3) Policy Indicator

- Display current approval policy (e.g., Untrusted, On‑request, On‑failure, Never).
- Tooltip or link to settings modal for adjustments.
- Readonly if policy is enforced by environment; otherwise editable.

4) Audit Trail Entry

- After decision, append a compact event: Approved/Deny, scope (once/session/path), actor (you), timestamp, `call_id`.
- Link back to the original request card and keep the diff snapshot for posterity.

5) Safety Cues

- Highlight destination scope: session worktree vs. repo.
- Offer post-approval follow-up: “Promote to repo” (manual action that lifts changes from worktree into the repo via a separate patch step).
- Warn on broad approvals (e.g., path/folder always-allow): add an extra confirmation.

6) Batched Queue Drawer

- If multiple requests are pending, list them with brief summaries, latest first.
- Each item: file/folder, action type (add/update/delete), and quick Approve/Deny.
- Selecting an item scrolls to its inline card in the timeline.

## Interaction Flows

Happy path (single request):
1. Agent emits `apply_patch_approval_request` → inline card renders and banner appears.
2. User reviews summary/diff and clicks “Approve once”.
3. UI sends approval with `call_id` and scope `once`; card shows “Approved” with timestamp.
4. Turn continues; banner clears if no other pending items.

Multiple requests:
1. Each request renders a card; banner shows count.
2. User resolves via inline card or queue drawer.
3. Banner clears when the queue is empty.

Timeouts / no decision:
- Show a live countdown based on turn timeout. If the turn times out, mark the card as “Timed out” and allow retry.

Denied:
- Mark card as “Denied”; provide a “Retry” option (re-emit request) and an explanation area for the agent’s next turn.

Approved for session / allowlist:
- Upon choosing broader scopes, display a confirmation modal explaining impact and how to revoke later.

## States

- Pending: awaiting decision; actions enabled; countdown visible.
- Approved: show scope, approver, timestamp; lock actions; keep diff collapsed by default.
- Denied: show reason (if provided) and enable “Retry”.
- Timed out: show timeout info; enable “Retry”.

## Telemetry & Logging

- Log decisions with `call_id`, scope, timestamp, and actor.
- Track time-to-decision, number of requests per turn, and denial rate.
- Emit client debug logs when `?debug=1` is present; mirror to server via `POST /client-log`.

## Accessibility

- Keyboard navigation: focusable action buttons and diff sections; ARIA live region for new pending requests and banner updates.
- Color contrast for badges and states; do not rely solely on color.

## Performance

- Virtualize long diffs; collapse hunks by default for large files.
- Avoid re-render storms when multiple requests arrive; batch updates.

## Server Integration (minimal)

- Event: continue emitting `apply_patch_approval_request` with fields: `call_id`, `changes` (paths + content/diff), optional `justification`, and the canonical destination path (worktree path).
- Decision API: accept decisions referencing `call_id` with fields: `decision` (`approve` | `deny`), `scope` (`once` | `session` | `path`), optional `path` (for path scope), and optional `reason` (for deny).
- Result event: emit an `apply_patch_approval_result` (or reuse a generic result event) with the `call_id`, final status, and any errors.

Note: if the server already supports these semantics under different names, adapt the client to those names; this spec defines the UI contracts and expected behavior rather than enforcing a specific wire format.

## Open Questions

- Exact naming of result events and decision endpoints in the current server.
- Default scope when the user clicks the banner’s quick actions (recommend: once).
- Where to surface revocation UI for path/session allowlists (session settings vs. global settings).

## Future Work

- Extend pattern to network/exec approvals and destructive ops.
- Session-level policy presets (Safe, Balanced, Power user) with one-click toggles.
- Per-repo remembered trust decisions with clear revocation controls.

