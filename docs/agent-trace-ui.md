# Agent Trace UI — Proposal

Goal: Surface an inline, collapsible timeline of what the agent did during each turn (reasoning, tools, tokens, result) without forcing users to open raw logs. Keep it collapsed by default, obvious to find, and show complete details when expanded.

## Event Model (from Codex proto JSONL)

Observed types in logs for session 84e481ec-5ae4-4d9a-8319-7a27d054596b:

- session_configured: session boot info (id/model/history ids).
- task_started: start of a run/turn.
- agent_reasoning_delta, agent_reasoning, agent_reasoning_section_break: streaming “thinking” and snapshots.
- agent_message_delta, agent_message: streaming and full assistant text.
- exec_command_begin, exec_command_output_delta, exec_command_end: tool/terminal usage with call_id, command, cwd, parsed_cmd, exit_code, duration, formatted_output.
- token_count: input/output/total (often multiple updates mid-run).
- task_complete: end-of-run sentinel.
- error: error surfaced from the agent/tooling.

Note: parsed_cmd inside exec_command_begin.msg.parsed_cmd carries typed intents like read, list_files, search; fall back to the literal command when unknown.

## Turn/Run Semantics

- Each user message is assigned a turn_id in our DB.
- We call sendUserInput(content, turn_id) so the run id sent to the agent equals that turn_id.
- All events for that turn share id === turn_id. task_started begins that run; task_complete ends it.
- If task_started is missing, the UI can fall back to grouping by the last event id (mirrors current non‑SPA behavior).

## UI Proposal (No‑Preview Principle)

Inline, per‑message timeline. Default collapsed; each item shows exactly one concise summary line. Expanding an item reveals the full content (not truncated) in a scrollable, formatted code box where applicable.

- Placement: For each assistant message in the Messages tab, render a “Trace” summary chip just above the message bubble (or in its header). Clicking opens a per‑turn timeline.
- Summary chip (collapsed-by-default):
  - Shows stats like: “Thinking • 3 tools • 1m 42s”.
  - Indicates status: Running, Succeeded, Failed, or Timed Out.
- Expand/Collapse controls per-trace
- Timeline items (ordered):
  - Reasoning: multiple sections delimited by `agent_reasoning_section_break`. Collapsed shows the section’s bold Markdown heading (first line `**...**`) when present; otherwise “Reasoning (N chars)”. Expanded shows full section text (pre‑wrap) with copy.
  - Tool Call: one item per call_id.
    - Collapsed line: “Tool • <intent> — <cmd> (exit <code> • <duration> • <lines> lines)”.
    - Expanded: full stdout/stderr (prefer formatted_output) in a scrollable mono box with copy. Stream interim output live until end.
    - Status chip: Running → Succeeded/Failed (exit_code) with duration.
  - Assistant Drafts: collapsed = “Draft response (streaming…)”; expanded = full accumulated deltas so far. Final assistant message ends this section.
- Error/Timeout treatment:
  - If await of task_complete times out, keep the trace visible with a “Timed out waiting for completion; showing partial trace” banner.
  - If error events occur, show a red status with the error message inline.

## Bottom Bar (tokens)

- Sticky status bar at the bottom of each message box showing the total token_count for the run

## Data Flow / Implementation Sketch

- Hook: useAgentTrace(sessionId)
  - Poll GET /sessions/:id/log?tail=800 (or ‘all’ when user requests).
  - Parse JSONL lines into events (reuse logic below).
  - Group events by run id (turn_id); identify the active run as the last task_started id (fallback to last event id if none).
  - Build a derived Trace object per run: { runId, status, startedAt?, completedAt?, tokens, reasoningSections: ReasoningSection[], assistantText, tools: ToolCall[] }.
  - ToolCall: { callId, command, parsedIntent, startedAt, endedAt, exitCode, durationMs, fullOutput }.

- Streaming behavior
  - While polling, merge new events by run id and call_id. For exec_command_output_delta, append decoded bytes to a buffer; for exec_command_end, finalize with formatted_output when present.
  - agent_reasoning_delta accumulates; agent_reasoning snapshot replaces prior accumulated text.
  - agent_message_delta accumulates; agent_message replaces accumulated message.
  - token_count keeps the most recent snapshot per run.

- SPA integration
  - Messages tab: for each assistant message, find its turn_id and attach the matching Trace summary + expandable timeline inline.

## Logic To Reuse From Old Non‑SPA Page (so we can delete it)

Source: src/server.ts client-side script embedded in the session HTML page.

- parseProtoEvents(text): split log text by newline, JSON.parse lines that look like JSON; pick msg.type and id.
- summarizeEvents(events):
  - Determine last run id: the id of the last task_started; fallback to last event id.
  - Filter to active run; accumulate reasoning from agent_reasoning_delta or agent_reasoning, message from agent_message_delta/agent_message, token_count snapshot, and collect “others”.
- renderTrace(section, info): builds a collapsed UI for Reasoning, Assistant, Other Events, and Raw JSON. We only need its parsing/summarization ideas; the SPA will render with our components and the no‑preview rule.

## Minimal Types (for the hook)

```ts
export type AgentTrace = {
  runId: string
  status: 'running' | 'success' | 'error' | 'timeout'
  startedAt?: number
  completedAt?: number
  tokens?: { input: number; output: number; total: number }
  reasoningSections: ReasoningSection[]
  assistant: string
  tools: ToolCall[]
}

export type ReasoningSection = {
  title?: string // extracted from leading **Bold** line when present
  text: string
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
  fullOutput?: string // prefer exec_command_end.formatted_output when present
}
```

## Defaults & UX Details

- Default collapsed; quick visual hint (chip) always visible next to messages.
- No previews: collapsed shows a 1‑line summary only; expanded shows full content in a scrollable code box with copy.
- Icons: Reasoning (light bulb), Tools (wrench/terminal), Assistant (message), Tokens (meter).
- Accessibility: details/summary or custom disclosure with aria-expanded; ensure live updates announce minimal changes.

## Collapsed Summary Generation Rules

- Reasoning sections
  - Detection: Use `agent_reasoning_section_break` to segment sections while streaming deltas. When an `agent_reasoning` snapshot arrives, replace the current section text with the snapshot.
  - Title extraction: If a section’s text begins with a line that matches `^\s*\*\*(.+?)\*\*\s*$`, use the captured text as the collapsed title (e.g., `**Summarizing codebase details**`).
  - Fallback: If no bold line, render “Reasoning (N chars)”.

- Tool calls
  - No explicit summary string in logs. Build a deterministic one‑liner from `exec_command_begin.msg.parsed_cmd`:
    - read → `read — <name>` (from `name` or the command string)
    - list_files → `list files — <path>`
    - search → `search — <query>` (append `in <path>` if present)
    - unknown → `exec — <command>`
  - Append result metadata once known: `(exit <code> • <duration> • <lines> lines)` using `exec_command_end` fields and line count from `formatted_output`.

- Assistant drafts/final
  - Draft: always `Draft response (N chars)` without content preview.
  - Final: `Assistant message (N chars)`.
