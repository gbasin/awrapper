import React from 'react'
// Use the hooks-based async renderer so async rehype plugins work client-side
import { MarkdownHooks as ReactMarkdown } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypePrettyCode from 'rehype-pretty-code'
import { Button } from './button'
import { Copy } from 'lucide-react'
import { cn } from '../../lib/utils'

type MarkdownProps = {
  className?: string
  children: string
}

// Renders markdown content with Tailwind Typography and custom code blocks.
export function Markdown({ className, children }: MarkdownProps) {
  // Provide stable component identities to avoid any hook ordering edge cases
  const components = React.useMemo(() => ({
    // Compact spacing for chat bubbles
    h1: ({ node, ...props }: any) => <h1 {...props} className="text-lg mt-2 mb-1" />,
    h2: ({ node, ...props }: any) => <h2 {...props} className="text-base mt-2 mb-1" />,
    h3: ({ node, ...props }: any) => <h3 {...props} className="text-sm mt-2 mb-1" />,
    p: ({ node, ...props }: any) => <p {...props} className="my-1" />,
    ul: ({ node, ...props }: any) => <ul {...props} className="my-1 list-disc pl-5" />,
    ol: ({ node, ...props }: any) => <ol {...props} className="my-1 list-decimal pl-5" />,
    a: ({ node, ...props }: any) => <a {...props} className="underline underline-offset-2" target="_blank" rel="noreferrer" />,
    code: InlineCode,
    pre: PreBlock,
    table: ({ node, ...props }: any) => (
      <div className="overflow-x-auto my-2">
        <table {...props} className="table-auto text-sm" />
      </div>
    ),
  }), [])

  return (
    <ReactMarkdown
      className={cn(
        'prose prose-slate dark:prose-invert max-w-none prose-pre:p-0 prose-code:before:content-[none] prose-code:after:content-[none]',
        className,
      )}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex], [rehypePrettyCode, prettyCodeOptions as any]]}
      components={components as any}
    >
      {children}
    </ReactMarkdown>
  )
}

// Standalone components to keep hook usage clearly within component bodies
function InlineCode(codeProps: any) {
  const { inline, className, children, ...props } = codeProps
  const raw = String(children || '')
  const text = raw.replace(/\n+$/, '')
  const isOneLineFenced = !inline && !text.includes('\n')
  if (inline || isOneLineFenced) {
    return (
      <code
        {...props}
        data-inline-chip
        className="mono rounded bg-slate-100 dark:bg-slate-800 px-1 py-[1px] text-[1em] cursor-pointer"
        title="Click to copy"
        role="button"
        tabIndex={0}
        onClick={() => { navigator.clipboard.writeText(text).catch(() => {}) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            navigator.clipboard.writeText(text).catch(() => {})
            e.preventDefault()
          }
        }}
      >
        {text}
      </code>
    )
  }
  return <code {...props} className={className}>{children}</code>
}

function PreBlock({ children, ...props }: any) {
  // Hooks must be called unconditionally in the same order every render
  const ref = React.useRef<HTMLPreElement>(null)
  const [hasText, setHasText] = React.useState(true)
  React.useEffect(() => {
    const t = (ref.current?.innerText || '').trim()
    setHasText(t.length > 0)
  }, [children])

  const kids = React.Children.toArray(children)
  if (kids.length === 1 && React.isValidElement(kids[0]) && (kids[0] as any).props?.['data-inline-chip']) {
    return <>{kids[0]}</>
  }
  return (
    <div className="relative inline-block max-w-full">
      <pre
        ref={ref}
        {...props}
        className={cn('mono whitespace-pre-wrap rounded bg-slate-900 text-slate-100 text-xs p-3 overflow-x-auto inline-block max-w-full', !hasText && 'hidden', (props as any).className)}
      >
        {children}
      </pre>
      {hasText && (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute right-2 top-2 h-5 w-5 p-0"
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
          onClick={() => { const text = ref.current?.innerText || ''; navigator.clipboard.writeText(text).catch(() => {}) }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}

const prettyCodeOptions = {
  theme: {
    light: 'github-light',
    dark: 'github-dark',
  },
  keepBackground: false,
}
