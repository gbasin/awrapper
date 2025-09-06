import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Separator } from '../components/ui/separator'

type RootsResp = { roots: Array<{ path: string; label: string }> }
type ListResp = { path: string; parent?: string; entries: Array<{ name: string; path: string; is_dir: boolean; is_repo?: boolean }> }

export function BrowseDialog({ onSelect }: { onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<RootsResp | ListResp | null>(null)
  const [onlyGit, setOnlyGit] = useState<boolean>(() => {
    try {
      return localStorage.getItem('awrapper:browseOnlyGit') !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  async function load(path?: string) {
    const res = await fetch('/browse' + (path ? `?path=${encodeURIComponent(path)}` : ''))
    if (!res.ok) return
    const json = (await res.json()) as RootsResp | ListResp
    setData(json)
  }

  function setOnlyGitPersist(val: boolean) {
    setOnlyGit(val)
    try {
      localStorage.setItem('awrapper:browseOnlyGit', val ? '1' : '0')
    } catch {}
  }

  function Content() {
    if (!data) return <div className="text-sm text-slate-500">Loading…</div>
    if ('roots' in data) {
      return (
        <div className="space-y-2">
          <div className="text-sm text-slate-500">Roots</div>
          <ul className="space-y-1">
            {data.roots.map((r) => (
              <li key={r.path}>
                <Button variant="ghost" onClick={() => load(r.path)} className="px-0 text-left hover:underline">
                  {r.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    const entries = (onlyGit ? data.entries.filter((e) => e.is_repo) : data.entries).sort((a, b) => a.name.localeCompare(b.name))
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div>
            Path: <span className="text-slate-500">{data.path}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-slate-600">
              <input type="checkbox" className="mr-1 align-middle" checked={onlyGit} onChange={(e) => setOnlyGitPersist(e.target.checked)} /> Only Git repos
            </label>
            <Button variant="secondary" onClick={() => onSelect(data.path)}>Use here</Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {data.parent ? (
            <Button variant="ghost" onClick={() => load(data.parent)} className="px-0 hover:underline">
              ↑ Up
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => load()} className="px-0 hover:underline">
              Roots
            </Button>
          )}
        </div>
        <Separator />
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {entries.map((e) => (
            <li key={e.path} className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => load(e.path)} className="px-0 text-left hover:underline">
                {e.name}
                {e.is_repo ? ' • git' : ''}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onSelect(e.path)}>
                Select
              </Button>
            </li>
          ))}
          {entries.length === 0 && <div className="text-sm text-slate-500">No git repos here.</div>}
        </ul>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">Browse…</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a repository</DialogTitle>
        </DialogHeader>
        <Content />
      </DialogContent>
    </Dialog>
  )
}

