import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { BrowseDialog } from './BrowseDialog'
import { toast } from 'sonner'

export default function NewSession() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [repo, setRepo] = useState<string>(() => {
    try { return localStorage.getItem('awrapper:lastRepoPath') || '' } catch { return '' }
  })
  const [branch, setBranch] = useState<string>(() => {
    try { return localStorage.getItem('awrapper:lastBranch') || '' } catch { return '' }
  })
  const [initial, setInitial] = useState('')

  useEffect(() => { try { localStorage.setItem('awrapper:lastRepoPath', repo) } catch {} }, [repo])
  useEffect(() => { try { localStorage.setItem('awrapper:lastBranch', branch) } catch {} }, [branch])

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
    <div className="h-full flex flex-col">
      <Card className="flex-1 min-h-0">
        <CardHeader>
          <CardTitle>Start a new session</CardTitle>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            <div className="flex items-center gap-2 sm:col-span-2 md:col-span-3">
              <Input
                required
                placeholder="/path/to/repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
              <BrowseDialog onSelect={(p) => setRepo(p)} />
            </div>
            <Input
              placeholder="branch (optional)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="sm:col-span-2 md:col-span-3"
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <div className="mt-2 flex-1 min-h-0">
            <div className="rounded border h-full flex flex-col">
              <div className="flex-1 p-2 bg-slate-50">
                <div className="space-y-2">
                  <Textarea
                    rows={10}
                    value={initial}
                    onChange={(e) => setInitial(e.target.value)}
                    placeholder="Draft your initial message…"
                  />
                </div>
              </div>
              <form
                className="flex gap-2 border-t p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!repo.trim()) return
                  m.mutate({ repo_path: repo, branch: branch || undefined, initial_message: initial || undefined })
                }}
              >
                <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create session'}</Button>
              </form>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

