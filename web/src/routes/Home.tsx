import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Session } from '../lib/api'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Table, Tbody, Th, Thead, Tr, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Badge } from '../components/ui/badge'
import { BrowseDialog } from './BrowseDialog'
import { Skeleton } from '../components/ui/skeleton'
import { Loader2, Clock, MinusCircle, HelpCircle, CheckCircle2, Key } from 'lucide-react'
import { Switch } from '../components/ui/switch'

export default function Home() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions(), staleTime: 5000 })
  const [repo, setRepo] = useState(() => {
    try { return localStorage.getItem('awrapper:lastRepoPath') || '' } catch { return '' }
  })
  const [branch, setBranch] = useState(() => {
    try { return localStorage.getItem('awrapper:lastBranch') || '' } catch { return '' }
  })
  // lifecycle removed; all sessions are persistent
  const [initial, setInitial] = useState('')
  const [useWorktree, setUseWorktree] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('awrapper:useWorktree')
      return raw == null ? true : JSON.parse(raw)
    } catch { return true }
  })
  const [blockWhileRunning, setBlockWhileRunning] = useState<boolean>(true)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('awrapper:useWorktree')
      if (raw == null) {
        api.getConfig().then((c) => {
          setUseWorktree(!!c.default_use_worktree)
        }).catch(() => {})
      }
    } catch {}
  }, [])
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
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-36 w-full" />
            </div>
          )}
          {q.error && <div className="text-red-600">Failed to load</div>}
          {q.data && <SessionsTable rows={q.data} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create Session</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-2 sm:grid-cols-2 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              m.mutate({ repo_path: repo, branch: branch || undefined, initial_message: initial || undefined, use_worktree: useWorktree, block_while_running: blockWhileRunning })
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                required
                placeholder="/path/to/repo"
                value={repo}
                onChange={(e) => {
                  const v = e.target.value
                  setRepo(v)
                  try { localStorage.setItem('awrapper:lastRepoPath', v) } catch {}
                }}
              />
              <BrowseDialog onSelect={(p) => {
                setRepo(p)
                try { localStorage.setItem('awrapper:lastRepoPath', p) } catch {}
              }} />
            </div>
            <Input
              placeholder="branch (optional)"
              value={branch}
              onChange={(e) => {
                const v = e.target.value
                setBranch(v)
                try { localStorage.setItem('awrapper:lastBranch', v) } catch {}
              }}
            />
            <div className="flex items-center gap-2">
              <Switch
                checked={useWorktree}
                onCheckedChange={(v) => {
                  setUseWorktree(v)
                  try { localStorage.setItem('awrapper:useWorktree', JSON.stringify(v)) } catch {}
                }}
              />
              <span title="When off, the agent runs directly in your repo. Not isolated; may modify your working tree. If you set a branch, it must match the current checkout.">
                Use Git worktree (recommended)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={blockWhileRunning} onCheckedChange={setBlockWhileRunning} />
              <span title="When on, the UI disables Send while a turn is running.">Block while running</span>
            </div>
            {/* lifecycle selection removed: always persistent */}
            <Textarea placeholder="Initial message (optional)" value={initial} onChange={(e) => setInitial(e.target.value)} className="sm:col-span-2 md:col-span-3" />
            <div className="sm:col-span-2 md:col-span-3">
              <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create session'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SessionsTable({ rows }: { rows: Session[] }) {
  if (!rows.length) return <div className="text-slate-500">No sessions yet</div>
  return (
    <div className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>id</Th>
            <Th>agent</Th>
            <Th>status</Th>
            <Th>repo</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows
            .slice()
            .sort((a, b) => {
              const pa = a.pending_approval ? 1 : 0
              const pb = b.pending_approval ? 1 : 0
              if (pb !== pa) return pb - pa
              const ta = (a.last_activity_at ?? a.started_at ?? 0) as number
              const tb = (b.last_activity_at ?? b.started_at ?? 0) as number
              return tb - ta
            })
            .map((s) => (
          <Tr key={s.id}>
            <Td className="font-medium">
              <Link className="text-blue-600 hover:underline" to={`/s/${s.id}`}>
                {s.id}
              </Link>
            </Td>
            <Td>{s.agent_id}</Td>
            <Td>
                <Badge
                  variant={s.pending_approval ? 'warning' : s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : (s.status === 'closed' || s.status === 'stale') ? 'secondary' : 'outline'}
                  title={s.pending_approval ? 'awaiting approval' : (s.status === 'running' && !s.busy ? 'ready' : s.status)}
                  aria-label={s.pending_approval ? 'awaiting approval' : (s.status === 'running' && !s.busy ? 'ready' : s.status)}
                >
                  {s.pending_approval ? (
                    <Key className="h-3.5 w-3.5" />
                  ) : s.status === 'running' ? (
                    s.busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )
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
              </Td>
              <Td className="text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  )
}
