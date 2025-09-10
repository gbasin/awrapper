import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { AgentTrace } from '../../lib/agent-trace'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../../lib/utils'

export function ChangesPanel({ sessionId, traces }: { sessionId: string; traces?: Map<string, AgentTrace> }) {
  const [open, setOpen] = useState<boolean>(true)
  const [tab, setTab] = useState<'unstaged' | 'staged'>('unstaged')
  const [onlyNew, setOnlyNew] = useState<boolean>(false)
  const changesQ = useQuery({ queryKey: ['changes', sessionId], queryFn: () => api.getChanges(sessionId), refetchInterval: 2500 })

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
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AppliedChanges({ sessionId, tab, onTabChange, staged, unstaged }: { sessionId: string; tab: 'unstaged' | 'staged'; onTabChange: (t: 'unstaged' | 'staged') => void; staged: Array<{ path: string; status: string; renamed_from?: string }>; unstaged: Array<{ path: string; status: string; renamed_from?: string }> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const curr = tab === 'staged' ? staged : unstaged
  return (
    <div>
      <div className="mb-2 inline-flex items-center gap-1 rounded border p-0.5 bg-slate-50">
        <Button size="sm" variant={tab === 'unstaged' ? 'secondary' : 'ghost'} onClick={() => onTabChange('unstaged')}>Unstaged ({unstaged.length})</Button>
        <Button size="sm" variant={tab === 'staged' ? 'secondary' : 'ghost'} onClick={() => onTabChange('staged')}>Staged ({staged.length})</Button>
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
    </div>
  )
}

function FileDiff({ sessionId, entry, side, open, onToggle }: { sessionId: string; entry: { path: string; status: string; renamed_from?: string }; side: 'worktree' | 'index'; open: boolean; onToggle: () => void }) {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const j = await api.getDiff(sessionId, entry.path, side, 3)
        if (!cancelled) {
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
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ScrollArea className="max-h-72">
              <pre className={cn('text-xs whitespace-pre p-2')}>{diff}</pre>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}

