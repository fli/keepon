import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CalendarClock, ShieldCheck, Sparkles, Zap } from 'lucide-react'

import { PageContainer } from '@/components/page-container'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { readSessionFromCookies } from '../../../session.server'
import { getDashboardSummary } from '@/server/dashboard'
import { SubscriptionPaywall } from './paywall-client'

type SubscriptionPlan = {
  monthlyPrice: string
  yearlyPrice: string
  currency: string
}

const FALLBACK_ORIGIN = process.env.NEXT_PUBLIC_ORPC_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:3000'

const buildInternalUrl = (path: string, origin: string) => new URL(path, origin).toString()

const loadPlan = async (token: string, origin: string): Promise<SubscriptionPlan | null> => {
  try {
    const res = await fetch(buildInternalUrl('/api/accountSubscriptionPlan', origin), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })

    if (!res.ok) return null

    const json = (await res.json()) as unknown

    if (
      json &&
      typeof json === 'object' &&
      typeof (json as { monthlyPrice?: unknown }).monthlyPrice === 'string' &&
      typeof (json as { yearlyPrice?: unknown }).yearlyPrice === 'string' &&
      typeof (json as { currency?: unknown }).currency === 'string'
    ) {
      return {
        monthlyPrice: (json as { monthlyPrice: string }).monthlyPrice,
        yearlyPrice: (json as { yearlyPrice: string }).yearlyPrice,
        currency: (json as { currency: string }).currency,
      }
    }
  } catch (error) {
    console.error('subscription/paywall: failed to load plan', error)
  }

  return null
}

const getPublishableKey = (): string | null => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim()
  if (!key || key.length === 0) {
    console.error('subscription/paywall: STRIPE_PUBLISHABLE_KEY is missing or empty')
    return null
  }
  return key
}

const formatCurrency = (amount: string | number, currency: string) => {
  const numeric = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  if (!Number.isFinite(numeric)) return amount.toString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(numeric)
  } catch {
    return `${numeric.toFixed(2)} ${currency}`
  }
}

export default async function SubscriptionPaywallPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const headerList = await headers()
  const proto = headerList.get('x-forwarded-proto') ?? 'https'
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  const origin = host ? `${proto}://${host}` : FALLBACK_ORIGIN

  const [dashboard, plan] = await Promise.all([
    getDashboardSummary(session.trainerId, session.userId),
    loadPlan(session.token, origin),
  ])
  const publishableKey = getPublishableKey()

  const trialDaysRemaining = dashboard.trainer.trialDaysRemaining
  const trialEndsAt = dashboard.trainer.trialEndsAt
  const trainer = dashboard.trainer

  const headlinePrice = plan ? formatCurrency(plan.monthlyPrice, plan.currency) : null
  const annualPrice = plan ? formatCurrency(plan.yearlyPrice, plan.currency) : null
  const trialLabel = trialDaysRemaining && trialDaysRemaining > 0 ? `${trialDaysRemaining} days left on trial` : 'Trial ending soon'

  return (
    <PageContainer className="py-10">
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-[1.2fr,0.8fr]">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600 text-white shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.2),transparent_30%),radial-gradient(circle_at_40%_60%,rgba(255,255,255,0.14),transparent_26%)]" aria-hidden />
          <CardHeader className="relative space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white/80">
              <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
                {trialLabel}
              </Badge>
              <span className="flex items-center gap-1 text-white/80">
                <CalendarClock className="size-4" aria-hidden />
                Keep access after your trial
              </span>
            </div>
            <div className="space-y-2">
              <p className="text-sm tracking-[0.2em] text-white/70 uppercase">Subscription</p>
              <CardTitle className="text-4xl leading-tight font-semibold drop-shadow-sm">
                Unlock the full Keepon toolkit
              </CardTitle>
              <p className="max-w-2xl text-base text-white/85">
                Keep clients booked, paid, and engaged with automated payments, online bookings, missions, and reminders. Stay on once your trial ends.
              </p>
            </div>
          </CardHeader>
          <CardContent className="relative grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <FeatureRow icon={<ShieldCheck className="size-5" aria-hidden />} title="Reliable cashflow">
                Auto-bill subscriptions and keep overdue payments in view.
              </FeatureRow>
              <FeatureRow icon={<Sparkles className="size-5" aria-hidden />} title="Client self-serve">
                Online bookings, packs, and missions without extra add-ons.
              </FeatureRow>
              <FeatureRow icon={<Zap className="size-5" aria-hidden />} title="Works with your day">
                SMS credits, reminders, and dashboards tuned for trainers.
              </FeatureRow>
            </div>
            <div className="flex flex-col justify-between gap-4 rounded-2xl bg-white/10 p-6 shadow-lg backdrop-blur">
              <div className="space-y-2">
                <p className="text-sm font-medium text-white/80">Keepon Essentials</p>
                <div className="flex items-baseline gap-2 text-4xl font-semibold">
                  <span>{headlinePrice ?? '—'}</span>
                  <span className="text-lg font-normal text-white/80">per month</span>
                </div>
                <p className="text-sm text-white/80">{annualPrice ? `${annualPrice} billed yearly option available` : 'Annual billing available.'}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-white/85">
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
                  Trial remains: {trialDaysRemaining ?? 0} days
                </Badge>
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
                  Secure Stripe checkout
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <SubscriptionPaywall
          plan={plan}
          publishableKey={publishableKey}
          trainerName={trainer.firstName}
          trialDaysRemaining={trialDaysRemaining}
          trialEndsAt={trialEndsAt}
        />
      </div>
    </PageContainer>
  )
}

function FeatureRow({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="mt-0.5 rounded-full bg-white/15 p-2 text-white">{icon}</div>
      <div className="space-y-1 text-white">
        <p className="text-base leading-tight font-semibold">{title}</p>
        <p className="text-sm text-white/80">{children}</p>
      </div>
    </div>
  )
}
