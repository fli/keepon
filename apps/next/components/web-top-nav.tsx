'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur-lg">
      <div className="page-shell flex items-center gap-6 py-3">
        <div className="flex items-baseline gap-2 text-[var(--color-text)]">
          <span className="text-lg font-semibold">Keepon</span>
          <span className="text-sm text-[var(--color-secondaryText)]">
            Coach tools
          </span>
        </div>

        <nav className="flex flex-1 flex-wrap items-center gap-2 text-sm font-medium">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            const classes = [
              'rounded-full px-3 py-2 transition-colors',
              active
                ? 'bg-[var(--color-background)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-secondaryText)] hover:text-[var(--color-text)]',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <Link
                key={item.href}
                href={item.href}
                className={classes}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/sales/make" className="btn btn-primary text-sm">
            Make sale
          </Link>
        </div>
      </div>
    </header>
  )
}
