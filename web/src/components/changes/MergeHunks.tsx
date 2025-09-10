import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
  header: string
}

function parseUnifiedHunks(diffText: string): Hunk[] {
  const lines = (diffText || '').split(/\r?\n/)
  const hunks: Hunk[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line)
    if (m) {
      const oldStart = parseInt(m[1] || '0', 10)
      const oldLines = parseInt(m[2] || '0', 10) || 0
      const newStart = parseInt(m[3] || '0', 10)
      const newLines = parseInt(m[4] || '0', 10) || 0
      const header = line
      i += 1
      const hunkLines: string[] = []
      while (i < lines.length && !/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.test(lines[i])) {
        const l = lines[i]
        if (!l) { hunkLines.push('') } else { hunkLines.push(l) }
        i += 1
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: hunkLines, header })
      continue
    }
    i += 1
  }
  return hunks
}

function applySelectedHunksToBase(baseText: string, hunks: Hunk[], selected: boolean[]): string {
  // Apply hunks to base (HEAD) to produce merged content
  const baseEndsWithNL = /\n$/.test(baseText)
  let lines = baseText.split(/\n/)
  // If the text ended with newline, splitting removes it, which is fine when rejoining
  // Track offset from previous insertions/deletions
  let offset = 0
  for (let idx = 0; idx < hunks.length; idx++) {
    if (!selected[idx]) continue
    const h = hunks[idx]
    const newSeg: string[] = []
    for (const l of h.lines) {
      if (l.startsWith(' ')) newSeg.push(l.slice(1))
      else if (l.startsWith('+')) newSeg.push(l.slice(1))
      else if (l.startsWith('-')) {
        // removal; skip in new segment
      } else if (l.startsWith('\\')) {
        // "\\ No newline at end of file" marker — ignore
      } else {
        // treat as context
        newSeg.push(l)
      }
    }
    const start = Math.max(0, h.oldStart - 1 + offset)
    const deleteCount = Math.max(0, h.oldLines)
    lines.splice(start, deleteCount, ...newSeg)
    offset += newSeg.length - deleteCount
  }
  let out = lines.join('\n')
  if (baseEndsWithNL && !/\n$/.test(out)) out += '\n'
  return out
}

export function MergeHunks({ sessionId, path, onSaved }: { sessionId: string; path: string; onSaved: (stageAfterSave: boolean) => void | Promise<void> }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string>('')
  const [headText, setHeadText] = useState<string>('')
  const [worktreeEtag, setWorktreeEtag] = useState<string>('')
  const [sel, setSel] = useState<boolean[]>([])
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const [d, head, wt] = await Promise.all([
          api.getDiff(sessionId, path, 'worktree', 3),
          api.getFile(sessionId, path, 'head'),
          api.getFile(sessionId, path, 'worktree'),
        ])
        if (cancelled) return
        if (d.isBinary) {
          setErr('Binary file; merge disabled')
          setLoading(false)
          return
        }
        setDiffText(d.diff || '')
        setHeadText(head.content || '')
        setWorktreeEtag(wt.etag)
        // Initialize selection: select all hunks by default
        const hunks = parseUnifiedHunks(d.diff || '')
        setSel(hunks.map(() => true))
      } catch (e: any) {
        if (!cancelled) setErr('Failed to load diff or file')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId, path, reloadKey])

  const hunks = useMemo(() => parseUnifiedHunks(diffText), [diffText])

  async function save(stageAfter: boolean) {
    try {
      setSaving(true)
      const merged = applySelectedHunksToBase(headText, hunks, sel)
      await api.putFile(sessionId, { path, content: merged, expected_etag: worktreeEtag })
      await onSaved(stageAfter)
    } catch (e: any) {
      // Surface 409 explicitly if possible
      setErr('Save failed (possibly due to concurrent edits). Refresh and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-xs text-slate-600">Loading…</div>
  if (err) return (
    <div className="text-xs text-red-600 flex items-center gap-2">
      <span>{err}</span>
      <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}>Reload</Button>
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-700">Select hunks to apply from HEAD → worktree:</div>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={sel.every(Boolean)}
            onChange={(e) => {
              const v = e.currentTarget.checked
              setSel(sel.map(() => v))
            }}
          />
          <span>Select all</span>
        </label>
      </div>
      <ScrollArea className="max-h-72 rounded border bg-white">
        <div className="text-xs font-mono whitespace-pre p-2">
          {hunks.length === 0 ? (
            <div className="text-slate-500">No differences</div>
          ) : (
            hunks.map((h, i) => (
              <div key={i} className="mb-3">
                <div className="flex items-center justify-between bg-slate-100 px-2 py-1 rounded">
                  <div className="text-slate-700">{h.header}</div>
                  <label className="inline-flex items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={!!sel[i]}
                      onChange={(e) => setSel(sel.map((v, j) => (j === i ? e.currentTarget.checked : v)))}
                    />
                    <span>Accept hunk</span>
                  </label>
                </div>
                <div>
                  {h.lines.map((l, j) => (
                    <div key={j} className={
                      l.startsWith('+') ? 'text-emerald-700' : l.startsWith('-') ? 'text-red-700' : 'text-slate-800'
                    }>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <div className="flex items-center gap-2">
        <Button disabled={saving} size="sm" variant="secondary" onClick={() => save(false)}>Save</Button>
        <Button disabled={saving} size="sm" variant="ghost" onClick={() => save(true)}>Save & Stage</Button>
      </div>
    </div>
  )
}
