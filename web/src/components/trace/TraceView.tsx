import { useMemo, useState } from 'react'
import { AgentTrace, ToolCall, formatDuration } from '../../lib/agent-trace'
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
            <ReasoningSections sections={trace.reasoningSections} />
            <ToolCalls tools={trace.tools} />
            {trace.assistant && <AssistantItem text={trace.assistant} />}
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

function ReasoningSections({ sections }: { sections: AgentTrace['reasoningSections'] }) {
  if (!sections.length) return null
  return (
    <div className="space-y-1">
      {sections.map((s, i) => (
        <details key={i} className="rounded border bg-white">
          <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="font-medium">{s.title || `Reasoning (${s.text.length} chars)`}</span>
          </summary>
          <div className="border-t p-2">
            <div className="relative">
              <CodeBlock code={s.text} className="text-[11px]" />
              <CopyButton text={s.text} className="absolute right-2 top-2" />
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

function ToolCalls({ tools }: { tools: ToolCall[] }) {
  if (!tools.length) return null
  return (
    <div className="space-y-1">
      {tools.map((t) => {
        const status = t.exitCode == null ? 'Running' : t.exitCode === 0 ? 'Succeeded' : 'Failed'
        const dur = formatDuration(t.durationMs)
        const lines = t.fullOutput ? String(t.fullOutput).split(/\r?\n/).length : 0
        const meta: string[] = []
        if (t.exitCode != null) meta.push(`exit ${t.exitCode}`)
        if (dur) meta.push(dur)
        if (lines) meta.push(`${lines} lines`)
        return (
          <details key={t.callId} className="rounded border bg-white">
            <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
              <Wrench className="h-4 w-4 text-slate-700" />
              <span className="font-medium">{collapsedToolLabel(t)}</span>
              <span className="text-slate-500">{meta.length ? `(${meta.join(' • ')})` : ''}</span>
              <Badge className="ml-2" variant={t.exitCode == null ? 'warning' : t.exitCode === 0 ? 'success' : 'destructive'}>
                {status}
              </Badge>
            </summary>
            <div className="border-t p-2">
              {t.cwd && <div className="mb-1 text-xs text-slate-500">cwd: {t.cwd}</div>}
              <div className="relative">
                <CodeBlock code={t.fullOutput || ''} className="text-[11px]" />
                <CopyButton text={t.fullOutput || ''} className="absolute right-2 top-2" />
              </div>
            </div>
          </details>
        )
      })}
    </div>
  )
}

function collapsedToolLabel(t: ToolCall): string {
  const intent = t.parsedIntent || 'unknown'
  const label = t.summaryLabel || `Tool • ${intent || 'exec'} — ${t.command}`
  return label
}

function AssistantItem({ text }: { text: string }) {
  return (
    <details className="rounded border bg-white">
      <summary className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer select-none">
        <MessageSquareText className="h-4 w-4 text-slate-700" />
        <span className="font-medium">Assistant message ({text.length} chars)</span>
      </summary>
      <div className="border-t p-2">
        <div className="relative">
          <CodeBlock code={text} className="text-[11px]" />
          <CopyButton text={text} className="absolute right-2 top-2" />
        </div>
      </div>
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
