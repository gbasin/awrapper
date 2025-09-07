import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Session from './routes/Session'
import NewSession from './routes/NewSession'
import { SessionSidebar } from './components/SessionSidebar'
import { Button } from './components/ui/button'
import { PanelLeftOpen } from 'lucide-react'

export default function App() {
  const loc = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('awrapper:sidebarOpen') !== '0' } catch { return true }
  })
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('awrapper:sidebarWidth')
      const n = raw ? parseInt(raw, 10) : 0
      return Number.isFinite(n) && n >= 220 && n <= 520 ? n : 288
    } catch {
      return 288
    }
  })
  useEffect(() => {
    try { localStorage.setItem('awrapper:sidebarOpen', sidebarOpen ? '1' : '0') } catch {}
  }, [sidebarOpen])
  useEffect(() => {
    try { localStorage.setItem('awrapper:sidebarWidth', String(sidebarWidth)) } catch {}
  }, [sidebarWidth])
  return (
    <div className="h-full flex flex-col bg-white text-slate-900">
      <header className="border-b">
        <div className="px-3 h-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button className="md:hidden" variant="ghost" size="sm" onClick={() => setSidebarOpen(true)} title="Open sidebar" aria-label="Open sidebar">
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <Link to="/" className="font-semibold">awrapper</Link>
          </div>
          <nav className="text-xs text-slate-600">{loc.pathname}</nav>
        </div>
      </header>
      <main className={"flex-1 min-h-0 flex overflow-hidden"}>
        {/* Mobile overlay backdrop */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <SessionSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpen={() => setSidebarOpen(true)}
          width={sidebarWidth}
          onResize={(w) => setSidebarWidth(Math.max(220, Math.min(520, Math.round(w))))}
        />
        <div className={'flex-1 min-h-0 flex flex-col px-3 py-2'}>
          <Routes>
            <Route path="/" element={<Navigate to="/new" replace />} />
            <Route path="/new" element={<NewSession />} />
            <Route path="/s/:id" element={<Session />} />
            <Route path="*" element={<div>Not Found</div>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
