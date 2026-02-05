'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ className, ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" className={cn(className)} {...props} />
}

function SheetClose({ className, ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" className={cn(className)} {...props} />
}

function SheetPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 dark:bg-black/60',
        className
      )}
      {...props}
    />
  )
}

type SheetSide = 'top' | 'bottom' | 'left' | 'right'

const sheetSideClasses: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 border-b data-closed:slide-out-to-top-8 data-open:slide-in-from-top-8',
  bottom: 'inset-x-0 bottom-0 border-t data-closed:slide-out-to-bottom-8 data-open:slide-in-from-bottom-8',
  left: 'inset-y-0 left-0 border-r data-closed:slide-out-to-left-8 data-open:slide-in-from-left-8',
  right: 'inset-y-0 right-0 border-l data-closed:slide-out-to-right-8 data-open:slide-in-from-right-8',
}

function SheetContent({ side = 'right', className, ...props }: DialogPrimitive.Popup.Props & { side?: SheetSide }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex max-h-screen flex-col bg-background text-foreground shadow-lg outline-none transition data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0',
          sheetSideClasses[side],
          className
        )}
        {...props}
      />
    </SheetPortal>
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-sm font-medium', className)} {...props} />
}

function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetPortal, SheetOverlay, SheetTitle, SheetDescription }
