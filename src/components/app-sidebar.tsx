'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'

import type { LucideIcon } from 'lucide-react'
import { Calendar, LayoutDashboard, Menu, Settings, Users, Wallet, X } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Calendar', href: '/calendar', icon: Calendar },
  { label: 'Finance', href: '/finance', icon: Wallet },
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Settings', href: '/settings', icon: Settings },
] as const satisfies readonly { label: string; href: Route; icon: LucideIcon }[]

function isActive(pathname: string | null, href: Route) {
  if (!pathname) {
    return false
  }
  if (href === '/dashboard') {
    return pathname === '/' || pathname.startsWith('/dashboard')
  }
  return pathname.startsWith(href)
}

function AppSidebarNav({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className={cn('flex flex-col gap-1', className)} aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => onNavigate?.()}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              active
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-full flex-col gap-6 py-6">
        <AppSidebarNav className="px-3" />
      </div>
    </aside>
  )
}

export function AppSidebarMobile() {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-foreground')}
        aria-label="Open navigation"
      >
        <Menu className="size-4" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 max-w-[80vw] border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between px-4 py-3">
          <SheetTitle className="text-sm">Navigation</SheetTitle>
          <SheetClose
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
              'text-sidebar-foreground hover:bg-sidebar-accent'
            )}
            aria-label="Close navigation"
          >
            <X className="size-4" aria-hidden="true" />
          </SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <AppSidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
