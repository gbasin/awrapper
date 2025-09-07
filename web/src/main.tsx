import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import './styles/globals.css'
import 'katex/dist/katex.min.css'

const qc = new QueryClient()

const el = document.getElementById('root')!
const root = createRoot(el)
root.render(
  <QueryClientProvider client={qc}>
    <BrowserRouter>
      <App />
      <Toaster richColors />
    </BrowserRouter>
  </QueryClientProvider>
)
