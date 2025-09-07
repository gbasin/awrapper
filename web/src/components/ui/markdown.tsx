import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code-block'
import { Button } from './button'
import { Copy } from 'lucide-react'

type MarkdownProps = {
  className?: string
  children: string
}

// Renders markdown content with Tailwind Typography and custom code blocks.
export function Markdown({ className, children }: MarkdownProps) {
  return (
    <ReactMarkdown
      className={['prose prose-slate max-w-none prose-pre:p-0 prose-code:before:content-[none] prose-code:after:content-[none]', className].filter(Boolean).join(' ')}
      // GFM adds tables, strikethrough, task lists, autolinks
      remarkPlugins={[remarkGfm]}
      // Note: do not enable raw HTML for safety; default escapes HTML
      components={{
        // Headings and paragraphs get compact spacing for chat bubbles
        h1: ({ node, ...props }) => <h1 {...props} className="text-lg mt-2 mb-1" />,
        h2: ({ node, ...props }) => <h2 {...props} className="text-base mt-2 mb-1" />,
        h3: ({ node, ...props }) => <h3 {...props} className="text-sm mt-2 mb-1" />,
        p: ({ node, ...props }) => <p {...props} className="my-1" />,
        ul: ({ node, ...props }) => <ul {...props} className="my-1 list-disc pl-5" />,
        ol: ({ node, ...props }) => <ol {...props} className="my-1 list-decimal pl-5" />,
        a: ({ node, ...props }) => <a {...props} className="underline underline-offset-2" target="_blank" rel="noreferrer" />,
        code({ node, inline, className, children, ...props }) {
          const txt = String(children || '')
          const lang = /language-([\w+-]+)/.exec(className || '')?.[1]
          if (inline) {
            return (
              <code {...props} className="mono rounded bg-slate-100 px-1 py-0.5 text-[12px]">
                {txt}
              </code>
            )
          }
          return (
            <div className="relative inline-block max-w-full">
              <CodeBlock code={txt.replace(/\n$/, '')} lang={lang} className="mt-1" />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-2 top-2 h-7 w-7 p-0"
                title="Copy to clipboard"
                aria-label="Copy to clipboard"
                onClick={() => {
                  navigator.clipboard.writeText(txt).catch(() => {/* ignore */})
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        },
        pre({ node, className, children, ...props }) {
          // Handled by code() above to avoid double-wrapping
          return <>{children}</>
        },
        table: ({ node, ...props }) => (
          <div className="overflow-x-auto my-2">
            <table {...props} className="table-auto text-sm" />
          </div>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
