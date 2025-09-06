import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, type Message as ApiMessage } from '../lib/api'
// Tabs removed in favor of a Logs modal
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog'
import { Copy, Send, Trash2 } from 'lucide-react'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '../lib/utils'
import { toast } from 'sonner'
import { CodeBlock } from '../components/ui/code-block'
import { Switch } from '../components/ui/switch'
import { useAgentTraces, type AgentTrace } from '../lib/agent-trace'
import { TraceView } from '../components/trace/TraceView'

export default function Session() {
  const { id = '' } = useParams()
  const [text, setText] = useState('')
  const sess = useQuery({ queryKey: ['session', id], queryFn: () => api.getSession(id), refetchInterval: 5000 })
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api.listMessages(id), refetchInterval: 1500 })
  const tracesQ = useAgentTraces(id)
  const [logsOpen, setLogsOpen] = useState(false)
  // Always fetch full log when the modal is open
  const log = useQuery({
    queryKey: ['log', id, 'all'],
    queryFn: () => api.tailLog(id, 'all'),
    refetchInterval: 5000,
    enabled: logsOpen,
  })
  const m = useMutation({ mutationFn: (content: string) => api.sendMessage(id, content), onSuccess: () => setText('') })
  const logRef = useRef<HTMLPreElement>(null)
  const [wrap, setWrap] = useState<boolean>(() => {
    try {
      return localStorage.getItem('awrapper:logsWrap') !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log.data, logsOpen])

  useEffect(() => {
    try { localStorage.setItem('awrapper:logsWrap', wrap ? '1' : '0') } catch {}
  }, [wrap])

  if (sess.isLoading) return <div>Loading…</div>
  if (sess.error) return <div className="text-red-600">Failed to load session</div>
  const s = sess.data!

  return (
    <div className="h-full flex flex-col">
      <Card className="flex-1 min-h-0">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-3">
              <span className="truncate">{s.id}</span>
              <Badge variant={s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : (s.status === 'closed' || s.status === 'stale') ? 'secondary' : 'outline'}>
                {s.status}
              </Badge>
            </CardTitle>
            <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">View logs</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl w-[95vw]">
                <DialogHeader>
                  <DialogTitle>Session logs</DialogTitle>
                  <DialogDescription>Full log output (most recent at bottom). Backfills older lines progressively.</DialogDescription>
                </DialogHeader>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm text-slate-600">Wrap lines</div>
                  <Switch checked={wrap} onCheckedChange={setWrap} />
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const text = log.data ?? ''
                      if (!text) return
                      navigator.clipboard.writeText(text).then(() => toast.success('Logs copied'))
                    }}
                    disabled={log.isLoading || !log.data}
                  >
                    <Copy className="mr-2 h-3 w-3" /> Copy
                  </Button>
                </div>
                <ScrollArea className="h-[65vh] bg-white p-2 border rounded">
                  {log.isLoading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : (
                    <BackfillLogViewer refEl={logRef} text={log.data || ''} wrap={wrap} />
                  )}
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
          <div className="px-4 text-sm text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</div>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <div className="mt-2 flex-1 min-h-0">
            <div className="rounded border h-full flex flex-col">
              <ScrollArea className="flex-1 p-2 bg-slate-50">
                {msgs.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-20 w-3/4" />
                    <Skeleton className="h-4 w-2/5 ml-auto" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.data?.map((m) => (
                      <MessageItem key={m.id} m={m} traces={tracesQ.traces} />
                    ))}
                  </div>
                )}
              </ScrollArea>
              <form className="flex gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate(text) }}>
                <Textarea
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      if (text.trim() && !m.isPending) m.mutate(text)
                    }
                  }}
                  placeholder="Type a message… (Cmd/Ctrl+Enter to send)"
                />
                <Button disabled={m.isPending} className="self-start" type="submit">
                  {m.isPending ? 'Sending…' : (<><Send className="mr-2 h-4 w-4" /> Send</>)}
                </Button>
              </form>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Cancel session</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
                  <AlertDialogDescription>This sends a cancel request to the process and marks the session as canceled.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="secondary">Dismiss</Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button onClick={() => fetch(`/sessions/${id}/cancel`, { method: 'POST' }).then(() => window.location.reload())}>Confirm cancel</Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MessageItem({ m, traces }: { m: ApiMessage; traces: Map<string, AgentTrace> }) {
  const align = m.role === 'user' ? 'ml-auto' : 'mr-auto'
  const bubbleColor = m.role === 'user' ? 'bg-slate-200' : 'bg-white border'
  const Trace = m.role === 'assistant' && m.turn_id ? traces.get(m.turn_id) : undefined
  return (
    <div className={cn('max-w-[90%] space-y-1', align)}>
      {Trace && (
        <TraceView trace={Trace} />
      )}
      <MessageBubble role={m.role} content={m.content} createdAt={m.created_at} className={bubbleColor} />
    </div>
  )
}

