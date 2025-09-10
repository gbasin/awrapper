import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type PlanItem = { step: string; status: 'pending' | 'in_progress' | 'completed' }
export type PlanState = { items: PlanItem[]; explanation?: string; updatedAt?: number }

export type AgentTrace = {
  runId: string
  status: 'running' | 'success' | 'error' | 'timeout' | 'waiting_approval'
  startedAt?: number
  completedAt?: number
  tokens?: { input: number; output: number; total: number }
  reasoningSections: ReasoningSection[]
  assistant: string
  assistantSeq?: number
  tools: ToolCall[]
  errors: string[]
  approvals: ApprovalRequest[]
  plan?: PlanState
}

export type ReasoningSection = {
  title?: string
  text: string
  seq?: number
}

export type ParsedCmdEntry = {
  type?: 'read' | 'list_files' | 'search' | 'unknown' | string
  name?: string
  path?: string
  query?: string
  cmd?: string
}

export type ToolCall = {
  callId: string
  command: string
  parsedIntent?: 'read' | 'list_files' | 'search' | 'unknown'
  summaryLabel?: string
  cwd?: string
  startedAt?: number
  endedAt?: number
  exitCode?: number
  durationMs?: number
  fullOutput?: string
  seq?: number
}

export type ApprovalRequest = {
  callId: string
  changes: Record<string, any>
  justification?: string
}

type RawEvent = {
  id: string
  type: string
  msg: any
  raw: any
}

