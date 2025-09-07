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
import { Copy, Send, Trash2, Download, Loader2, Clock, MinusCircle, HelpCircle } from 'lucide-react'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '../lib/utils'
import { toast } from 'sonner'
import { Markdown } from '../components/ui/markdown'
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
  const [followTail, setFollowTail] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Always fetch full log when the modal is open
  const log = useQuery({
    queryKey: ['log', id, 'all'],
    queryFn: () => api.tailLog(id, 'all'),
    refetchInterval: 5000,
    enabled: logsOpen,
  })
  const m = useMutation({ mutationFn: (content: string) => api.sendMessage(id, content), onSuccess: () => setText('') })
  const viewportRef = useRef<HTMLDivElement>(null)
  const [wrap, setWrap] = useState<boolean>(() => {
    try {
      return localStorage.getItem('awrapper:logsWrap') !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (!logsOpen) return
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [logsOpen])

  useEffect(() => {
    if (!logsOpen || !followTail) return
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [log.data, followTail, logsOpen])

  // Track whether viewport is at bottom; disable follow when user scrolls up
  useEffect(() => {
    if (!logsOpen) return
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = 40
    const onScroll = () => {
      const distance = viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
      const atBottom = distance <= threshold
      setIsAtBottom(atBottom)
      if (!atBottom && followTail) setFollowTail(false)
    }
    onScroll()
    viewport.addEventListener('scroll', onScroll)
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [logsOpen, followTail])

  useEffect(() => {
    try { localStorage.setItem('awrapper:logsWrap', wrap ? '1' : '0') } catch {}
  }, [wrap])

  if (sess.isLoading) return <div>Loading…</div>
  if (sess.error) return <div className="text-red-600">Failed to load session</div>
  const s = sess.data!

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Card className="flex-1 min-h-0">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-3">
              <span className="truncate">{s.id}</span>
              <Badge
                variant={s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : (s.status === 'closed' || s.status === 'stale') ? 'secondary' : 'outline'}
                title={s.status}
                aria-label={s.status}
              >
                {s.status === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : s.status === 'queued' ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : s.status === 'closed' ? (
                  <MinusCircle className="h-3.5 w-3.5" />
                ) : s.status === 'stale' ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : (
                  <HelpCircle className="h-3.5 w-3.5" />
                )}
              </Badge>
            </CardTitle>
            <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">View logs</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl w-[95vw]">
                <DialogHeader>
                  <DialogTitle>Session logs</DialogTitle>
                  <DialogDescription>Full log output (newest at bottom). Backfills older lines progressively.</DialogDescription>
                </DialogHeader>
                {/* Toolbar */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-700">Wrap</span>
                      <Switch checked={wrap} onCheckedChange={setWrap} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 inline-flex items-center">Follow</span>
                      <Switch checked={followTail} onCheckedChange={(v) => {
                        setFollowTail(!!v)
                        if (v) {
                          const viewport = viewportRef.current
                          if (viewport) viewport.scrollTop = viewport.scrollHeight
                        }
                      }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-5 w-5 p-0"
                      title="Copy to clipboard"
                      aria-label="Copy to clipboard"
                      onClick={() => {
                        const text = log.data ?? ''
                        if (!text) return
                        navigator.clipboard.writeText(text).then(() => toast.success('Logs copied'))
                      }}
                      disabled={log.isLoading || !log.data}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const text = log.data ?? ''
                        if (!text) return
                        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${s.id}-session.log`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      disabled={log.isLoading || !log.data}
                    >
                      <Download className="mr-2 h-3 w-3" /> Download
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <ScrollArea viewportRef={viewportRef} className="h-[65vh] bg-white border rounded" viewportClassName="p-2">
                    {log.isLoading ? (
                      <Skeleton className="h-64 w-full" />
                    ) : (
                      <BackfillLogViewer viewportRef={viewportRef} text={log.data || ''} wrap={wrap} follow={followTail} />
                    )}
                  </ScrollArea>
                  {!isAtBottom && (
                    <button
                      type="button"
                      className="absolute bottom-3 right-3 rounded-full bg-black text-white text-xs px-3 py-1.5 shadow hover:bg-slate-800"
                      onClick={() => {
                        const viewport = viewportRef.current
                        if (viewport) viewport.scrollTop = viewport.scrollHeight
                        setFollowTail(true)
                      }}
                    >
                      Jump to bottom
                    </button>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="text-xs text-slate-500 truncate" title={`${s.repo_path}${s.branch ? ` @ ${s.branch}` : ''}`}>{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</div>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <div className="mt-1 flex-1 min-h-0">
            <div className="rounded border h-full flex flex-col">
              <ScrollArea data-testid="messages" className="flex-1 min-h-0 p-2 bg-slate-50">
                {msgs.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-20 w-3/4" />
                    <Skeleton className="h-4 w-2/5 ml-auto" />
                    <Skeleton className="h-16 w-2/3 ml-auto" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {msgs.data?.map((m) => (
                  <MessageItem key={m.id} m={m} traces={tracesQ.traces} sessionId={id} />
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

function MessageItem({ m, traces, sessionId }: { m: ApiMessage; traces: Map<string, AgentTrace>; sessionId: string }) {
  const align = m.role === 'user' ? 'ml-auto' : 'mr-auto'
  const bubbleColor = m.role === 'user' ? 'bg-slate-100' : 'bg-white border'
  const Trace = m.role === 'assistant' && m.turn_id ? traces.get(m.turn_id) : undefined
  const isStreaming = m.role === 'assistant' && !!Trace && Trace.status === 'running'
  const bubbleClass = cn(bubbleColor, isStreaming && 'border-amber-300 animate-pulse')
  return (
    <div className={cn('max-w-[72ch] sm:max-w-[75%] md:max-w-[65%] lg:max-w-[60%] space-y-1', align)}>
      {Trace && (
        <TraceView trace={Trace} showAssistant={false} sessionId={sessionId} />
      )}
      <MessageBubble role={m.role} content={m.content} createdAt={m.created_at} className={bubbleClass} />
    </div>
  )
}

function MessageBubble({ role, content, createdAt, className }: { role: 'user' | 'assistant'; content: string; createdAt: number; className?: string }) {
  return (
    <div className={cn('rounded-md py-1.5 px-3', className)}>
      <div className="mb-1 text-[10px] leading-4 text-slate-500">[{new Date(createdAt).toLocaleTimeString()}] {role}</div>
      <Markdown className="text-[13px] leading-5" >{content}</Markdown>
    </div>
  )
}

// Progressive, bottom-first logs renderer that backfills older lines in batches.
function BackfillLogViewer({ text, wrap, follow, viewportRef }: { text: string; wrap: boolean; follow: boolean; viewportRef: React.RefObject<HTMLDivElement> }) {
  const [visible, setVisible] = useState<string>('')
  const timerRef = useRef<number | null>(null)
  const baseLinesRef = useRef<string[]>([])
  const idxRef = useRef<number>(0)
  const nearBottomRef = useRef<boolean>(true)
  const initializedRef = useRef<boolean>(false)
  const backfillingRef = useRef<boolean>(false)
  const lastCountRef = useRef<number>(0)

  // Track whether the viewport is near bottom to gate auto-scroll
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = 40
    const onScroll = () => {
      const distance = viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
      nearBottomRef.current = distance <= threshold
    }
    onScroll()
    viewport.addEventListener('scroll', onScroll)
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [viewportRef])

  useEffect(() => {
    const nextLines = text ? text.split(/\r?\n/) : []

    // If we haven't initialized or file shrank, do initial progressive backfill
    const fileShrank = nextLines.length < lastCountRef.current
    const needsInit = !initializedRef.current || fileShrank
    if (needsInit) {
      initializedRef.current = true
      backfillingRef.current = true
      baseLinesRef.current = nextLines
      idxRef.current = nextLines.length
      setVisible('')
      const chunk = Math.min(800, Math.max(200, Math.floor(nextLines.length / 20) || 400))
      const tick = () => {
        const nextIdx = Math.max(0, idxRef.current - chunk)
        const slice = baseLinesRef.current.slice(nextIdx, idxRef.current)
        setVisible((prev) => (slice.length ? slice.join('\n') + (prev ? '\n' + prev : '') : prev))
        idxRef.current = nextIdx
        requestAnimationFrame(() => {
          const viewport = viewportRef.current
          if (follow && nearBottomRef.current && viewport) viewport.scrollTop = viewport.scrollHeight
        })
        if (idxRef.current > 0) {
          timerRef.current = window.setTimeout(tick, 0)
        } else {
          backfillingRef.current = false
          lastCountRef.current = baseLinesRef.current.length
          timerRef.current = null
        }
      }
      tick()
      return () => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null } }
    }

    // If we've finished backfill and new lines were appended, append them without resetting
    if (!backfillingRef.current) {
      const prevCount = lastCountRef.current
      if (nextLines.length > prevCount) {
        const add = nextLines.slice(prevCount)
        setVisible((prev) => (prev ? prev + '\n' + add.join('\n') : add.join('\n')))
        lastCountRef.current = nextLines.length
        requestAnimationFrame(() => {
          const viewport = viewportRef.current
          if (follow && nearBottomRef.current && viewport) viewport.scrollTop = viewport.scrollHeight
        })
      }
    }
  }, [text, follow])

  return (
    <pre className={cn('mono text-xs', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
      {visible}
    </pre>
  )
}
