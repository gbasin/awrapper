import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Home from './routes/Home'
import Session from './routes/Session'

export default function App() {
  const loc = useLocation()
  const isSession = loc.pathname.startsWith('/s/')
  return (
    <div className="h-full flex flex-col bg-white text-slate-900">
      <header className="border-b">
        <div className="px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-semibold">awrapper</Link>
          <nav className="text-sm text-slate-600">{loc.pathname}</nav>
        </div>
      </header>
      <main className={"flex-1 min-h-0 flex px-4 py-4"}>
        <div className={'flex-1 min-h-0 flex flex-col'}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/s/:id" element={<Session />} />
            <Route path="*" element={<div>Not Found</div>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
