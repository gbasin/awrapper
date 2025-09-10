import { useMemo, useState } from 'react'
import { AgentTrace, ToolCall, ReasoningSection, formatDuration } from '../../lib/agent-trace'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { Copy, Lightbulb, MessageSquareText, Wrench, ChevronRight, Loader2, CheckCircle2, XCircle, Clock, Key } from 'lucide-react'
import { toast } from 'sonner'
import { Markdown } from '../ui/markdown'
import { api } from '../../lib/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

export function TraceView({ trace, className, showAssistant = true, sessionId }: { trace: AgentTrace; className?: string; showAssistant?: boolean; sessionId?: string }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => buildSummary(trace), [trace])

  return (
    <div className={cn('rounded border bg-white', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-slate-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Badge
            variant={trace.status === 'waiting_approval' ? 'warning' : trace.status === 'running' ? 'secondary' : trace.status === 'success' ? 'success' : trace.status === 'error' ? 'danger' : 'secondary'}
            title={trace.status === 'waiting_approval' ? 'Awaiting approval' : trace.status === 'running' ? 'Running' : trace.status === 'success' ? 'Succeeded' : trace.status === 'error' ? 'Failed' : 'Timed out'}
            aria-label={trace.status === 'waiting_approval' ? 'Awaiting approval' : trace.status === 'running' ? 'Running' : trace.status === 'success' ? 'Succeeded' : trace.status === 'error' ? 'Failed' : 'Timed out'}
          >
            {trace.status === 'waiting_approval' ? (
              <Key className="h-3.5 w-3.5" />
            ) : trace.status === 'running' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : trace.status === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : trace.status === 'error' ? (
              <XCircle className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
          </Badge>
          <span>{summary}</span>
        </div>
        <ChevronRight className={cn('h-4 w-4 text-slate-600 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="border-t">
          <div className="max-h-96 overflow-y-auto p-2 space-y-2 bg-slate-50">
            <Timeline trace={trace} showAssistant={showAssistant} />
            {trace.approvals && trace.approvals.length > 0 && (
              <div className="space-y-2">
                {trace.approvals.map((appr) => (
                  <ApprovalCard key={appr.callId} sessionId={sessionId} callId={appr.callId} changes={appr.changes} justification={appr.justification} />
                ))}
              </div>
            )}
            {trace.errors.length > 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                <div className="font-medium">Errors</div>
                {trace.errors.map((e, i) => (
                  <div key={i} className="whitespace-pre-wrap">{e}</div>
                ))}
              </div>
            )}
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white px-3 py-2 text-xs text-slate-600">
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
  if (t.status === 'waiting_approval') parts.push('Waiting for approval')
  else if (t.reasoningSections.length > 0) parts.push('Thinking')
  if (t.tools.length > 0) parts.push(`${t.tools.length} tools`)
  const dur = (t.completedAt || Date.now()) - (t.startedAt || Date.now())
  if (t.startedAt) parts.push(formatDuration(dur))
  return parts.join(' • ')
}

function Timeline({ trace, showAssistant }: { trace: AgentTrace; showAssistant: boolean }) {
  const items = useMemo(() => {
    const arr: Array<{ kind: 'reasoning'; section: ReasoningSection } | { kind: 'tool'; tool: ToolCall } | { kind: 'assistant'; text: string; seq: number }> = []
    for (const s of trace.reasoningSections) arr.push({ kind: 'reasoning', section: s })
    for (const t of trace.tools) arr.push({ kind: 'tool', tool: t })
    if (showAssistant && trace.assistant) arr.push({ kind: 'assistant', text: trace.assistant, seq: trace.assistantSeq || Number.MAX_SAFE_INTEGER })
    return arr.sort((a, b) => (getSeq(a) - getSeq(b)))
  }, [trace, showAssistant])
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
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded border bg-white [&>summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none hover:bg-slate-50 focus-visible:ring-1 focus-visible:ring-slate-300 transition-colors">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span className="font-medium">{section.title || `Reasoning (${section.text.length} chars)`}</span>
        <ChevronRight className={cn('ml-auto h-4 w-4 text-slate-600 transition-transform', open && 'rotate-90')} />
      </summary>
      {open && (
        <div className="border-t p-2">
          <div className="relative">
            <Markdown className="text-[13px] leading-5 text-slate-800">{section.text}</Markdown>
            <CopyButton text={section.text} className="absolute right-2 top-2" />
          </div>
        </div>
      )}
    </details>
  )
}

function ToolItem({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const statusText = tool.exitCode == null ? 'Running' : tool.exitCode === 0 ? 'Succeeded' : 'Failed'
  const dur = formatDuration(tool.durationMs)
  const lines = tool.fullOutput ? String(tool.fullOutput).split(/\r?\n/).length : 0
  const meta: string[] = []
  if (tool.exitCode != null) meta.push(`exit ${tool.exitCode}`)
  if (dur) meta.push(dur)
  if (lines) meta.push(`${lines} lines`)
  const output = String(tool.fullOutput || '')
  const hasOutput = output.trim().length > 0
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded border bg-white [&>summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none hover:bg-slate-50 focus-visible:ring-1 focus-visible:ring-slate-300 transition-colors">
        <Wrench className="h-4 w-4 text-slate-700" />
        <span className="font-medium">{collapsedToolLabel(tool)}</span>
        <span className="text-slate-500">{meta.length ? `(${meta.join(' • ')})` : ''}</span>
        <Badge
          className="ml-2"
          variant={tool.exitCode == null ? 'secondary' : tool.exitCode === 0 ? 'success' : 'danger'}
          title={statusText}
          aria-label={statusText}
        >
          {tool.exitCode == null ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : tool.exitCode === 0 ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
        </Badge>
        <ChevronRight className={cn('ml-auto h-4 w-4 text-slate-600 transition-transform', open && 'rotate-90')} />
      </summary>
      {open && (
        <div className="border-t p-2">
          {tool.cwd && <div className="mb-1 text-xs text-slate-500">cwd: {tool.cwd}</div>}
          {hasOutput && (
            <div className="relative inline-block max-w-full">
              <pre className="mono whitespace-pre-wrap rounded bg-slate-900 p-3 text-slate-100 text-xs inline-block max-w-full">{output}</pre>
              <CopyButton text={output} className="absolute right-2 top-2" />
            </div>
          )}
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
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded border bg-white [&>summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none hover:bg-slate-50 focus-visible:ring-1 focus-visible:ring-slate-300 transition-colors">
        <MessageSquareText className="h-4 w-4 text-slate-700" />
        <span className="font-medium">Assistant message ({text.length} chars)</span>
        <ChevronRight className={cn('ml-auto h-4 w-4 text-slate-600 transition-transform', open && 'rotate-90')} />
      </summary>
      {open && (
        <div className="border-t p-2">
          <div className="relative">
            <Markdown className="text-[13px] leading-5 text-slate-800">{text}</Markdown>
            <CopyButton text={text} className="absolute right-2 top-2" />
          </div>
        </div>
      )}
    </details>
  )
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className={cn('h-5 w-5 p-0', className)}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      onClick={() => {
        navigator.clipboard.writeText(trimmed).then(() => toast.success('Copied'))
      }}
    >
      <Copy className="h-3 w-3" />
    </Button>
  )
}

function ApprovalCard({ sessionId, callId, changes, justification }: { sessionId?: string; callId: string; changes: Record<string, any>; justification?: string }) {
  const [deciding, setDeciding] = useState<'approve' | 'deny' | 'session' | 'path' | null>(null)
  const [sessionConfirmOpen, setSessionConfirmOpen] = useState(false)
  const [pathDialogOpen, setPathDialogOpen] = useState(false)
  const [pathValue, setPathValue] = useState<string>(() => suggestPath(changes))
  const files = Object.keys(changes || {})
  const shortFiles = files.slice(0, 6)
  return (
    <div className="rounded border bg-white p-2 text-sm">
      <div className="font-medium">Write access requested {callId ? <span className="text-slate-400">(call {callId.slice(0, 8)})</span> : null}</div>
      {justification && (
        <div className="mt-1 text-slate-700 whitespace-pre-wrap">{justification}</div>
      )}
      {files.length > 0 && (
        <div className="mt-1">
          <div className="text-slate-600">Files ({files.length}):</div>
          {shortFiles.map((fp) => {
            const ch = changes[fp] || {}
            const op = ch.add ? 'add' : ch.update ? 'update' : ch.delete ? 'delete' : 'change'
            return (
              <div key={fp} className="text-slate-800">- {op} {fp}</div>
            )
          })}
          {files.length > 6 && (
            <div className="text-slate-400">…and {files.length - 6} more</div>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          disabled={!sessionId || deciding !== null}
          onClick={async () => {
            if (!sessionId) return
            try {
              setDeciding('approve')
              await api.sendApproval(sessionId, { call_id: callId, decision: 'approve', scope: 'once' })
              toast.success('Approved')
            } catch (e: any) {
              toast.error(`Approve failed: ${e?.message || e}`)
            } finally {
              setDeciding(null)
            }
          }}
        >
          {deciding === 'approve' ? 'Approving…' : 'Approve once'}
        </Button>
        <AlertDialog open={sessionConfirmOpen} onOpenChange={setSessionConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="secondary" disabled={!sessionId || deciding !== null}>Approve for session</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve all writes for this session?</AlertDialogTitle>
              <AlertDialogDescription>
                This allows the agent to perform subsequent write operations during this session without asking again. You can revoke by ending the session.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild><Button variant="secondary">Cancel</Button></AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  onClick={async () => {
                    if (!sessionId) return
                    try {
                      setDeciding('session')
                      await api.sendApproval(sessionId, { call_id: callId, decision: 'approve', scope: 'session' })
                      toast.success('Approved for session')
                    } catch (e: any) {
                      toast.error(`Approve failed: ${e?.message || e}`)
                    } finally {
                      setDeciding(null)
                      setSessionConfirmOpen(false)
                    }
                  }}
                >
                  Confirm
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={pathDialogOpen} onOpenChange={(o) => { setPathDialogOpen(o); if (o) setPathValue((v) => v || suggestPath(changes)) }}>
          <Button size="sm" variant="secondary" disabled={!sessionId || deciding !== null} onClick={() => setPathDialogOpen(true)}>Always allow path…</Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Always allow for a path/folder</DialogTitle>
              <DialogDescription>Subsequent writes under this path will be allowed automatically for this session.</DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <label className="block text-xs text-slate-600 mb-1" htmlFor={`path-${callId}`}>Path scope</label>
              <input
                id={`path-${callId}`}
                className="w-full rounded border px-2 py-1 text-sm"
                placeholder="e.g. src/ or docs/overview.md"
                value={pathValue}
                onChange={(e) => setPathValue(e.currentTarget.value)}
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPathDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={async () => {
                  if (!sessionId) return
                  const path = String(pathValue || '').trim()
                  if (!path) { toast.error('Enter a path'); return }
                  try {
                    setDeciding('path')
                    await api.sendApproval(sessionId, { call_id: callId, decision: 'approve', scope: 'path', path })
                    toast.success(`Always allow: ${path}`)
                    setPathDialogOpen(false)
                  } catch (e: any) {
                    toast.error(`Approve failed: ${e?.message || e}`)
                  } finally {
                    setDeciding(null)
                  }
                }}
              >
                Confirm
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Button
          size="sm"
          variant="secondary"
          disabled={!sessionId || deciding !== null}
          onClick={async () => {
            if (!sessionId) return
            try {
              setDeciding('deny')
              await api.sendApproval(sessionId, { call_id: callId, decision: 'deny' })
              toast.success('Denied')
            } catch (e: any) {
              toast.error(`Deny failed: ${e?.message || e}`)
            } finally {
              setDeciding(null)
            }
          }}
        >
          {deciding === 'deny' ? 'Denying…' : 'Deny'}
        </Button>
      </div>
    </div>
  )
}

function suggestPath(changes: Record<string, any>): string {
  const files = Object.keys(changes || {})
  if (!files.length) return ''
  // Longest common directory prefix
  const parts = files.map((f) => f.split('/')).sort((a, b) => a.length - b.length)
  const base = parts[0]
  let i = 0
  for (; i < base.length; i++) {
    const seg = base[i]
    if (!files.every((f) => f.split('/')[i] === seg)) break
  }
  return i > 0 ? base.slice(0, i).join('/') + (i < base.length ? '/' : '') : ''
}
