'use client'

import type { Route } from 'next'
import type { ReactNode } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { CreditCard, HelpCircle, LogOut, Menu, X, ShieldCheck, Home, Mail, ExternalLink, FileText } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useTransition } from 'react'

import { logoutClientDashboard } from '@/app/(client-dashboard)/client-dashboard/actions'
import { KeeponLogo } from '@/components/keepon-logo'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export type ClientDashboardShellProps = {
  children: ReactNode
  serviceProvider: {
    name: string
    logoUrl?: string | null
    brandColor: string
  }
  clientEmail: string
  stripePublishableKey: string | null
  stripeAccount?: {
    id: string
    type: 'standard' | 'custom'
  } | null
}

const navLinks = [
  { href: '/client-dashboard', label: 'Home', icon: Home },
  { href: '/client-dashboard/payment-method', label: 'Payment Method', icon: CreditCard },
  { href: '/client-dashboard/faq', label: 'Help Center', icon: HelpCircle },
] as const

const helpLinks = [
  {
    href: 'mailto:enquiry@getkeepon.com?subject=Client%20Dashboard%20Feedback&body=%0A%0A',
    label: 'Feedback',
    icon: Mail,
    external: true,
  },
  {
    href: 'https://getkeepon.com/terms-of-service/',
    label: 'Terms',
    icon: FileText,
    external: true,
  },
  {
    href: 'https://getkeepon.com/privacy',
    label: 'Privacy',
    icon: ShieldCheck,
    external: true,
  },
]

function NavLinks({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className={cn('space-y-1', className)}>
      {navLinks.map((link) => {
        const isActive = pathname === link.href
        const Icon = link.icon
        return (
          <Link
            key={link.href}
            href={link.href as Route}
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden />
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}

function HelpLinks({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      {helpLinks.map((link) => {
        const Icon = link.icon
        return (
          <a
            key={link.href}
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noreferrer' : undefined}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            <Icon className="size-4" aria-hidden />
            <span>{link.label}</span>
            {link.external ? <ExternalLink className="ml-auto size-3 text-muted-foreground" aria-hidden /> : null}
          </a>
        )
      })}
    </div>
  )
}

export function ClientDashboardShell({
  children,
  serviceProvider,
  clientEmail,
  stripePublishableKey,
  stripeAccount,
}: ClientDashboardShellProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const stripePromise = useMemo(() => {
    if (!stripePublishableKey) {
      return null
    }
    const options = stripeAccount?.type === 'standard' ? { stripeAccount: stripeAccount.id } : undefined
    return loadStripe(stripePublishableKey, options)
  }, [stripeAccount, stripePublishableKey])

  const handleLogout = () => {
    startTransition(async () => {
      await logoutClientDashboard()
      router.replace('/client-dashboard/login')
    })
  }

  return (
    <div
      className="min-h-screen bg-muted/40"
      style={
        {
          '--primary': serviceProvider.brandColor,
          '--ring': serviceProvider.brandColor,
          '--sidebar-primary': serviceProvider.brandColor,
          '--sidebar-ring': serviceProvider.brandColor,
        } as React.CSSProperties
      }
    >
      <Elements stripe={stripePromise}>
        <div className="mx-auto flex min-h-screen w-full max-w-[1400px]">
          <aside className="hidden w-64 flex-col border-r border-border/60 bg-background/90 p-5 lg:flex">
            <div className="flex items-center gap-3">
              {serviceProvider.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={serviceProvider.logoUrl}
                  alt={serviceProvider.name}
                  className="h-10 w-10 rounded-full object-contain"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <KeeponLogo className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{serviceProvider.name}</p>
                <p className="text-xs text-muted-foreground">Client dashboard</p>
              </div>
            </div>

            <div className="mt-6 flex-1 space-y-6">
              <NavLinks />
              <div className="border-t border-border/60 pt-4">
                <HelpLinks />
              </div>
            </div>

            <div className="mt-6 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <KeeponLogo className="h-4 w-auto" />
                Powered by Keepon
              </div>
            </div>
          </aside>

          <div className="flex min-h-screen flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur lg:px-6">
              <div className="flex items-center gap-3">
                <Sheet>
                  <SheetTrigger
                    className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'lg:hidden')}
                    aria-label="Open menu"
                  >
                    <Menu className="size-5" aria-hidden />
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 gap-6 bg-background px-5 py-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {serviceProvider.logoUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={serviceProvider.logoUrl}
                            alt={serviceProvider.name}
                            className="h-10 w-10 rounded-full object-contain"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <KeeponLogo className="h-6 w-6" />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-foreground">{serviceProvider.name}</p>
                          <p className="text-xs text-muted-foreground">Client dashboard</p>
                        </div>
                      </div>
                      <SheetClose
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
                        aria-label="Close menu"
                      >
                        <X className="size-4" aria-hidden />
                      </SheetClose>
                    </div>
                    <div className="space-y-6">
                      <NavLinks />
                      <div className="border-t border-border/60 pt-4">
                        <HelpLinks />
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground">{serviceProvider.name}</span>
                  <span className="text-xs text-muted-foreground">Client dashboard</span>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}>
                  <span className="max-w-[160px] truncate">{clientEmail}</span>
                  <span className={cn('text-xs text-muted-foreground', isPending && 'opacity-60')}>Account</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={handleLogout} className="text-sm">
                    <LogOut className="size-4" aria-hidden />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>

            <main className="flex-1 px-4 py-8 lg:px-8">{children}</main>
          </div>
        </div>
      </Elements>
    </div>
  )
}
