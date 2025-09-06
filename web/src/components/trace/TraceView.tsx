import { useMemo, useState } from 'react'
import { AgentTrace, ToolCall, ReasoningSection, formatDuration } from '../../lib/agent-trace'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { CodeBlock } from '../ui/code-block'
import { cn } from '../../lib/utils'
import { Copy, Lightbulb, MessageSquareText, Wrench } from 'lucide-react'
import { toast } from 'sonner'

export function TraceView({ trace, className }: { trace: AgentTrace; className?: string }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => buildSummary(trace), [trace])

  return (
    <div className={cn('rounded border bg-white', className)}>
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Badge variant={trace.status === 'running' ? 'warning' : trace.status === 'success' ? 'success' : trace.status === 'error' ? 'destructive' : 'secondary'}>
            {trace.status === 'running' ? 'Running' : trace.status === 'success' ? 'Succeeded' : trace.status === 'error' ? 'Failed' : 'Timed out'}
          </Badge>
          <span>{summary}</span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide trace' : 'Show trace'}
        </Button>
      </div>
      {open && (
        <div className="border-t">
          <div className="max-h-96 overflow-y-auto p-2 space-y-2 bg-slate-50">
            <Timeline trace={trace} />
            {trace.errors.length > 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                <div className="font-medium">Errors</div>
                {trace.errors.map((e, i) => (
                  <div key={i} className="whitespace-pre-wrap">{e}</div>
                ))}
              </div>
            )}
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white px-2 py-1 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>Tokens:</span>
              {trace.tokens ? (
                <span>
                  input {trace.tokens.input} • output {trace.tokens.output} • total {trace.tokens.total}
                </span>
              ) : (
                <span className="text-slate-400">n/a</span>
              )}
            </div>
            <div className="text-slate-400">run {trace.runId.slice(0, 8)}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildSummary(t: AgentTrace): string {
  const parts: string[] = []
  if (t.reasoningSections.length > 0) parts.push('Thinking')
  if (t.tools.length > 0) parts.push(`${t.tools.length} tools`)
  const dur = (t.completedAt || Date.now()) - (t.startedAt || Date.now())
  if (t.startedAt) parts.push(formatDuration(dur))
  return parts.join(' • ')
}

function Timeline({ trace }: { trace: AgentTrace }) {
  const items = useMemo(() => {
    const arr: Array<{ kind: 'reasoning'; section: ReasoningSection } | { kind: 'tool'; tool: ToolCall } | { kind: 'assistant'; text: string; seq: number }> = []
    for (const s of trace.reasoningSections) arr.push({ kind: 'reasoning', section: s })
    for (const t of trace.tools) arr.push({ kind: 'tool', tool: t })
    if (trace.assistant) arr.push({ kind: 'assistant', text: trace.assistant, seq: trace.assistantSeq || Number.MAX_SAFE_INTEGER })
    return arr.sort((a, b) => (getSeq(a) - getSeq(b)))
  }, [trace])
  return (
    <div className="space-y-1">
      {items.map((it, i) => (
        it.kind === 'reasoning' ? (
          <ReasoningItem key={`r-${i}`} section={it.section} />
        ) : it.kind === 'tool' ? (
          <ToolItem key={it.tool.callId} tool={it.tool} />
        ) : (
          <AssistantItem key={`a-${i}`} text={it.text} />
        )
      ))}
    </div>
  )
}

function getSeq(it: { kind: 'reasoning'; section: ReasoningSection } | { kind: 'tool'; tool: ToolCall } | { kind: 'assistant'; seq: number }) {
  return it.kind === 'reasoning' ? (it.section.seq || 0) : it.kind === 'tool' ? (it.tool.seq || 0) : it.seq
}

function ReasoningItem({ section }: { section: ReasoningSection }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded border bg-white">
      <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span className="font-medium">{section.title || `Reasoning (${section.text.length} chars)`}</span>
      </summary>
      {open && (
        <div className="border-t p-2">
          <div className="relative">
            <CodeBlock code={section.text} className="text-[11px]" />
            <CopyButton text={section.text} className="absolute right-2 top-2" />
          </div>
        </div>
      )}
    </details>
  )
}

function ToolItem({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const status = tool.exitCode == null ? 'Running' : tool.exitCode === 0 ? 'Succeeded' : 'Failed'
  const dur = formatDuration(tool.durationMs)
  const lines = tool.fullOutput ? String(tool.fullOutput).split(/\r?\n/).length : 0
  const meta: string[] = []
  if (tool.exitCode != null) meta.push(`exit ${tool.exitCode}`)
  if (dur) meta.push(dur)
  if (lines) meta.push(`${lines} lines`)
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded border bg-white">
      <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
        <Wrench className="h-4 w-4 text-slate-700" />
        <span className="font-medium">{collapsedToolLabel(tool)}</span>
        <span className="text-slate-500">{meta.length ? `(${meta.join(' • ')})` : ''}</span>
        <Badge className="ml-2" variant={tool.exitCode == null ? 'warning' : tool.exitCode === 0 ? 'success' : 'destructive'}>
          {status}
        </Badge>
      </summary>
      {open && (
        <div className="border-t p-2">
          {tool.cwd && <div className="mb-1 text-xs text-slate-500">cwd: {tool.cwd}</div>}
          <div className="relative">
            <pre className="mono whitespace-pre-wrap rounded bg-slate-900 p-3 text-slate-100 text-xs">{tool.fullOutput || ''}</pre>
            <CopyButton text={tool.fullOutput || ''} className="absolute right-2 top-2" />
          </div>
        </div>
      )}
    </details>
  )
}

function collapsedToolLabel(t: ToolCall): string {
  const intent = t.parsedIntent || 'unknown'
  const label = t.summaryLabel || `Tool • ${intent || 'exec'} — ${t.command}`
  return label
}

function AssistantItem({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded border bg-white">
      <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
        <MessageSquareText className="h-4 w-4 text-slate-700" />
        <span className="font-medium">Assistant message ({text.length} chars)</span>
      </summary>
      {open && (
        <div className="border-t p-2">
          <div className="relative">
            <CodeBlock code={text} className="text-[11px]" />
            <CopyButton text={text} className="absolute right-2 top-2" />
          </div>
        </div>
      )}
    </details>
  )
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text || '').then(() => toast.success('Copied'))
      }}
    >
      <Copy className="mr-2 h-3 w-3" /> Copy
    </Button>
  )
}
