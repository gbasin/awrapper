import * as React from 'react'
import { cn } from '../../lib/utils'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
})
Select.displayName = 'Select'

export { Select }

