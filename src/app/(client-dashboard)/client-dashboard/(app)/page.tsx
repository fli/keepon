import type { Route } from 'next'
import BigNumber from 'bignumber.js'
import { format, isAfter } from 'date-fns'
import { ChevronRight, CreditCard, RefreshCw, Receipt } from 'lucide-react'
import Link from 'next/link'

import { CardDetails } from '@/components/client-dashboard/CardDetails'
import { EmptyState } from '@/components/client-dashboard/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, capitalize, toneClassName, toneForStatus } from '@/lib/client-dashboard/format'
import { getNextSubscriptionPaymentDate } from '@/lib/client-dashboard/getNextSubscriptionPaymentDate'
import {
  getClientProfile,
  getServiceProvider,
  listPaymentPlanPayments,
  listPaymentPlans,
  listSalePayments,
  listSaleProductsForClient,
  listSales,
} from '@/server/client-dashboard/queries'

const PAGE_SIZE = 5
const CLIENT_DASHBOARD_ROUTE = '/client-dashboard' as const

type SearchParams = Record<string, string | string[] | undefined>

function buildSearchParams({ planTab, historyPage }: { planTab?: string; historyPage?: number }) {
  const params = new URLSearchParams()
  if (planTab) {
    params.set('planTab', planTab)
  }
  if (historyPage && historyPage > 0) {
    params.set('historyPage', historyPage.toString())
  }
  const query = params.toString()
  return (query ? `${CLIENT_DASHBOARD_ROUTE}?${query}` : CLIENT_DASHBOARD_ROUTE) as Route
}

