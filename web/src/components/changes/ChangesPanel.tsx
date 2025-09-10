import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { AgentTrace } from '../../lib/agent-trace'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../../lib/utils'
import { MergeCM } from './MergeCM'
import { toast } from 'sonner'
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
import { Textarea } from '../ui/textarea'

export function ChangesPanel({ sessionId, traces }: { sessionId: string; traces?: Map<string, AgentTrace> }) {
  const [open, setOpen] = useState<boolean>(true)
  const [tab, setTab] = useState<'unstaged' | 'staged'>('unstaged')
  const [onlyNew, setOnlyNew] = useState<boolean>(false)
  const changesQ = useQuery({ queryKey: ['changes', sessionId], queryFn: () => api.getChanges(sessionId), refetchInterval: 2500 })
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: () => api.getConfig() })

  // Proposed approvals aggregated from all traces
  const proposed = useMemo(() => {
    const arr: Array<{ runId: string; callId: string; files: string[]; justification?: string }> = []
    if (!traces) return arr
    for (const t of traces.values()) {
      for (const a of t.approvals || []) {
        arr.push({ runId: t.runId, callId: a.callId, files: Object.keys(a.changes || {}), justification: a.justification })
      }
    }
    return arr
  }, [traces])

  // Select latest runId for "Only new since this turn"
  const latestRunId = useMemo(() => {
    if (!traces || traces.size === 0) return undefined
    const arr = Array.from(traces.values())
    arr.sort((a, b) => ((b.completedAt ?? b.startedAt ?? 0) - (a.completedAt ?? a.startedAt ?? 0)))
    return arr[0]?.runId
  }, [traces])

  const proposedFiltered = useMemo(() => {
    if (!onlyNew || !latestRunId) return proposed
    return proposed.filter((p) => p.runId === latestRunId)
  }, [proposed, onlyNew, latestRunId])

  return (
    <div className="rounded border bg-white">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-slate-800">
          <span className="font-medium">Changes</span>
          {changesQ.data?.gitAvailable === false ? (
            <span className="text-slate-500">• Git unavailable</span>
          ) : null}
        </div>
        <span className="text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t p-2 space-y-3">
          <div>
            <div className="mb-1 text-xs text-slate-600 flex items-center justify-between">
              <div className="font-medium">Proposed</div>
              <label className="inline-flex items-center gap-2 select-none">
                <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.currentTarget.checked)} />
                <span>Only new since this turn</span>
              </label>
            </div>
            <div className="space-y-2">
              {proposedFiltered.length === 0 ? (
                <div className="text-xs text-slate-500">No proposed changes</div>
              ) : (
                proposedFiltered.map((p) => (
                  <div key={`${p.runId}:${p.callId}`} className="rounded border bg-white p-2">
                    <div className="text-xs text-slate-600">Run {p.runId.slice(0, 8)} • Request {p.callId.slice(0, 8)}</div>
                    {p.justification ? (
                      <div className="mt-1 text-[13px] text-slate-800 whitespace-pre-wrap">{p.justification}</div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.files.map((f) => (
                        <Badge key={f} variant="secondary" className="text-[11px]">{f}</Badge>
                      ))}
                    </div>
                    <div className="mt-2">
                      <ApprovalActions sessionId={sessionId} callId={p.callId} files={p.files} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs text-slate-600 font-medium">Applied (uncommitted)</div>
            {changesQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : changesQ.data?.gitAvailable === false ? (
              <div className="text-xs text-slate-500">Not a Git directory</div>
            ) : (
              <AppliedChanges
                sessionId={sessionId}
                tab={tab}
                onTabChange={setTab}
                staged={changesQ.data?.staged || []}
                unstaged={changesQ.data?.unstaged || []}
                commitEnabled={!!cfgQ.data?.enable_commit}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AppliedChanges({ sessionId, tab, onTabChange, staged, unstaged, commitEnabled }: { sessionId: string; tab: 'unstaged' | 'staged'; onTabChange: (t: 'unstaged' | 'staged') => void; staged: Array<{ path: string; status: string; renamed_from?: string }>; unstaged: Array<{ path: string; status: string; renamed_from?: string }>; commitEnabled: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const curr = tab === 'staged' ? staged : unstaged
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const qc = useQueryClient()
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-1 rounded border p-0.5 bg-slate-50">
          <Button size="sm" variant={tab === 'unstaged' ? 'secondary' : 'ghost'} onClick={() => onTabChange('unstaged')}>Unstaged ({unstaged.length})</Button>
          <Button size="sm" variant={tab === 'staged' ? 'secondary' : 'ghost'} onClick={() => onTabChange('staged')}>Staged ({staged.length})</Button>
        </div>
        <div className="inline-flex items-center gap-2">
          <Button size="sm" variant="default" disabled={!commitEnabled || staged.length === 0} onClick={() => setCommitOpen(true)} title={!commitEnabled ? 'Commit disabled' : (staged.length === 0 ? 'No staged changes' : 'Commit staged changes')}>
            Commit…
          </Button>
        </div>
      </div>
      {curr.length === 0 ? (
        <div className="text-xs text-slate-500">No changes</div>
      ) : (
        <div className="space-y-1">
          {curr.map((e) => (
            <FileDiff key={`${e.path}:${e.status}:${e.renamed_from || ''}:${tab}`} sessionId={sessionId} entry={e} side={tab === 'staged' ? 'index' : 'worktree'} open={!!open[e.path]} onToggle={() => setOpen((m) => ({ ...m, [e.path]: !m[e.path] }))} />
          ))}
        </div>
      )}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commit staged changes</DialogTitle>
            <DialogDescription>Only staged files will be included. Unstaged changes are left as-is.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="block text-xs text-slate-600">Message</label>
            <Textarea rows={5} placeholder="e.g. feat: add changes review UI" value={commitMsg} onChange={(e) => setCommitMsg(e.currentTarget.value)} />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setCommitMsg((v) => v || 'feat: ')} variant="secondary">Suggest: feat</Button>
              <Button size="sm" onClick={() => setCommitMsg((v) => v || 'fix: ')} variant="secondary">Suggest: fix</Button>
              <Button size="sm" onClick={() => setCommitMsg((v) => v || 'chore: ')} variant="secondary">Suggest: chore</Button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCommitOpen(false)}>Cancel</Button>
            <Button disabled={committing} onClick={async () => {
              const msg = commitMsg.trim()
              if (!msg) { toast.error('Enter a commit message'); return }
              try {
                setCommitting(true)
                await api.postGit(sessionId, { op: 'commit', message: msg })
                toast.success('Committed staged changes')
                setCommitOpen(false)
                setCommitMsg('')
                await qc.invalidateQueries({ queryKey: ['changes', sessionId] })
              } catch (e: any) {
                toast.error(`Commit failed: ${e?.message || e}`)
              } finally {
                setCommitting(false)
              }
            }}>{committing ? 'Committing…' : 'Commit'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FileDiff({ sessionId, entry, side, open, onToggle }: { sessionId: string; entry: { path: string; status: string; renamed_from?: string }; side: 'worktree' | 'index'; open: boolean; onToggle: () => void }) {
  const [diff, setDiff] = useState<string>('')
  const [isBinary, setIsBinary] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'diff' | 'merge'>('diff')
  const [busy, setBusy] = useState<boolean>(false)
  const qc = useQueryClient()
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const j = await api.getDiff(sessionId, entry.path, side, 3)
        if (!cancelled) {
          setIsBinary(!!j.isBinary)
          setDiff(j.isBinary ? `Binary file (size: ${j.size ?? 0} bytes)` : (j.diff || ''))
        }
      } catch (e) {
        if (!cancelled) setDiff('Failed to load diff')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (open) load()
    return () => { cancelled = true }
  }, [sessionId, entry.path, side, open])

  async function doGit(op: 'stage' | 'unstage' | 'discardWorktree' | 'discardIndex') {
    try {
      setBusy(true)
      await api.postGit(sessionId, { op, paths: [entry.path] } as any)
      // Refresh changes and diff after op
      await qc.invalidateQueries({ queryKey: ['changes', sessionId] })
      // Reload diff for current side
      const j = await api.getDiff(sessionId, entry.path, side, 3)
      setIsBinary(!!j.isBinary)
      setDiff(j.isBinary ? `Binary file (size: ${j.size ?? 0} bytes)` : (j.diff || ''))
    } catch {
      // noop; could surface toast
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded border bg-white">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-2 py-1 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[11px]">{entry.status}</Badge>
          <span className="font-mono text-[12px] truncate" title={entry.path}>{entry.path}</span>
          {entry.renamed_from ? (
            <span className="text-[11px] text-slate-500">(from {entry.renamed_from})</span>
          ) : null}
        </div>
        <span className="text-slate-500 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t bg-slate-50">
          {/* Actions bar */}
          <div className="flex items-center justify-between px-2 py-1 border-b bg-white">
            <div className="inline-flex items-center gap-1">
              {side === 'worktree' ? (
                <>
                  <Button disabled={busy} size="sm" variant="secondary" onClick={() => doGit('stage')}>Stage</Button>
                  <Button disabled={busy} size="sm" variant="ghost" onClick={() => doGit('discardWorktree')}>Discard</Button>
                </>
              ) : (
                <>
                  <Button disabled={busy} size="sm" variant="secondary" onClick={() => doGit('unstage')}>Unstage</Button>
                  <Button disabled={busy} size="sm" variant="ghost" onClick={() => doGit('discardIndex')}>Discard (index)</Button>
                </>
              )}
            </div>
            <div className="inline-flex items-center gap-1 rounded border p-0.5 bg-slate-50">
              <Button size="sm" variant={mode === 'diff' ? 'secondary' : 'ghost'} onClick={() => setMode('diff')}>Diff</Button>
              <Button size="sm" disabled={isBinary} variant={mode === 'merge' ? 'secondary' : 'ghost'} onClick={() => setMode('merge')}>Merge</Button>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : mode === 'diff' ? (
            <ScrollArea className="max-h-72">
              <pre className={cn('text-xs whitespace-pre p-2')}>{diff}</pre>
            </ScrollArea>
          ) : (
            <div className="p-2">
              {isBinary ? (
                <div className="text-xs text-slate-600">Binary file — merge disabled</div>
              ) : (
                <MergeCM
                  sessionId={sessionId}
                  path={entry.path}
                  onSaved={async (staged) => {
                    await qc.invalidateQueries({ queryKey: ['changes', sessionId] })
                    const j = await api.getDiff(sessionId, entry.path, side, 3)
                    setIsBinary(!!j.isBinary)
                    setDiff(j.isBinary ? `Binary file (size: ${j.size ?? 0} bytes)` : (j.diff || ''))
                    if (staged) {
                      try { await api.postGit(sessionId, { op: 'stage', paths: [entry.path] }) } catch {}
                      await qc.invalidateQueries({ queryKey: ['changes', sessionId] })
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApprovalActions({ sessionId, callId, files }: { sessionId: string; callId: string; files: string[] }) {
  const [deciding, setDeciding] = useState<null | 'approve' | 'deny' | 'session' | 'path'>(null)
  const [pathDialogOpen, setPathDialogOpen] = useState(false)
  const [pathValue, setPathValue] = useState('')
  const [sessionConfirmOpen, setSessionConfirmOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={!sessionId || deciding !== null}
        onClick={async () => {
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
      <Dialog open={pathDialogOpen} onOpenChange={(o) => { setPathDialogOpen(o); if (o) setPathValue((v) => v || suggestPath(files)) }}>
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
  )
}

function suggestPath(files: string[]): string {
  if (!files || !files.length) return ''
  const parts = files.map((f) => f.split('/')).sort((a, b) => a.length - b.length)
  const base = parts[0]
  let i = 0
  for (; i < base.length; i++) {
    const seg = base[i]
    if (!files.every((f) => f.split('/')[i] === seg)) break
  }
  return i > 0 ? base.slice(0, i).join('/') + (i < base.length ? '/' : '') : ''
}
