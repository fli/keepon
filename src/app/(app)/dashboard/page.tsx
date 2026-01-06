import Link from 'next/link'
import { Suspense, use } from 'react'
import { redirect } from 'next/navigation'

import { AlertCircle, Bell, Calendar, ChevronRight, Clock, PenSquare } from 'lucide-react'

import { PageContainer } from '@/components/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDashboardSummary, type DashboardSummary } from '@/server/dashboard'
import { readSessionFromCookies } from '../../session.server'
import { DashboardActions } from './dashboard-actions'
import { ProjectedPaidCard } from './projected-paid-card'
import {
  DashboardHeaderSkeleton,
  NextAppointmentSkeleton,
  OnlineBookingsSkeleton,
  PaymentsSkeleton,
  SubscriptionsSkeleton,
} from './dashboard-skeletons'

type DashboardResult = {
  data: DashboardSummary | null
  error: string | null
}

async function createDashboardPromise(): Promise<DashboardResult> {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  try {
    const data = await getDashboardSummary(session.trainerId, session.userId)
    return { data, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load dashboard'
    return { data: null, error: message }
  }
}

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export default function DashboardPage() {
  const dashboardPromise = createDashboardPromise()

  return (
    <PageContainer className="flex flex-col gap-8 py-8">
      <Suspense fallback={<DashboardHeaderSkeleton />}>
        <DashboardHeader dashboardPromise={dashboardPromise} />
      </Suspense>

      <Suspense fallback={<PaymentsSkeleton />}>
        <PaymentsSection dashboardPromise={dashboardPromise} />
      </Suspense>

      <Suspense fallback={<SubscriptionsSkeleton />}>
        <SubscriptionsSection dashboardPromise={dashboardPromise} />
      </Suspense>

      <Suspense fallback={<NextAppointmentSkeleton />}>
        <NextAppointmentSection dashboardPromise={dashboardPromise} />
      </Suspense>

      <Suspense fallback={<OnlineBookingsSkeleton />}>
        <OnlineBookingsSection dashboardPromise={dashboardPromise} />
      </Suspense>
    </PageContainer>
  )
}

function DashboardHeader({ dashboardPromise }: { dashboardPromise: Promise<DashboardResult> }) {
  const { data, error } = use(dashboardPromise)

  const greeting = (() => {
    const hour = new Date().getHours()
    const name = data?.trainer.firstName?.trim() || 'trainer'
    if (hour < 12) return `Good morning, ${name}`
    if (hour < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  })()

  const trialDaysRemaining = data?.trainer.trialDaysRemaining ?? 0
  const showTrial = trialDaysRemaining > 0
  const trialText = showTrial ? `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left on trial` : null

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-semibold">{greeting}</h1>
        <div className="flex flex-wrap gap-2">
          {showTrial && trialText ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 pr-2"
              nativeButton={false}
              render={<Link href="/dashboard/subscription" />}
            >
              <span>{trialText}</span>
              <ChevronRight className="size-4" aria-hidden />
              <span className="sr-only">View subscription options</span>
            </Button>
          ) : null}
          {typeof data?.trainer.smsCredits === 'number' ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 pr-2"
              nativeButton={false}
              render={<Link href="/settings/credit-packs" />}
            >
              <span>{data.trainer.smsCredits.toLocaleString()} text credits</span>
              <ChevronRight className="size-4" aria-hidden />
              <span className="sr-only">Manage credits</span>
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DashboardActions />
      </div>

      <div className="relative">
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Notifications"
          nativeButton={false}
          render={<Link href="/dashboard/notifications" />}
        >
          <Bell className="size-5" aria-hidden />
        </Button>
        {data?.notifications.hasUnread ? (
          <>
            <span className="absolute top-2 right-2 inline-block h-2 w-2 rounded-full bg-destructive" aria-hidden />
            <span className="sr-only">You have unread notifications</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function PaymentsSection({ dashboardPromise }: { dashboardPromise: Promise<DashboardResult> }) {
  const { data } = use(dashboardPromise)

  const showSetupPayments = Boolean(data?.trainer.paymentsSetupRequired)

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Payments</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ProjectedPaidCard payments={data?.payments ?? null} />

        <Card className="flex flex-col gap-3">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="rounded-full p-2">
                  <AlertCircle className="size-4" aria-hidden />
                </Badge>
                <CardDescription className="text-sm font-semibold text-foreground">
                  {data?.payments.overdue.count ?? 0} overdue payments
                </CardDescription>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </div>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            <CardTitle className="text-3xl text-foreground">
              {data ? formatCurrency(data.payments.overdue.total, data.payments.currency) : '—'}
            </CardTitle>
          </CardContent>
        </Card>

        <Card className="flex flex-col gap-3">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">
              Funds to transfer to your account
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto pt-0 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Pending</p>
                <p className="text-2xl font-semibold text-foreground">
                  {data ? formatCurrency(data.funds.pending, data.funds.currency) : '—'}
                </p>
              </div>
              <div className="mx-3 h-10 w-px bg-border" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Available</p>
                <p className="text-2xl font-semibold text-foreground">
                  {data ? formatCurrency(data.funds.available, data.funds.currency) : '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`flex flex-col gap-3 ${showSetupPayments ? 'border-dashed' : ''}`}>
          <CardHeader className="space-y-2 pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">
              {showSetupPayments ? 'Setup payments' : 'Payments ready'}
            </CardDescription>
            <p className="text-sm text-muted-foreground">
              {showSetupPayments
                ? 'Get verified to accept card payments and enable payouts.'
                : 'Your payouts and deposits are configured.'}
            </p>
          </CardHeader>
          <CardContent className="mt-auto pt-0">
            {showSetupPayments ? (
              <Button className="w-fit" variant="default">
                Get paid
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">All set—no action needed.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function SubscriptionsSection({ dashboardPromise }: { dashboardPromise: Promise<DashboardResult> }) {
  const { data } = use(dashboardPromise)

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Subscriptions & Packs</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between pb-1">
            <div>
              <CardDescription className="text-sm font-semibold text-foreground">Active subscriptions</CardDescription>
              <CardTitle className="text-3xl text-foreground">{data?.subscriptions.activePlans ?? 0}</CardTitle>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex items-center justify-between pb-1">
            <div>
              <CardDescription className="text-sm font-semibold text-foreground">Active packs</CardDescription>
              <CardTitle className="text-3xl text-foreground">{data?.subscriptions.activePacks ?? 0}</CardTitle>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </div>
    </section>
  )
}

function NextAppointmentSection({ dashboardPromise }: { dashboardPromise: Promise<DashboardResult> }) {
  const { data } = use(dashboardPromise)

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Next Appointment</h2>
      <div className="grid">
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-semibold text-foreground">Next appointment</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-3">
            {data?.nextAppointment ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="size-4" aria-hidden />
                  <span>
                    {new Date(data.nextAppointment.startTime).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-lg leading-tight font-semibold">{data.nextAppointment.title}</p>
                {data.nextAppointment.location ? (
                  <p className="text-sm text-muted-foreground">{data.nextAppointment.location}</p>
                ) : null}
                <Button size="sm" variant="secondary" className="mt-1 w-fit">
                  View appointment
                </Button>
              </>
            ) : (
              <>
                <p className="text-lg leading-tight font-semibold">Your day&apos;s completely free</p>
                <p className="text-sm text-muted-foreground">
                  Book some appointments or take some time to yourself, whatever it is make sure you enjoy it.
                </p>
                <Button size="sm" className="w-fit">
                  Add an appointment or event
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function OnlineBookingsSection({ dashboardPromise }: { dashboardPromise: Promise<DashboardResult> }) {
  const { data } = use(dashboardPromise)

  const showOnlineBookingsOnboarding =
    typeof data?.onlineBookings.serviceCount === 'number' ? data.onlineBookings.serviceCount <= 2 : false

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Online Bookings</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {showOnlineBookingsOnboarding ? (
          <Card className="flex flex-col border-dashed">
            <CardHeader className="space-y-2 pb-2">
              <CardDescription className="text-sm font-semibold text-foreground">Setup online bookings</CardDescription>
              <p className="text-sm text-muted-foreground">Share your services and start taking bookings in minutes.</p>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button className="w-fit">Setup your booking page</Button>
            </CardContent>
          </Card>
        ) : null}

        {showOnlineBookingsOnboarding ? (
          <Card className="flex flex-col">
            <CardHeader className="space-y-1 pb-2">
              <CardDescription className="text-sm font-semibold text-foreground">Example booking page</CardDescription>
              <p className="text-sm text-muted-foreground">Preview what your clients will see when they book.</p>
            </CardHeader>
            <CardContent className="mt-auto pt-0">
              <Button variant="secondary" className="w-fit">
                View example
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="flex flex-col">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div>
                <CardDescription className="text-sm font-semibold text-foreground">
                  Today&apos;s online booking availability
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit online booking availability">
                <PenSquare className="size-4" aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="mt-auto space-y-2 pt-3">
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">
              <Clock className="size-4" aria-hidden />
              <span>{data?.onlineBookings.bookableCount ? '9:00 am - 9:00 pm' : 'Set availability'}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {data?.onlineBookings.bookableCount
                ? `${data.onlineBookings.bookableCount.toLocaleString()} services available for online booking today.`
                : 'Publish bookable sessions and share your link with clients.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
