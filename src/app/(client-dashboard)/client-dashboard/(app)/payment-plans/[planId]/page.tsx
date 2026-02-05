import type { Route } from 'next'
import BigNumber from 'bignumber.js'
import { format, isAfter } from 'date-fns'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EmptyState } from '@/components/client-dashboard/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { capitalize, formatCurrency, toneClassName, toneForStatus } from '@/lib/client-dashboard/format'
import { getNextSubscriptionPaymentDate } from '@/lib/client-dashboard/getNextSubscriptionPaymentDate'
import { getClientProfile, getPaymentPlan, listPaymentPlanPayments } from '@/server/client-dashboard/queries'
import { PaymentPlanActions } from './payment-plan-actions'

const PAGE_SIZE = 5

type SearchParams = Record<string, string | string[] | undefined>

const buildSearchParams = (planId: string, page: number) => {
  const params = new URLSearchParams()
  if (page > 0) {
    params.set('page', page.toString())
  }
  const query = params.toString()
  const pathname = `/client-dashboard/payment-plans/${planId}`
  return (query ? `${pathname}?${query}` : pathname) as Route
}

export default async function PaymentPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { planId } = await params
  const query = await searchParams
  const pageRaw = typeof query.page === 'string' ? query.page : '0'
  const page = Number.parseInt(pageRaw, 10)
  const safePage = Number.isFinite(page) && page >= 0 ? page : 0

  const [plan, payments, clientProfile] = await Promise.all([
    getPaymentPlan(planId),
    listPaymentPlanPayments({ paymentPlanId: planId }),
    getClientProfile(),
  ])

  if (!plan) {
    notFound()
  }

  const now = new Date()
  let status = plan.status
  if (status === 'pending' && isAfter(now, plan.requestedEndAt)) {
    status = 'ended'
  }
  if (status !== 'cancelled' && plan.endAt && isAfter(now, plan.endAt)) {
    status = 'ended'
  }

  const overduePayments = payments.filter((payment) => payment.status === 'rejected' || payment.status === 'pending')
  const amountOverdue = overduePayments.reduce(
    (total, payment) => total.plus(payment.amountOutstanding),
    new BigNumber(0)
  )
  const amountOverdueLabel = amountOverdue.gt(0) ? formatCurrency(amountOverdue, plan.currency) : null

  const nextDebitDate =
    status === 'active'
      ? getNextSubscriptionPaymentDate({
          start: plan.startAt,
          daysBetweenPayments: plan.weeklyRecurrenceInterval * 7,
        })
      : null

  const sortedPayments = payments.toSorted((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())

  const totalPages = Math.max(1, Math.ceil(sortedPayments.length / PAGE_SIZE))
  const pageItems = sortedPayments.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const amountLabel = formatCurrency(plan.amount ?? plan.requestedAmount, plan.currency)
  const intervalLabel = plan.weeklyRecurrenceInterval === 1 ? 'week' : `${plan.weeklyRecurrenceInterval} weeks`
  const statusClass = toneClassName(toneForStatus(status))

  const requiresAcceptance = status === 'pending'
  const hasOverdue = overduePayments.length > 0

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-foreground">{plan.name}</h1>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/client-dashboard" />}>
          Back to dashboard
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Subscription summary</CardTitle>
          <CardDescription>Key details for this subscription.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="text-base font-semibold text-foreground">
              {amountLabel} every {intervalLabel}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <Badge className={statusClass}>{capitalize(status)}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground">Start date</p>
            <p className="text-foreground">{format(plan.startAt, 'PP')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">End date</p>
            <p className="text-foreground">
              {plan.endAt ? format(plan.endAt, 'PP') : format(plan.requestedEndAt, 'PP')}
            </p>
          </div>
          {nextDebitDate ? (
            <div>
              <p className="text-muted-foreground">Next debit date</p>
              <p className="text-foreground">{format(nextDebitDate, 'PPPP')}</p>
            </div>
          ) : null}
          {hasOverdue ? (
            <div>
              <p className="text-muted-foreground">Overdue balance</p>
              <p className="text-foreground">{amountOverdueLabel}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {requiresAcceptance || hasOverdue ? (
        <PaymentPlanActions
          planId={plan.id}
          requiresAcceptance={requiresAcceptance}
          hasOverdue={hasOverdue}
          amountOverdueLabel={amountOverdueLabel}
          clientCard={clientProfile.card}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Payments are automated</CardTitle>
            <CardDescription>Your subscription will be charged automatically on schedule.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Past payments for this subscription.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sortedPayments.length === 0 ? (
            <EmptyState title="No payments yet" description="Payments will appear here once processed." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>Plan payment</TableCell>
                    <TableCell>
                      <Badge className={toneClassName(toneForStatus(payment.status))}>
                        {capitalize(payment.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(payment.amount, payment.currency)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(payment.dueAt), 'PP')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {sortedPayments.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 0}
                nativeButton={false}
                render={<Link href={buildSearchParams(planId, safePage - 1)} />}
              >
                Previous
              </Button>
              <span>
                Page {safePage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage + 1 >= totalPages}
                nativeButton={false}
                render={<Link href={buildSearchParams(planId, safePage + 1)} />}
              >
                Next
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
