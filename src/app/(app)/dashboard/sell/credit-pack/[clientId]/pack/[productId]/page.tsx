import Link from 'next/link'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
import { PaymentForm } from '../../../payment-form'
import { loadClients, loadCreditPacks } from '../../../actions'
import { readSessionFromCookies } from '../../../../../../../session.server'

export default async function SellPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; productId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { clientId, productId } = await params
  const qs = (await searchParams) ?? {}

  const session = await readSessionFromCookies()
  if (!session) redirect('/auth')

  const [clients, creditPacks] = await Promise.all([loadClients(), loadCreditPacks()])

  const client = clients.find((item) => item.id === clientId)
  const pack = creditPacks.find((item) => item.id === productId)

  const queryString = new URLSearchParams(
    Object.entries(qs).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value
      return acc
    }, {})
  ).toString()

  if (!client) redirect('/dashboard/sell/credit-pack')
  if (!pack)
    redirect(
      (queryString
        ? `/dashboard/sell/credit-pack/${clientId}?${queryString}`
        : `/dashboard/sell/credit-pack/${clientId}`) as Route
    )

  const changePackHref = (queryString
    ? `/dashboard/sell/credit-pack/${clientId}?${queryString}`
    : `/dashboard/sell/credit-pack/${clientId}`) as Route

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Dashboard</p>
          <h1 className="text-3xl font-semibold leading-tight">Payment</h1>
          <p className="text-sm text-muted-foreground">
            Payment type, notes, fees, and due dates are kept in the URL while you work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" render={<Link href={changePackHref} />}>
            Change pack
          </Button>
          <Button size="sm" variant="outline" render={<Link href="/dashboard/sell/credit-pack" />}>
            Start over
          </Button>
        </div>
      </div>

      <PaymentForm client={client} pack={pack} />
    </PageContainer>
  )
}
