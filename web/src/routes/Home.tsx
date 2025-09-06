import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Session } from '../lib/api'
import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Table, Tbody, Th, Thead, Tr, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { Badge } from '../components/ui/badge'
import { BrowseDialog } from './BrowseDialog'
import { Skeleton } from '../components/ui/skeleton'

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
              m.mutate({ repo_path: repo, branch: branch || undefined, lifecycle, initial_message: initial || undefined })
            }}
          >
            <div className="flex items-center gap-2">
              <Input required placeholder="/path/to/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
              <BrowseDialog onSelect={(p) => { setRepo(p); }} />
            </div>
            <Input placeholder="branch (optional)" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as any)}>
              <option value="persistent">persistent (default)</option>
              <option value="oneshot">oneshot</option>
            </Select>
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
            <Th>lifecycle</Th>
            <Th>status</Th>
            <Th>repo</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">
                <Link className="text-blue-600 hover:underline" to={`/s/${s.id}`}>
                  {s.id}
                </Link>
              </Td>
              <Td>{s.agent_id}</Td>
              <Td>{s.lifecycle}</Td>
              <Td>
                <Badge variant={s.status === 'running' ? 'success' : s.status === 'queued' ? 'warning' : s.status === 'closed' ? 'secondary' : 'outline'}>
                  {s.status}
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