export default async function ClientDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const selectedTab = typeof params.planTab === 'string' ? params.planTab : 'activeOverdue'
  const historyPageRaw = typeof params.historyPage === 'string' ? params.historyPage : '0'
  const historyPage = Number.parseInt(historyPageRaw, 10)
  const safeHistoryPage = Number.isFinite(historyPage) && historyPage > 0 ? historyPage : 0

  const [clientProfile, serviceProvider, paymentPlans, paymentPlanPayments, sales, saleProducts, salePayments] =
    await Promise.all([
      getClientProfile(),
      getServiceProvider(),
      listPaymentPlans(),
      listPaymentPlanPayments(),
      listSales(),
      listSaleProductsForClient(),
      listSalePayments(),
    ])

  const serviceProviderName =
    serviceProvider.businessName?.trim() ||
    `${serviceProvider.firstName.trim()}${serviceProvider.lastName ? ` ${serviceProvider.lastName.trim()}` : ''}`.trim()

  const saleProductIndex = new Map(saleProducts.map((product) => [product.saleId, product]))

  const paymentRequests = sales
    .filter((sale) => sale.paymentRequested)
    .map((sale) => {
      const total = new BigNumber(sale.total)
      const paid = new BigNumber(sale.amountPaid)
      return {
        sale,
        outstanding: total.minus(paid),
      }
    })
    .filter((entry) => entry.outstanding.gt(0))
    .filter((entry) => saleProductIndex.has(entry.sale.id))

  const overduePlanPayments = new Map<string, typeof paymentPlanPayments>()
  paymentPlanPayments
    .filter((payment) => payment.status === 'rejected' || payment.status === 'pending')
    .forEach((payment) => {
      const existing = overduePlanPayments.get(payment.paymentPlanId) ?? []
      existing.push(payment)
      overduePlanPayments.set(payment.paymentPlanId, existing)
    })

  const now = new Date()
  const normalizedPlans = paymentPlans.map((plan) => {
    let status = plan.status
    if (status === 'pending' && isAfter(now, plan.requestedEndAt)) {
      status = 'ended'
    }
    if (status !== 'cancelled' && plan.endAt && isAfter(now, plan.endAt)) {
      status = 'ended'
    }

    const overduePayments = overduePlanPayments.get(plan.id) ?? []

    const nextDebitDate =
      status === 'active'
        ? getNextSubscriptionPaymentDate({
            start: plan.startAt,
            daysBetweenPayments: plan.weeklyRecurrenceInterval * 7,
          })
        : null

    return {
      ...plan,
      status,
      overduePayments,
      nextDebitDate,
    }
  })

  const planGroups = {
    activeOverdue: normalizedPlans.filter(
      (plan) => plan.status === 'active' || plan.status === 'pending' || plan.overduePayments.length > 0
    ),
    paused: normalizedPlans.filter((plan) => plan.status === 'paused'),
    ended: normalizedPlans.filter((plan) => plan.status === 'ended' || plan.status === 'cancelled'),
  }

  const selectedPlans =
    selectedTab === 'paused' ? planGroups.paused : selectedTab === 'ended' ? planGroups.ended : planGroups.activeOverdue

  const historyItems = [
    ...salePayments.map((payment) => {
      const product = saleProductIndex.get(payment.saleId)
      const amountRefunded = new BigNumber(payment.amountRefunded)
      const amount = new BigNumber(payment.amount)
      const status = amountRefunded.gt(0) && amountRefunded.eq(amount) ? 'refunded' : 'paid'
      return {
        id: payment.id,
        type: 'sale' as const,
        name: product ? `Payment for ${product.name}` : 'Payment',
        amount: formatCurrency(payment.amount, payment.currency),
        status,
        date: new Date(payment.transactedAt),
        href: `/client-dashboard/sales/${payment.saleId}` as Route,
        icon: <Receipt className="size-4" aria-hidden />,
      }
    }),
    ...paymentPlanPayments.map((payment) => {
      const plan = paymentPlans.find((plan) => plan.id === payment.paymentPlanId)
      return {
        id: payment.id,
        type: 'plan' as const,
        name: plan ? `Plan payment for ${plan.name}` : 'Plan payment',
        amount: formatCurrency(payment.amount, payment.currency),
        status: payment.status,
        date: new Date(payment.dueAt),
        href: `/client-dashboard/payment-plans/${payment.paymentPlanId}` as Route,
        icon: <RefreshCw className="size-4" aria-hidden />,
      }
    }),
  ]
    .filter((item) => !Number.isNaN(item.date.getTime()))
    .toSorted((a, b) => b.date.getTime() - a.date.getTime())

  const historyPageItems = historyItems.slice(safeHistoryPage * PAGE_SIZE, (safeHistoryPage + 1) * PAGE_SIZE)

  const historyTotalPages = Math.max(1, Math.ceil(historyItems.length / PAGE_SIZE))
  const canPrevHistory = safeHistoryPage > 0
  const canNextHistory = safeHistoryPage + 1 < historyTotalPages

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Client Dashboard</p>
        <h1 className="text-3xl font-semibold text-foreground">{serviceProviderName}</h1>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Payment Method</h2>
            <p className="text-sm text-muted-foreground">Manage the card used for subscriptions and payments.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/client-dashboard/payment-method" />}
          >
            Update card
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <CardDetails card={clientProfile.card} />
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/client-dashboard/payment-method" />}
            >
              Edit
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Payment Requests</h2>
          <p className="text-sm text-muted-foreground">Outstanding invoices waiting for your payment.</p>
        </div>
        {paymentRequests.length === 0 ? (
          <Card>
            <EmptyState icon={<CreditCard className="size-6" aria-hidden />} title="You have no payment requests" />
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/70 p-0">
              {paymentRequests.map(({ sale, outstanding }) => {
                const product = saleProductIndex.get(sale.id)
                const dueAt = new Date(sale.dueAt)
                const overdue = !Number.isNaN(dueAt.getTime()) && isAfter(now, dueAt)
                return (
                  <Link
                    key={sale.id}
                    href={`/client-dashboard/sales/${sale.id}` as Route}
                    className="flex flex-col gap-3 px-6 py-4 transition hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{product?.name ?? 'Payment request'}</p>
                        {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(product?.price ?? sale.total, sale.currency)} · Due{' '}
                        {Number.isNaN(dueAt.getTime()) ? 'soon' : format(dueAt, 'PP')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{formatCurrency(outstanding, sale.currency)} outstanding</span>
                      <ChevronRight className="size-4" aria-hidden />
                    </div>
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Subscriptions</h2>
          <p className="text-sm text-muted-foreground">Active, overdue, and past subscriptions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['activeOverdue', 'paused', 'ended'] as const).map((tab) => {
            const label =
              tab === 'activeOverdue'
                ? `Active/Overdue (${planGroups.activeOverdue.length})`
                : tab === 'paused'
                  ? `Paused (${planGroups.paused.length})`
                  : `Ended (${planGroups.ended.length})`
            return (
              <Button
                key={tab}
                variant={selectedTab === tab ? 'default' : 'outline'}
                size="sm"
                nativeButton={false}
                render={<Link href={buildSearchParams({ planTab: tab, historyPage: safeHistoryPage })} />}
              >
                {label}
              </Button>
            )
          })}
        </div>
        {selectedPlans.length === 0 ? (
          <Card>
            <EmptyState title="No subscriptions to show" description="You'll see active or past subscriptions here." />
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/70 p-0">
              {selectedPlans.map((plan) => {
                const amount = plan.amount ?? plan.requestedAmount
                const amountLabel = formatCurrency(amount, plan.currency)
                const intervalLabel =
                  plan.weeklyRecurrenceInterval === 1 ? 'week' : `${plan.weeklyRecurrenceInterval} weeks`
                const overdueCount = plan.overduePayments.length
                const statusTone = toneForStatus(plan.status)
                const statusClass = toneClassName(statusTone)
                const nextCharge = plan.nextDebitDate ? format(plan.nextDebitDate, 'PPPP') : null
                return (
                  <Link
                    key={plan.id}
                    href={`/client-dashboard/payment-plans/${plan.id}` as Route}
                    className="flex flex-col gap-3 px-6 py-4 transition hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {amountLabel} every {intervalLabel}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {overdueCount > 0 ? (
                          <Badge className="border border-rose-200 bg-rose-100 text-rose-800">
                            {overdueCount} overdue
                          </Badge>
                        ) : null}
                        {plan.status === 'pending' ? (
                          <Badge className="border border-amber-200 bg-amber-100 text-amber-800">
                            Needs acceptance
                          </Badge>
                        ) : null}
                        <Badge className={statusClass}>{capitalize(plan.status)}</Badge>
                      </div>
                    </div>
                    {nextCharge ? <p className="text-xs text-muted-foreground">Next debit date: {nextCharge}</p> : null}
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Billing History</h2>
          <p className="text-sm text-muted-foreground">Recent payments across invoices and subscriptions.</p>
        </div>
        {historyItems.length === 0 ? (
          <Card>
            <EmptyState title="No billing history yet" description="Payments will appear here once processed." />
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/70 p-0">
              {historyPageItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex flex-col gap-2 px-6 py-4 transition hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {item.icon}
                    {item.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge className={toneClassName(toneForStatus(item.status))}>{capitalize(item.status)}</Badge>
                    <span className="text-foreground">{item.amount}</span>
                    <span>{format(item.date, 'PP')}</span>
                  </div>
                </Link>
              ))}
              <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canPrevHistory}
                  nativeButton={false}
                  render={<Link href={buildSearchParams({ planTab: selectedTab, historyPage: safeHistoryPage - 1 })} />}
                >
                  Previous
                </Button>
                <span>
                  Page {safeHistoryPage + 1} of {historyTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canNextHistory}
                  nativeButton={false}
                  render={<Link href={buildSearchParams({ planTab: selectedTab, historyPage: safeHistoryPage + 1 })} />}
                >
                  Next
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
