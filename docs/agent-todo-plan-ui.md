# Agent TODO Plan (update_plan) — Spec & Implementation Plan

Status: Draft

## Overview

Expose the agent’s self‑managed TODO list (aka task plan) as a pinned component in the session UI. Codex emits structured plan updates during larger tasks; we should detect those events from the agent trace and surface the current plan prominently above the transcript, updating live as the agent progresses.

## Goals

- Detect and parse plan updates from the Codex proto JSONL trace.
- Pin a compact “Task Plan” component above the chat messages showing step statuses.
- Update live as the agent modifies the plan; highlight the in‑progress step.
- Preserve per‑turn plan context (plans belong to a single run/turn).
- Degrade gracefully if no plan events are present.

## Non‑Goals

- Persisting plans separately in the DB (derive from logs only).
- Manual editing of the agent’s plan in the UI.
- Designing a cross‑agent plan API (start with Codex proto; generalize later).

## Event Contract (assumed)

Codex proto emits a line‑delimited JSON event when the plan is created or updated. Shape mirrors the CLI’s plan tool semantics:

```json
{ "id": "<run-id>", "msg": {
  "type": "update_plan",
  "explanation": "optional short note",
  "plan": [
    { "step": "Write the API spec", "status": "completed" },
    { "step": "Update backend",       "status": "in_progress" },
    { "step": "Implement frontend",    "status": "pending" }
  ]
}}
```

Notes:
- Exactly one step is in_progress at a time.
- Steps are ordered; status ∈ { pending | in_progress | completed }.
- Later events replace the current plan for that run (treat as last‑writer‑wins snapshot).

If future builds use a different type name (e.g., task_plan), we will map both to the same handler.

## Current Behavior (baseline)

- SPA (web) ignores unknown event types entirely in `web/src/lib/agent-trace.ts`. No plan is visible.

## UI Design

Pinned Task Plan panel above messages in the session view. Auto‑appears when the latest run has a plan.

- Header: “Task Plan” + status pills: Completed N / In Progress 1 / Pending M.
- Body: ordered list of steps with status icons/colors.
  - completed: checkmark, muted text.
  - in_progress: spinner (live when the run is active), bold text.
  - pending: hollow circle, normal text.
- Optional explanation: small, muted line under the header when present.
- Live updates: replace the list when an `update_plan` event arrives for the active run.
- Collapse/expand: default expanded while a run is active; collapsible thereafter and remembered per session via localStorage.

Placement rules:
- Show the plan for the active running turn if present.
- Otherwise show the plan from the most recent completed turn that had a plan.
- Also echo plan updates inside the per‑message Trace timeline as a small “Plan updated” marker (optional v2).

Accessibility:
- Use list semantics and aria‑live polite for status changes.
- Ensure color is not the only status cue (icons + labels).

## Data Model (client derived)

Extend `AgentTrace` to carry the latest plan snapshot for that run:

```ts
export type PlanItem = { step: string; status: 'pending' | 'in_progress' | 'completed' }
export type PlanState = { items: PlanItem[]; explanation?: string; updatedAt?: number }

// in AgentTrace
plan?: PlanState
```

Update rules:
- On `update_plan`, set `trace.plan = { items, explanation, updatedAt: ts(e.raw?.ts) }`.
- Discard empty/invalid payloads; keep the previous valid snapshot.

## Implementation Plan

1) Parse plan events
- File: `web/src/lib/agent-trace.ts`
- Add handler for `update_plan` (and alias `task_plan` if it appears), validating:
  - `Array.isArray(e.msg?.plan)` and every entry has a string `step` and valid `status`.
  - Optional `explanation` string.
  - Set `t.plan = { items, explanation, updatedAt }`.

2) Pinned Plan component
- File: `web/src/routes/Session.tsx`
- Compute the “current plan”:
  - Prefer a running trace with a plan, else the most recent completed trace with a plan.
- Render `<PlanPinned plan={...} status={trace.status} />` above the messages ScrollArea.
- Persist collapsed state per session id in localStorage.

3) Timeline marker (optional, v2)
- File: `web/src/components/trace/TraceView.tsx`
- Optionally show small, timestamped “Plan updated” entries inside the trace when a plan update arrives (use `seq`).

4) Legacy page fallback (low effort)
- File: `src/server.ts` client script
- In `renderTrace`, detect `update_plan` in `info.others` and render a compact plan list above “Other Events”.

5) Testing
- Unit: add tests for `buildTraces` to ensure `update_plan` produces `trace.plan` and that later updates replace earlier ones.
- Manual: with real Codex CLI:
  - Ensure `OPENAI_API_KEY` is exported in the server’s environment.
  - Start the server (`pnpm dev`) and open a new session.
  - Prompt example: “This will take several steps. Maintain a TODO plan and update it as you go using your plan tool.”
  - Confirm plan events appear in `~/.awrapper/logs/session-<id>.log` and that the pinned plan updates live.
- Fallback: if an API key isn’t available, create a dev stub that emits an `update_plan` line in the session log to exercise the UI.

## Telemetry & Logging

- None required server‑side; continue to read JSONL logs.
- Client: include debug console logs behind `?debug=1` when plan UI appears/updates.

## Open Questions -> Answers

- Scope: Should the pinned plan show only for the active turn, or persist the last known plan until a new run starts? (Proposed: persist last known, dim when not running.) -> Persist
- History: Do we need to show prior plan snapshots (a changelog), or only the latest? (Proposed: only latest for now.) -> Latest
- Placement: Above entire transcript vs. above the latest assistant message. (Proposed: above entire transcript to make it discoverable.) -> at bottom of transcript
- Threshold: Always show when present, or only when there are ≥2 steps? (Proposed: always show.) -> always
- Cross‑agent: If other agents later emit plan events with different shapes, do we normalize or show raw? (Proposed: normalize per agent with adapters.) -> normalize

## Rollout

- Phase 1: Parser + pinned plan + legacy fallback.
- Phase 2: Timeline markers + plan diff highlighting (changed steps/statuses).
- Phase 3: Session settings to hide/pin plan and small style refinements.

## Appendix: Sample Events

```json
{"id":"<run>","msg":{"type":"task_started"}}
{"id":"<run>","msg":{"type":"update_plan","explanation":"Large task; tracking steps","plan":[
  {"step":"Scan repo","status":"completed"},
  {"step":"Implement feature","status":"in_progress"},
  {"step":"Write tests","status":"pending"}
]}}
{"id":"<run>","msg":{"type":"agent_message","message":"Working on step 2…"}}
{"id":"<run>","msg":{"type":"update_plan","plan":[
  {"step":"Scan repo","status":"completed"},
  {"step":"Implement feature","status":"completed"},
  {"step":"Write tests","status":"in_progress"}
]}}
{"id":"<run>","msg":{"type":"task_complete"}}
```

---

Notes from current logs: Existing sessions under `~/.awrapper/logs/` show no `update_plan` entries yet; plan UI will remain hidden until Codex emits these events. Use the manual test flow above to validate with a multi‑step prompt.