function MessageBubble({ role, content, createdAt, className }: { role: 'user' | 'assistant'; content: string; createdAt: number; className?: string }) {
  const segments = useMemo(() => parseSegments(content), [content])
  return (
    <div className={cn('rounded-lg p-2', className)}>
      <div className="mb-1 text-[11px] text-slate-500">[{new Date(createdAt).toLocaleTimeString()}] {role}</div>
      <div className="space-y-2">
        {segments.map((seg, i) => (
          seg.type === 'code' ? (
            <div key={i} className="relative">
              <CodeBlock code={seg.content} lang={seg.lang} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="absolute right-2 top-2"
                onClick={() => {
                  navigator.clipboard.writeText(seg.content).then(() => toast.success('Code copied'))
                }}
              >
                <Copy className="mr-2 h-3 w-3" /> Copy
              </Button>
            </div>
          ) : (
            <p key={i} className="whitespace-pre-wrap text-sm">{seg.content}</p>
          )
        ))}
      </div>
    </div>
  )
}

function parseSegments(s: string): Array<{ type: 'text'; content: string } | { type: 'code'; lang?: string; content: string }> {
  const segments: Array<{ type: 'text'; content: string } | { type: 'code'; lang?: string; content: string }> = []
  const re = /```([\w+-]*)?\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) segments.push({ type: 'text', content: s.slice(last, m.index) })
    segments.push({ type: 'code', lang: m[1] || '', content: m[2] })
    last = re.lastIndex
  }
  if (last < s.length) segments.push({ type: 'text', content: s.slice(last) })
  return segments
}

// Progressive, bottom-first logs renderer that backfills older lines in batches.
function BackfillLogViewer({ text, wrap, refEl }: { text: string; wrap: boolean; refEl: React.RefObject<HTMLPreElement> }) {
  const [visible, setVisible] = useState<string>('')
  const timerRef = useRef<number | null>(null)
  const linesRef = useRef<string[]>([])
  const idxRef = useRef<number>(0)

  useEffect(() => {
    linesRef.current = text ? text.split(/\r?\n/) : []
    idxRef.current = linesRef.current.length
    setVisible('')

    const chunk = Math.min(800, Math.max(200, Math.floor(linesRef.current.length / 20) || 400))

    const tick = () => {
      const nextIdx = Math.max(0, idxRef.current - chunk)
      const slice = linesRef.current.slice(nextIdx, idxRef.current)
      setVisible((prev) => (slice.length ? slice.join('\n') + (prev ? '\n' + prev : '') : prev))
      idxRef.current = nextIdx
      if (refEl.current) refEl.current.scrollTop = refEl.current.scrollHeight
      if (idxRef.current > 0) {
        timerRef.current = window.setTimeout(tick, 0)
      } else {
        timerRef.current = null
      }
    }
    tick()
    return () => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null } }
  }, [text])

  return (
    <pre ref={refEl} className={cn('mono text-xs', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
      {visible}
    </pre>
  )
}
