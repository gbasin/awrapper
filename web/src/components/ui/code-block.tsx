import * as React from 'react'
import hljs from 'highlight.js'
import { cn } from '../../lib/utils'

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const html = React.useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
    } catch {}
    try {
      return hljs.highlightAuto(code).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, lang])

  return (
    <pre className={cn('mono whitespace-pre-wrap rounded bg-slate-900 p-3 text-slate-100 text-xs inline-block max-w-full', className)}>
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
