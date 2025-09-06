import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../components/ui/alert-dialog'
import { Copy, Send, Trash2 } from 'lucide-react'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '../lib/utils'
import { toast } from 'sonner'
import { CodeBlock } from '../components/ui/code-block'
import { Switch } from '../components/ui/switch'

export default function Session() {
  const { id = '' } = useParams()
  const [text, setText] = useState('')
  const sess = useQuery({ queryKey: ['session', id], queryFn: () => api.getSession(id), refetchInterval: 5000 })
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api.listMessages(id), refetchInterval: 1500 })
  const [fullLog, setFullLog] = useState(false)
  const log = useQuery({ queryKey: ['log', id, fullLog ? 'all' : 800], queryFn: () => api.tailLog(id, fullLog ? 'all' : 800), refetchInterval: fullLog ? 5000 : 1500 })
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
  }, [log.data])

  useEffect(() => {
    try { localStorage.setItem('awrapper:logsWrap', wrap ? '1' : '0') } catch {}
  }, [wrap])

  if (sess.isLoading) return <div>Loading…</div>
  if (sess.error) return <div className="text-red-600">Failed to load session</div>
  const s = sess.data!

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="truncate">{s.id}</span>
            <Badge variant={s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : (s.status === 'closed' || s.status === 'stale') ? 'secondary' : 'outline'}>
              {s.lifecycle} • {s.status}
            </Badge>
          </CardTitle>
          <div className="px-4 text-sm text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="messages">
            <TabsList>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="messages">
              <div className="rounded border">
                <ScrollArea className="h-[360px] p-2 bg-slate-50">
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
                        <MessageBubble key={m.id} role={m.role} content={m.content} createdAt={m.created_at} />
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
            </TabsContent>

            <TabsContent value="logs">
              <div className="rounded border">
                <div className="flex items-center justify-end gap-3 bg-slate-50 px-2 py-1 border-b">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <span>Wrap lines</span>
                    <Switch checked={wrap} onCheckedChange={(v) => setWrap(!!v)} />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant={fullLog ? 'default' : 'secondary'}
                    onClick={() => setFullLog(v => !v)}
                    disabled={log.isLoading}
                  >
                    {fullLog ? 'View recent' : 'View full log'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
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
                <ScrollArea className="h-[420px] bg-white p-2">
                  {log.isLoading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : (
                    <pre ref={logRef} className={cn('mono text-xs', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>{log.data}</pre>
                  )}
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>
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

function MessageBubble({ role, content, createdAt }: { role: 'user' | 'assistant'; content: string; createdAt: number }) {
  const segments = useMemo(() => parseSegments(content), [content])
  const align = role === 'user' ? 'ml-auto bg-slate-200' : 'mr-auto bg-white border'
  return (
    <div className={cn('max-w-[90%] rounded-lg p-2', align)}>
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
