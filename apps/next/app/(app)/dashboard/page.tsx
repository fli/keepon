import { redirect } from 'next/navigation'
import { getOrpcEndpoint } from '@keepon/orpc'

import { readSessionFromCookies } from '../../session.server'

export type DashboardSummary = {
  trainer: {
    firstName: string | null
    smsCredits: number | null
    trialDaysRemaining: number | null
    defaultCurrency: string
  }
  payments: {
    currency: string
    last7Days: { projected: number; paid: number }
    today: { projected: number; paid: number }
    overdue: { count: number; total: number }
  }
  funds: {
    currency: string
    pending: number
    available: number
  }
  nextAppointment: {
    id: string
    title: string
    startTime: string
    durationMinutes: number
    location: string | null
    address: string | null
    timezone: string | null
  } | null
  subscriptions: {
    activePlans: number
    activePacks: number
  }
  onlineBookings: {
    bookableCount: number
  }
}

async function loadDashboard(token: string): Promise<DashboardSummary> {
  const res = await fetch(getOrpcEndpoint('/api/dashboard/summary'), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `Failed to load dashboard data (${res.status})`)
  }

  return (await res.json()) as DashboardSummary
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
  let error: string | null = null
  try {
    data = await loadDashboard(session.token)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to load dashboard'
  }

  const greeting = (() => {
    const hour = new Date().getHours()
    const name = data?.trainer.firstName?.trim() || 'trainer'
    if (hour < 12) return `Good morning, ${name}`
    if (hour < 17) return `Good afternoon, ${name}`
    return `Good evening, ${name}`
  })()

  return (
    <div className="page-shell flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">
          Today
        </p>
        <h1 className="text-3xl font-semibold leading-tight">{greeting}</h1>
        <p className="text-sm text-[var(--color-secondaryText)]">
          Keep an eye on revenue, funds, and your next appointment.
        </p>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="card card-padded flex flex-col gap-2">
          <p className="text-sm text-[var(--color-secondaryText)]">
            Projected (7d)
          </p>
          <p className="text-2xl font-bold">
            {data
              ? formatCurrency(
                  data.payments.last7Days.projected,
                  data.payments.currency
                )
              : '—'}
          </p>
          <p className="text-sm text-[var(--color-secondaryText)]">
            Paid:{' '}
            {data
              ? formatCurrency(
                  data.payments.last7Days.paid,
                  data.payments.currency
                )
              : '—'}
          </p>
        </div>

        <div className="card card-padded flex flex-col gap-2">
          <p className="text-sm text-[var(--color-secondaryText)]">
            Available funds
          </p>
          <p className="text-2xl font-bold">
            {data
              ? formatCurrency(data.funds.available, data.funds.currency)
              : '—'}
          </p>
          <p className="text-sm text-[var(--color-secondaryText)]">
            Pending:{' '}
            {data
              ? formatCurrency(data.funds.pending, data.funds.currency)
              : '—'}
          </p>
        </div>

        <div className="card card-padded flex flex-col gap-2">
          <p className="text-sm text-[var(--color-secondaryText)]">
            Next appointment
          </p>
          {data?.nextAppointment ? (
            <>
              <p className="text-lg font-semibold">
                {data.nextAppointment.title}
              </p>
              <p className="text-sm text-[var(--color-secondaryText)]">
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
                <p className="text-sm text-[var(--color-secondaryText)]">
                  {data.nextAppointment.location}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[var(--color-secondaryText)]">
              No upcoming sessions scheduled.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card card-padded flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-secondaryText)]">
              Subscriptions
            </p>
            <span className="pill text-sm">
              {data?.subscriptions.activePlans ?? 0} plans
            </span>
          </div>
          <p className="text-2xl font-bold">
            {data?.subscriptions.activePacks ?? 0} packs
          </p>
          <p className="text-sm text-[var(--color-secondaryText)]">
            Active subscriptions keep your cash flow predictable.
          </p>
        </div>

        <div className="card card-padded flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-secondaryText)]">
              Online bookings
            </p>
            <span className="pill text-sm">
              {data?.onlineBookings.bookableCount ?? 0} services
            </span>
          </div>
          <p className="text-sm text-[var(--color-secondaryText)]">
            Publish bookable sessions and share your link with clients.
          </p>
        </div>
      </div>
    </div>
  )
}
