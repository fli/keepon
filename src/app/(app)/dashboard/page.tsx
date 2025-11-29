import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDashboardSummary, type DashboardSummary } from '@/server/dashboard'
import { listTrainerNotifications, type NotificationList } from '@/server/notifications'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { NotificationsCard } from '@/components/notifications-card'
import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
import { readSessionFromCookies } from '../../session.server'

async function loadDashboard(trainerId: string): Promise<DashboardSummary> {
  return getDashboardSummary(trainerId)
}

const DASHBOARD_NOTIFICATION_LIMIT = 5

type Notification = NotificationList[number]

async function loadNotifications(session: { trainerId: string; userId: string }): Promise<Notification[]> {
  return listTrainerNotifications(session.trainerId, session.userId, {
    limit: DASHBOARD_NOTIFICATION_LIMIT,
  })
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

export default async function DashboardPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let data: DashboardSummary | null = null
  let dashboardError: string | null = null
  let notifications: Notification[] = []
  let notificationsError: string | null = null

  const [dashboardResult, notificationsResult] = await Promise.allSettled([
    loadDashboard(session.trainerId),
    loadNotifications(session),
  ])

  if (dashboardResult.status === 'fulfilled') {
    data = dashboardResult.value
  } else {
    dashboardError =
      dashboardResult.reason instanceof Error
        ? dashboardResult.reason.message
        : 'Unable to load dashboard'
  }

  if (notificationsResult.status === 'fulfilled') {
    notifications = notificationsResult.value
  } else {
    notificationsError =
      notificationsResult.reason instanceof Error
        ? notificationsResult.reason.message
        : 'Unable to load notifications'
  }

  const greeting = (() => {
    const hour = new Date().getHours()
    const name = data?.trainer.firstName?.trim() || 'trainer'
    if (hour < 12) return `Good morning, ${name}`
    if (hour < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  })()

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold leading-tight">{greeting}</h1>
          {dashboardError ? (
            <p className="text-sm text-destructive">{dashboardError}</p>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/80 shadow-xs h-9 px-4"
          >
            Actions
            <ChevronDown className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={12}>
            <DropdownMenuGroup>
              <DropdownMenuItem>Sell credit pack</DropdownMenuItem>
              <DropdownMenuItem>Sell service</DropdownMenuItem>
              <DropdownMenuItem>Sell item</DropdownMenuItem>
              <DropdownMenuItem>Sell subscription</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>Charge custom amount</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>Add expense</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected (7d)</CardDescription>
            <CardTitle className="text-2xl">
              {data
                ? formatCurrency(
                    data.payments.last7Days.projected,
                    data.payments.currency
                  )
                : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Paid:{' '}
            {data
              ? formatCurrency(
                  data.payments.last7Days.paid,
                  data.payments.currency
                )
              : '—'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available funds</CardDescription>
            <CardTitle className="text-2xl">
              {data
                ? formatCurrency(data.funds.available, data.funds.currency)
                : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Pending:{' '}
            {data
              ? formatCurrency(data.funds.pending, data.funds.currency)
              : '—'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Next appointment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data?.nextAppointment ? (
              <>
                <p className="text-lg font-semibold leading-tight">
                  {data.nextAppointment.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(data.nextAppointment.startTime).toLocaleString(
                    undefined,
                    {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }
                  )}
                </p>
                {data.nextAppointment.location ? (
                  <p className="text-sm text-muted-foreground">
                    {data.nextAppointment.location}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No upcoming sessions scheduled.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div>
                <CardDescription>Subscriptions</CardDescription>
                <CardTitle className="text-2xl">
                  {data?.subscriptions.activePacks ?? 0} packs
                </CardTitle>
              </div>
              <Badge variant="outline">
                {data?.subscriptions.activePlans ?? 0} plans
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-muted-foreground">
            Active subscriptions keep your cash flow predictable.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div>
                <CardDescription>Online bookings</CardDescription>
                <CardTitle className="text-2xl">
                  {data?.onlineBookings.bookableCount ?? 0} services
                </CardTitle>
              </div>
              <Badge variant="outline">Live</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-3 text-sm text-muted-foreground">
            Publish bookable sessions and share your link with clients.
          </CardContent>
        </Card>
      </div>

      <NotificationsCard
        notifications={notifications}
        error={notificationsError}
        title="Notifications"
        description={
          notifications.length
            ? 'Recent updates for your business'
            : 'Stay on top of client activity.'
        }
        headerAction={
          <Button variant="ghost" size="sm" render={<Link href="/notifications" />}>
            View all
          </Button>
        }
      />
    </PageContainer>
  )
}
