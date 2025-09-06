import { useEffect, useRef, useState } from 'react'
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

export default function Session() {
  const { id = '' } = useParams()
  const [text, setText] = useState('')
  const sess = useQuery({ queryKey: ['session', id], queryFn: () => api.getSession(id), refetchInterval: 5000 })
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => api.listMessages(id), refetchInterval: 1500 })
  const log = useQuery({ queryKey: ['log', id], queryFn: () => api.tailLog(id, 800), refetchInterval: 1500 })
  const m = useMutation({ mutationFn: (content: string) => api.sendMessage(id, content), onSuccess: () => setText('') })
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log.data])

  if (sess.isLoading) return <div>Loading…</div>
  if (sess.error) return <div className="text-red-600">Failed to load session</div>
  const s = sess.data!

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="truncate">{s.id}</span>
            <Badge variant={s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : s.status === 'closed' ? 'secondary' : 'outline'}>
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
                  <pre className="text-xs whitespace-pre-wrap">{msgs.data?.map(m => `[${new Date(m.created_at).toLocaleTimeString()}] ${m.role}: ${m.content}`).join('\n')}</pre>
                </ScrollArea>
                <form className="flex gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate(text) }}>
                  <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" />
                  <Button disabled={m.isPending} className="self-start" type="submit">{m.isPending ? 'Sending…' : 'Send'}</Button>
                </form>
              </div>
            </TabsContent>

            <TabsContent value="logs">
              <div className="rounded border">
                <ScrollArea className="h-[420px] bg-slate-50 p-2">
                  <pre ref={logRef} className="mono text-xs whitespace-pre-wrap">{log.data}</pre>
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>
          <div className="mt-3 flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Cancel session</Button>
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
