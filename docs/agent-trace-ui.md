# Agent Trace UI — Proposal

Goal: Surface an inline, collapsible timeline of what the agent did during each turn (reasoning, tools, tokens, result) without forcing users to open raw logs, while retaining a Raw view for power users.

## Event Model (from Codex proto JSONL)

Observed types in logs for 84e481ec-5ae4-4d9a-8319-7a27d054596b:

- session_configured: session boot info (id/model/history ids).
- task_started: start of a run/turn.
- agent_reasoning_delta, agent_reasoning, agent_reasoning_section_break: streaming “thinking” and snapshots.
- agent_message_delta, agent_message: streaming and full assistant text.
- exec_command_begin, exec_command_output_delta, exec_command_end: tool/terminal usage with call_id, command, cwd, parsed_cmd, exit_code, duration, formatted_output.
- token_count: input/output/total (often multiple updates mid-run).
- task_complete: end-of-run sentinel.
- error: error surfaced from the agent/tooling.

Note: parsed_cmd items inside exec_command_begin.msg.parsed_cmd include typed intents like read, list_files, search; fall back to the literal command when unknown.

## Turn/Run Semantics (answering “task start vs complete is for a specific message?”)

- Yes. Each user message is assigned a turn_id in our DB.
- We call sendUserInput(content, turn_id) so the run id sent to the agent equals that turn_id.
- All events for that turn share id === turn_id. task_started begins that run; task_complete ends it.
- If task_started is missing for any reason, the UI can fall back to grouping by the last event id (we already do this in the non‑SPA HTML page).

## UI Proposal

Inline, per‑message timeline with global affordances. Default collapsed; easy to expand quickly.

- Placement: For each assistant message in the Messages tab, render a “Trace” summary chip just above the message bubble (or in its header). Clicking opens a per‑turn timeline.
- Summary chip (collapsed-by-default):
  - Shows stats like: “Thinking • 3 tools • 1m42s • 9.8k tokens”.
  - Indicates status: Running, Succeeded, Failed, or Timed Out.
- Expand/Collapse controls:
  - Per‑trace toggle plus a “Expand All”/“Collapse All traces” control at the top of the chat list.
- Timeline items (ordered):
  - Reasoning: preview of the first 150–220 chars; expand for full reasoning text (pre-wrap). Multiple reasoning sections appear as separate items.
  - Tool Call: one item per call_id, showing:
    - Header: Intent (from parsed_cmd type: read/list_files/search) + prominent command text.
    - Status chip: Running → Succeeded/Failed (exit_code) with duration.
    - Output: collapsed preview (first N lines); expand for full output; copy button. Stream interim output live.
  - Assistant Drafts: if agent_message_delta arrives before final message, show a “Draft response” preview (collapsed) that updates live; final message ends this section.
  - Token Snapshots: show latest token_count for the run in the timeline header; optionally small inline markers if helpful.
- Error/Timeout treatment:
  - If await of task_complete times out, keep the trace visible with a “Timed out waiting for completion; showing partial trace” banner.
  - If error events occur, show a red status with the error message inline.

## Bottom Bar (tokens)

- Sticky bottom status bar (visible on Session page) showing the latest token_count for the active run: input, output, total.
- Option: toggle to “All runs” to aggregate totals across the session; default to “Active run”.
- Keep concise; no cost math for now.

## Data Flow / Implementation Sketch

- Hook: useAgentTrace(sessionId)
  - Poll GET /sessions/:id/log?tail=800 (or ‘all’ when user requests).
  - Parse JSONL lines into events (reuse logic below).
  - Group events by run id (turn_id); identify the active run as the last task_started id (fallback to last event id if none).
  - Build a derived Trace object per run: { runId, status, startedAt?, completedAt?, tokens, reasoningText, assistantText, tools: ToolCall[] }.
  - ToolCall: { callId, command, parsedIntent, startedAt, endedAt, exitCode, durationMs, outputPreview, fullOutputAvailable }.

- Streaming behavior
  - While polling, merge new events by run id and call_id. For exec_command_output_delta, append decoded bytes to a buffer; for exec_command_end, finalize with formatted_output when present.
  - agent_reasoning_delta accumulates; agent_reasoning snapshot replaces prior accumulated text.
  - agent_message_delta accumulates; agent_message replaces accumulated message.
  - token_count keeps the most recent snapshot per run.

- SPA integration
  - Messages tab: per assistant message, find its turn_id and attach the matching Trace summary + expandable timeline.
  - Global “Agent Trace” tab or drawer is optional; inline traces should remove the need to open Logs for common cases.

## Logic To Reuse From Old Non‑SPA Page (so we can delete it)

Source: src/server.ts client-side script embedded in the session HTML page.

- parseProtoEvents(text): split log text by newline, JSON.parse lines that look like JSON; pick msg.type and id.
- summarizeEvents(events):
  - Determine last run id: the id of the last task_started; fallback to last event id.
  - Filter to active run; accumulate reasoning from agent_reasoning_delta or agent_reasoning, message from agent_message_delta/agent_message, token_count snapshot, and collect “others”.
- renderTrace(section, info): builds a collapsed <details> UI for Reasoning, Assistant, Other Events, and Raw JSON.

We should port parse and summarize to a React hook and render nicer UI with our design system.

## Minimal Types (for the hook)

```ts
export type AgentTrace = {
  runId: string
  status: 'running' | 'success' | 'error' | 'timeout'
  startedAt?: number
  completedAt?: number
  tokens?: { input: number; output: number; total: number }
  reasoning: string
  assistant: string
  tools: ToolCall[]
}

export type ToolCall = {
  callId: string
  command: string
  parsedIntent?: 'read' | 'list_files' | 'search' | 'unknown'
  cwd?: string
  startedAt?: number
  endedAt?: number
  exitCode?: number
  durationMs?: number
  outputPreview?: string
  fullOutput?: string // prefer exec_command_end.formatted_output when present
}
```

## Defaults & UX Details

- Default collapsed; quick visual hint (chip) always visible next to messages.
- Preview lengths: Reasoning 150–220 chars; Tool output 10–20 lines; offer “Show full output” with copy button.
- Icons: Reasoning (light bulb), Tools (terminal), Assistant (message), Tokens (meter).
- Keyboard: allow ‘e’ to expand/collapse focused trace; ‘c’ to copy output when tool item is focused.
- Accessibility: details/summary or custom disclosure with aria-expanded; ensure live updates announce minimal changes.

## Edge Cases

- Missing task_started: fallback grouping works, but mark trace as “inferred run”.
- Multiple concurrent turns: we gate one turn at a time; if this changes, include turn_id on message rows and link traces by turn_id directly.
- Huge logs: keep tail small by default; let user opt into “full log” mode as today.

## Open Questions / Next Steps

- How many lines for default tool output preview? (propose 15).
- Do we want a dedicated Trace tab in addition to inline traces? (Optional; can add later.)
- Add a small “Copied” toast + copy buttons on reasoning and tool outputs.
- Consider a compact “timeline bar” visualization across the run for at-a-glance phases.

-- End of proposal.
