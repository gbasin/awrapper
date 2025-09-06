import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Home from './routes/Home'
import Session from './routes/Session'

export default function App() {
  const loc = useLocation()
  return (
    <div className="min-h-full bg-white text-slate-900">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-semibold">awrapper</Link>
          <nav className="text-sm text-slate-600">{loc.pathname}</nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/s/:id" element={<Session />} />
          <Route path="*" element={<div>Not Found</div>} />
        </Routes>
      </main>
    </div>
  )
}

