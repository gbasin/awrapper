import * as React from 'react'
import { cn } from '../../lib/utils'

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
}
function Thead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('text-left text-slate-500', className)} {...props} />
}
function Tbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('', className)} {...props} />
}
function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-t', className)} {...props} />
}
function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('p-2', className)} {...props} />
}
function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('p-2', className)} {...props} />
}

export { Table, Thead, Tbody, Tr, Th, Td }

