import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

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
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm text-slate-500">{s.lifecycle} • {s.status}</div>
          <div className="text-lg font-semibold">{s.id}</div>
          <div className="text-sm text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-2">
          <div className="font-medium">Messages</div>
          <div className="mt-2 h-[360px] overflow-auto rounded border bg-slate-50 p-2">
            <pre className="text-xs whitespace-pre-wrap">{msgs.data?.map(m => `[${new Date(m.created_at).toLocaleTimeString()}] ${m.role}: ${m.content}`).join('\n')}</pre>
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate(text) }}
          >
            <textarea className="flex-1 rounded border p-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" />
            <button disabled={m.isPending} className="self-start rounded bg-black px-3 py-1.5 text-white hover:bg-black/90 disabled:opacity-50" type="submit">
              {m.isPending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>

        <div className="rounded border p-2">
          <div className="font-medium">Logs</div>
          <pre ref={logRef} className="mono mt-2 h-[420px] overflow-auto rounded border bg-slate-50 p-2 text-xs whitespace-pre-wrap">{log.data}</pre>
        </div>
      </section>
    </div>
  )
}

