import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Session } from '../lib/api'
import { useState } from 'react'
import { toast } from 'sonner'

export default function Home() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions(), staleTime: 5000 })
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [lifecycle, setLifecycle] = useState<'persistent' | 'oneshot'>('persistent')
  const [initial, setInitial] = useState('')
  const m = useMutation({
    mutationFn: api.createSession,
    onSuccess: async ({ id }) => {
      toast.success('Session created')
      await qc.invalidateQueries({ queryKey: ['sessions'] })
      if (id) nav(`/s/${id}`)
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create session'),
  })

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Sessions</h1>
        {q.isLoading && <div>Loading…</div>}
        {q.error && <div className="text-red-600">Failed to load</div>}
        {q.data && <SessionsTable rows={q.data} />}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Create Session</h2>
        <form
          className="grid gap-2 sm:grid-cols-2 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            m.mutate({ repo_path: repo, branch: branch || undefined, lifecycle, initial_message: initial || undefined })
          }}
        >
          <input required placeholder="/path/to/repo" value={repo} onChange={(e) => setRepo(e.target.value)} className="rounded border px-2 py-1" />
          <input placeholder="branch (optional)" value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded border px-2 py-1" />
          <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as any)} className="rounded border px-2 py-1">
            <option value="persistent">persistent (default)</option>
            <option value="oneshot">oneshot</option>
          </select>
          <textarea placeholder="Initial message (optional)" value={initial} onChange={(e) => setInitial(e.target.value)} className="rounded border px-2 py-1 sm:col-span-2 md:col-span-3" />
          <div className="sm:col-span-2 md:col-span-3">
            <button type="submit" disabled={m.isPending} className="inline-flex items-center rounded bg-black px-3 py-1.5 text-white hover:bg-black/90 disabled:opacity-50">
              {m.isPending ? 'Creating…' : 'Create session'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function SessionsTable({ rows }: { rows: Session[] }) {
  if (!rows.length) return <div className="text-slate-500">No sessions yet</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="p-2">id</th>
            <th className="p-2">agent</th>
            <th className="p-2">lifecycle</th>
            <th className="p-2">status</th>
            <th className="p-2">repo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2 font-medium">
                <Link className="text-blue-600 hover:underline" to={`/s/${s.id}`}>
                  {s.id}
                </Link>
              </td>
              <td className="p-2">{s.agent_id}</td>
              <td className="p-2">{s.lifecycle}</td>
              <td className="p-2">{s.status}</td>
              <td className="p-2 text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