// Parse JSONL from proto logs into events
export function parseProtoEvents(text: string | undefined): RawEvent[] {
  const events: RawEvent[] = []
  if (!text) return events
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line[0] !== '{') continue
    try {
      const obj = JSON.parse(line)
      if (obj && typeof obj === 'object' && obj.msg && typeof obj.msg.type === 'string') {
        events.push({ id: obj.id || '', type: obj.msg.type, msg: obj.msg, raw: obj })
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return events
}

function extractTitleFromMarkdown(text: string): string | undefined {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const m = /^\s*\*\*(.+?)\*\*\s*$/.exec(firstLine)
  return m ? m[1] : undefined
}

function summarizeParsedCmd(parsed: any): { label: string; intent: ToolCall['parsedIntent'] } {
  const entries: ParsedCmdEntry[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
    ? [parsed]
    : []

  let primary = entries.find((e) => e?.type === 'read' || e?.type === 'list_files' || e?.type === 'search') || entries[0]
  const intent = (primary?.type as ToolCall['parsedIntent']) || 'unknown'
  let base = ''
  if (!primary) {
    base = 'exec —'
  } else if (intent === 'read') {
    base = `read — ${primary.name || primary.path || ellipsize(primary.cmd || '', 40)}`
  } else if (intent === 'list_files') {
    base = `list files — ${primary.path || ellipsize(primary.cmd || '', 40)}`
  } else if (intent === 'search') {
    const q = primary.query ? `'${primary.query}' ` : ''
    const p = primary.path ? `in ${primary.path}` : ''
    base = `search — ${q}${p}`.trim()
  } else {
    base = `exec — ${ellipsize(primary.cmd || '', 60)}`
  }
  if (entries.length > 1) base += ` +${entries.length - 1} cmds`
  return { label: `Tool • ${base}`, intent: intent || 'unknown' }
}

function ellipsize(s: string, n: number): string {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

export function useAgentTraces(sessionId: string) {
  // Always fetch the full log; build traces from complete history.
  const qAll = useQuery({
    queryKey: ['trace-log-all', sessionId],
    queryFn: () => api.tailLog(sessionId, 'all'),
    refetchInterval: 1500,
  })
  const events = useMemo(() => parseProtoEvents(qAll.data), [qAll.data])
  const traces = useMemo(() => buildTraces(events), [events])
  return { traces, isLoading: qAll.isLoading, error: qAll.error as any, refetch: qAll.refetch }
}

export function buildTraces(events: RawEvent[]): Map<string, AgentTrace> {
  const byRun = new Map<string, AgentTrace & { _toolMap: Map<string, ToolCall>; _reasoningIdx: number; _seq: number; _waitingApproval?: boolean }>()

  function ensure(runId: string): AgentTrace & { _toolMap: Map<string, ToolCall>; _reasoningIdx: number; _seq: number; _waitingApproval?: boolean } {
    let t = byRun.get(runId)
    if (!t) {
      t = {
        runId,
        status: 'running',
        startedAt: undefined,
        completedAt: undefined,
        tokens: undefined,
        reasoningSections: [],
        assistant: '',
        assistantSeq: undefined,
        tools: [],
        errors: [],
        approvals: [],
        plan: undefined,
        _toolMap: new Map(),
        _reasoningIdx: -1,
        _seq: 0,
        _waitingApproval: false,
      }
      byRun.set(runId, t)
    }
    return t
  }

  for (const e of events) {
    const runId = e.id || ''
    if (!runId) continue
    const t = ensure(runId)

    // If we were waiting for approval and any subsequent event arrives,
    // resume the run status back to running (until completion or error).
    if (t._waitingApproval && e.type !== 'apply_patch_approval_request') {
      t._waitingApproval = false
      if (t.status === 'waiting_approval') t.status = 'running'
    }

    switch (e.type) {
      case 'task_started': {
        t.startedAt = ts(e.raw?.ts) || t.startedAt
        t.status = 'running'
        break
      }
      case 'agent_reasoning_delta': {
        const delta = String(e.msg?.delta || '')
        if (t._reasoningIdx < 0) {
          t._reasoningIdx = t.reasoningSections.length
          t.reasoningSections.push({ text: delta, seq: ++t._seq })
        } else {
          t.reasoningSections[t._reasoningIdx].text += delta
        }
        // infer title if leading bold line appears
        const sec = t.reasoningSections[t._reasoningIdx]
        const title = extractTitleFromMarkdown(sec.text)
        if (title) sec.title = title
        break
      }
      case 'agent_reasoning_section_break': {
        t._reasoningIdx = -1
        break
      }
      case 'agent_reasoning': {
        const text = String(e.msg?.text || '')
        // Snapshot replaces the CURRENT section text, not all sections
        if (t._reasoningIdx < 0) {
          t._reasoningIdx = t.reasoningSections.length
          t.reasoningSections.push({ text, title: extractTitleFromMarkdown(text), seq: ++t._seq })
        } else {
          const keepSeq = t.reasoningSections[t._reasoningIdx]?.seq
          t.reasoningSections[t._reasoningIdx] = { text, title: extractTitleFromMarkdown(text), seq: keepSeq ?? ++t._seq }
        }
        break
      }
      case 'agent_message_delta': {
        // Accumulate draft text but don't place in timeline yet
        t.assistant += String(e.msg?.delta || '')
        break
      }
      case 'agent_message': {
        t.assistant = String(e.msg?.message || '')
        // Place assistant message near the end of the sequence; final position will be
        // adjusted again on task_complete to make it last.
        t.assistantSeq = ++t._seq
        break
      }
      case 'token_count': {
        const input = num(e.msg?.input_tokens)
        const output = num(e.msg?.output_tokens)
        const total = num(e.msg?.total_tokens) || (input && output ? input + output : undefined)
        t.tokens = input || output || total ? { input: input || 0, output: output || 0, total: total || (input || 0) + (output || 0) } : t.tokens
        break
      }
      case 'exec_command_begin': {
        const callId = String(e.msg?.call_id || '')
        if (!callId) break
        const label = summarizeParsedCmd(e.msg?.parsed_cmd)
        const startedAt = ts(e.raw?.ts)
        const tc: ToolCall = {
          callId,
          command: Array.isArray(e.msg?.command) ? String(e.msg.command.join(' ')) : String(e.msg?.command || ''),
          parsedIntent: label.intent || 'unknown',
          summaryLabel: label.label,
          cwd: e.msg?.cwd || undefined,
          startedAt: startedAt,
          fullOutput: '',
          seq: ++t._seq,
        }
        t._toolMap.set(callId, tc)
        t.tools.push(tc)
        break
      }
      case 'exec_command_output_delta': {
        const callId = String(e.msg?.call_id || '')
        const tc = t._toolMap.get(callId)
        if (!tc) break
        const chunk = typeof e.msg?.delta === 'string' ? e.msg.delta : decodeMaybeBase64(e.msg?.delta)
        tc.fullOutput = (tc.fullOutput || '') + (chunk || '')
        break
      }
      case 'exec_command_end': {
        const callId = String(e.msg?.call_id || '')
        const tc = t._toolMap.get(callId)
        if (!tc) break
        tc.exitCode = num(e.msg?.exit_code) ?? undefined
        tc.endedAt = ts(e.raw?.ts) || tc.endedAt
        const durMs = num(e.msg?.duration_ms)
        tc.durationMs = durMs ?? (tc.startedAt && tc.endedAt ? tc.endedAt - tc.startedAt : undefined)
        const formatted = e.msg?.formatted_output
        if (typeof formatted === 'string' && formatted.length) {
          tc.fullOutput = formatted
        }
        break
      }
      case 'error': {
        const msg = String(e.msg?.message || e.raw?.message || 'error')
        t.errors.push(msg)
        t.status = 'error'
        break
      }
      case 'task_complete': {
        t.completedAt = ts(e.raw?.ts)
        if (t.status !== 'error') t.status = 'success'
        // Ensure the assistant message appears last in the timeline
        if (t.assistant) t.assistantSeq = ++t._seq
        break
      }
      case 'apply_patch_approval_request': {
        const callId = String(e.msg?.call_id || '')
        const changes = (e.msg?.changes && typeof e.msg.changes === 'object') ? e.msg.changes : {}
        const justification = typeof e.msg?.justification === 'string' ? e.msg.justification : (typeof e.msg?.message === 'string' ? e.msg.message : undefined)
        if (callId) {
          t.approvals.push({ callId, changes, justification })
        }
        t._waitingApproval = true
        t.status = 'waiting_approval'
        break
      }
      case 'update_plan':
      case 'task_plan': {
        try {
          const arr = Array.isArray(e.msg?.plan) ? e.msg.plan : []
          const validStatus = new Set(['pending', 'in_progress', 'completed'])
          const items: PlanItem[] = []
          for (const it of arr) {
            const step = typeof it?.step === 'string' ? it.step : undefined
            const status = typeof it?.status === 'string' && validStatus.has(it.status) ? (it.status as PlanItem['status']) : undefined
            if (step && status) items.push({ step, status })
          }
          if (items.length > 0) {
            const explanation = typeof e.msg?.explanation === 'string' ? e.msg.explanation : undefined
            const updatedAt = ts(e.raw?.ts)
            t.plan = { items, explanation, updatedAt }
          }
        } catch {}
        break
      }
      default:
        // ignore others for now
        break
    }
  }

  // cleanup helpers
  const cleaned = new Map<string, AgentTrace>()
  for (const [k, v] of byRun.entries()) {
    const { _toolMap: _1, _reasoningIdx: _2, _seq: _3, ...rest } = v
    cleaned.set(k, rest)
  }
  return cleaned
}

function ts(x: any): number | undefined {
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}
function num(x: any): number | undefined {
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}
function decodeMaybeBase64(x: any): string {
  try {
    if (!x) return ''
    if (typeof x === 'string') return x
    if (x?.type === 'base64' && typeof x?.data === 'string') {
      // Prefer browser global atob; if missing, return empty without Node-specific types.
      const atobFn: ((s: string) => string) | undefined =
        (typeof atob === 'function' ? atob : undefined) ||
        (typeof globalThis !== 'undefined' && typeof (globalThis as any).atob === 'function' ? (globalThis as any).atob : undefined)
      if (atobFn) return atobFn(x.data)
    }
  } catch {}
  return ''
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  const mm = Math.floor(s / 60)
  const ss = s % 60
  if (mm > 0) return `${mm}m ${ss}s`
  return `${ss}s`
}
