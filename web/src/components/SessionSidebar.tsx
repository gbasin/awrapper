import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, type Session } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Skeleton } from './ui/skeleton'
import { cn } from '../lib/utils'
import { PanelLeftClose, Loader2, Clock, MinusCircle, HelpCircle } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

export function SessionSidebar({ open, onClose, width, onResize }: { open: boolean; onClose: () => void; width: number; onResize: (w: number) => void }) {
  const loc = useLocation()
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.listSessions(), staleTime: 5000, refetchInterval: 10000 })
  const activeId = loc.pathname.startsWith('/s/') ? loc.pathname.split('/')[2] : null
  const asideRef = useRef<HTMLDivElement | null>(null)

  const startResize = useCallback((e: React.MouseEvent) => {
    // Only allow on desktop sizes
    if (!window.matchMedia('(min-width: 768px)').matches) return
    e.preventDefault()
    const el = asideRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const startLeft = rect.left
    const move = (ev: MouseEvent) => {
      const next = ev.clientX - startLeft
      onResize(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [onResize])

  return (
    <aside
      className={
        cn(
          // Base
          'relative bg-slate-50 h-full flex flex-col border-r shrink-0 transition-all duration-200',
          // Mobile: slide-over from left under header
          'fixed top-14 left-0 bottom-0 z-40 w-72 -translate-x-full md:translate-x-0 md:static md:shadow-none',
          open && 'translate-x-0',
          // Desktop: inline width collapses to 0 when closed
          open ? 'md:w-[var(--sb-w)]' : 'md:w-14'
        )
      }
      ref={asideRef as any}
      style={{
        // On desktop we drive width via CSS var (for transition). Mobile keeps w-72.
        // Fallback to 288 if something odd happens with width.
        ['--sb-w' as any]: `${Math.max(220, Math.min(520, width || 288))}px`,
        width: undefined,
      }}
      aria-hidden={open ? undefined : true}
    >
      {/* Expanded content */}
      <div className={cn('h-full flex-col', open ? 'hidden md:flex' : 'hidden')}>
        <div className="h-14 px-3 border-b flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">Sessions</div>
          <div className="flex items-center gap-2">
            <Link to="/new">
              <Button size="sm" variant={loc.pathname === '/new' ? 'default' : 'secondary'}>New</Button>
            </Link>
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
                          <Badge
                            variant={badgeVariant(s.status)}
                            className="shrink-0 text-[10px]"
                            title={s.status}
                            aria-label={s.status}
                          >
                            {s.status === 'running' ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : s.status === 'queued' ? (
                              <Clock className="h-3 w-3" />
                            ) : s.status === 'closed' ? (
                              <MinusCircle className="h-3 w-3" />
                            ) : s.status === 'stale' ? (
                              <Clock className="h-3 w-3" />
                            ) : (
                              <HelpCircle className="h-3 w-3" />
                            )}
                          </Badge>
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
        {/* Resizer handle (desktop only) */}
        <div
          className="hidden md:block absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-transparent hover:bg-slate-200 active:bg-slate-300"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      </div>

      {/* Collapsed rail content (desktop only) */}
      <div className={cn('hidden md:flex h-full flex-col items-center gap-2 py-2', open ? 'md:hidden' : 'md:flex')}
        aria-label="Session status rail"
      >
        {q.isLoading && (
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-3 rounded-full" />
          </div>
        )}
        {q.error && <div className="rotate-90 text-[10px] text-red-600">error</div>}
        {q.data && q.data.length === 0 && <div className="rotate-90 text-[10px] text-slate-500">empty</div>}
        <div className="flex-1 overflow-y-auto">
          <ul className="flex flex-col items-center gap-3">
            {q.data?.slice().sort((a,b)=>timeKey(b)-timeKey(a)).map((s) => (
              <li key={s.id}>
                <Link
                  to={`/s/${s.id}`}
                  title={`${s.id}\n${s.repo_path}${s.branch ? ` @ ${s.branch}` : ''}`}
                  className={cn('block h-8 w-8 rounded-full border flex items-center justify-center', activeId === s.id ? 'border-slate-400 ring-2 ring-slate-200' : 'border-transparent')}
                >
                  <span className={cn('inline-block h-3 w-3 rounded-full', statusDot(s.status))} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
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

function statusDot(status: string) {
  if (status === 'running') return 'bg-emerald-500'
  if (status === 'queued') return 'bg-amber-500'
  if (status === 'closed' || status === 'stale') return 'bg-slate-400'
  return 'bg-slate-300'
}
