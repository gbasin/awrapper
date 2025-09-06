import * as React from 'react'
import { cn } from '../../lib/utils'

export function Breadcrumb({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <nav className={cn('text-sm text-slate-600', className)} aria-label="Breadcrumb" {...props}>
      <ol className="flex items-center gap-1 flex-wrap">{children}</ol>
    </nav>
  )
}

export function BreadcrumbItem({ className, children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li className={cn('flex items-center gap-1', className)} {...props}>
      {children}
    </li>
  )
}

export function BreadcrumbLink({ className, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn('hover:underline text-slate-900', className)} {...props}>
      {children}
    </a>
  )
}

export function BreadcrumbSeparator({ className, children = '/', ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('px-1 text-slate-400', className)} {...props}>
      {children}
    </span>
  )
}

