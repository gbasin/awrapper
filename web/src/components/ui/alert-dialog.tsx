import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '../../lib/utils'
import { Button } from './button'

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal
const AlertDialogOverlay = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-40 bg-black/40', className)} {...props} />
  )
)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content ref={ref} className={cn('fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-4 shadow', className)} {...props} />
    </AlertDialogPortal>
  )
)
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5', className)} {...props} />
)
const AlertDialogTitle = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold', className)} {...props} />
)
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName
const AlertDialogDescription = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Description ref={ref} className={cn('text-sm text-slate-600', className)} {...props} />
)
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex justify-end gap-2', className)} {...props} />
)

const AlertDialogCancel = AlertDialogPrimitive.Cancel
const AlertDialogAction = AlertDialogPrimitive.Action

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
}

