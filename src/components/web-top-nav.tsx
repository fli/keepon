'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'
import { PageContainer } from './page-container'
import { KeeponLogo } from './keepon-logo'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Finance', href: '/finance' },
  { label: 'Clients', href: '/clients' },
  { label: 'Settings', href: '/settings' },
] as const satisfies ReadonlyArray<{ label: string; href: Route }>

function isActive(pathname: string | null, href: Route) {
  if (!pathname) return false
  if (href === '/dashboard') return pathname === '/' || pathname.startsWith('/dashboard')
  return pathname.startsWith(href)
}

export function WebTopNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
      <PageContainer className="flex flex-wrap items-center gap-3 px-3 py-2 sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-3">
        <Link
          href="/dashboard"
          className="hidden items-center gap-2 text-foreground transition hover:opacity-90 sm:flex"
        >
          <KeeponLogo className="h-6 w-auto" aria-hidden />
          <span className="sr-only">Keepon home</span>
        </Link>

        <NavigationMenu className="min-w-0 flex-1">
          <NavigationMenuList>
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)

              return (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink
                    className="h-8 px-2 text-[12px] leading-tight sm:h-9 sm:px-3 sm:text-sm"
                    active={active}
                    aria-current={active ? 'page' : undefined}
                    render={<Link href={item.href} />}
                  >
                    {item.label}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              )
            })}
          </NavigationMenuList>
        </NavigationMenu>
      </PageContainer>
    </header>
  )
}
