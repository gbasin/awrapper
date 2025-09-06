import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type Session } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Skeleton } from './ui/skeleton'
import { cn } from '../lib/utils'
import { PanelLeftClose } from 'lucide-react'

export function SessionSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loc = useLocation()
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions(), staleTime: 5000, refetchInterval: 10000 })
  const activeId = loc.pathname.startsWith('/s/') ? loc.pathname.split('/')[2] : null

  return (
    <aside
      className={
        cn(
          // Base
          'bg-slate-50 h-full flex flex-col border-r shrink-0 transition-all duration-200',
          // Mobile: slide-over from left under header
          'fixed top-14 left-0 bottom-0 z-40 w-72 -translate-x-full md:translate-x-0 md:static md:shadow-none',
          open && 'translate-x-0',
          // Desktop: inline width collapses to 0 when closed
          open ? 'md:w-72' : 'md:w-0 md:border-transparent'
        )
      }
      aria-hidden={open ? undefined : true}
    >
      <div className="h-14 px-3 border-b flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800">Sessions</div>
        <div className="flex items-center gap-2">
          <Link to="/new">
            <Button size="sm" variant={loc.pathname === '/new' ? 'default' : 'secondary'}>New</Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={onClose} title="Hide sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2">
          {q.isLoading && (
            <div className="space-y-2 px-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-6 w-36" />
            </div>
          )}
          {q.error && <div className="px-3 py-2 text-sm text-red-600">Failed to load</div>}
          {q.data && (
            q.data.length ? (
              <ul className="space-y-1 px-2">
                {q.data
                  .slice()
                  .sort((a, b) => timeKey(b) - timeKey(a))
                  .map((s) => (
                  <li key={s.id}>
                    <Link to={`/s/${s.id}`} className={itemClass(activeId === s.id)}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-xs font-medium">{s.id}</span>
                        <Badge variant={badgeVariant(s.status)} className="shrink-0 text-[10px]">{s.status}</Badge>
                      </div>
                      <div className="truncate text-[10px] text-slate-500">{s.repo_path}{s.branch ? ` @ ${s.branch}` : ''}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500">No sessions yet</div>
            )
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function badgeVariant(status: string): 'success' | 'warning' | 'secondary' | 'outline' {
  if (status === 'running') return 'success'
  if (status === 'queued') return 'warning'
  if (status === 'closed' || status === 'stale') return 'secondary'
  return 'outline'
}

function itemClass(active: boolean) {
  return [
    'block rounded px-2.5 py-1.5 border',
    active ? 'bg-white border-slate-300 shadow-sm' : 'bg-white/60 hover:bg-white border-transparent',
  ].join(' ')
}

function timeKey(s: Session): number {
  return (s.last_activity_at ?? s.started_at ?? 0) as number
}
