'use client'

import Link from 'next/link'
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
]

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/dashboard')
    return pathname === '/' || pathname.startsWith('/dashboard')
  return pathname.startsWith(href)
}

export function WebTopNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
      <PageContainer className="flex items-center gap-6 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-foreground transition hover:opacity-90"
        >
          <KeeponLogo className="h-6 w-auto" aria-hidden />
          <span className="sr-only">Keepon home</span>
        </Link>

        <NavigationMenu className="flex-1">
          <NavigationMenuList className="flex-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)

              return (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink
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
