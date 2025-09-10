import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { api } from '../../lib/api'
import { Button } from '../ui/button'

export function MergeCM({ sessionId, path, onSaved }: { sessionId: string; path: string; onSaved: (stage: boolean) => void | Promise<void> }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mvRef = useRef<MergeView | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [etag, setEtag] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      setErr(null)
      try {
        // Ensure container exists in the DOM
        await new Promise((r) => setTimeout(r, 0))
        const parent = containerRef.current
        if (!parent) return

        const [head, wt] = await Promise.all([
          api.getFile(sessionId, path, 'head'),
          api.getFile(sessionId, path, 'worktree'),
        ])
        if (cancelled) return
        setEtag(wt.etag)
        // Create MergeView with a=HEAD (readonly) and b=worktree (editable)
        // Cleanup previous
        if (mvRef.current) {
          mvRef.current.destroy()
          mvRef.current = null
        }
        const mv = new MergeView({
          a: { doc: head.content, extensions: [EditorView.editable.of(false)] },
          b: { doc: wt.content },
          parent
        })
        mvRef.current = mv
      } catch (e: any) {
        if (!cancelled) setErr('Failed to load file content for merge')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
      try { mvRef.current?.destroy() } catch {}
      mvRef.current = null
    }
  }, [sessionId, path])

  async function save(stageAfter: boolean) {
    try {
      setSaving(true)
      // Always fetch current worktree etag to guard concurrency
      const wtNow = await api.getFile(sessionId, path, 'worktree')
      let content = wtNow.content || ''
      const mv = mvRef.current
      if (mv && (mv as any).b) {
        const b = (mv as any).b as EditorView
        content = b.state.doc.toString()
      }
      await api.putFile(sessionId, { path, content, expected_etag: wtNow.etag })
      await onSaved(stageAfter)
    } catch (e: any) {
      setErr('Save failed (possible concurrent edit). Reload and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-xs text-slate-600">Loading…</div>
  if (err) return <div className="text-xs text-red-600">{err}</div>

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="rounded border overflow-hidden" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => save(false)}>Save</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(true)}>Save & Stage</Button>
      </div>
    </div>
  )
}
