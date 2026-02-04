import type { Route } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { readSessionFromCookies } from '../../../../../../../session.server'
import { loadClients, loadCreditPacks } from '../../../actions'
import { PaymentForm } from '../../../payment-form'

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
  if (!session) {
    redirect('/auth')
  }

  const clientsPromise = loadClients()
  const creditPacksPromise = loadCreditPacks()

  const queryString = new URLSearchParams(
    Object.entries(qs).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') {
        acc[key] = value
      }
      return acc
    }, {})
  ).toString()

  const changePackHref = (
    queryString ? `/dashboard/sell/credit-pack/${clientId}?${queryString}` : `/dashboard/sell/credit-pack/${clientId}`
  ) as Route

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl leading-tight font-semibold">Payment</h1>
          <p className="text-sm text-muted-foreground">
            Payment type, notes, fees, and due dates are kept in the URL while you work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={changePackHref} />}>
            Change pack
          </Button>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/dashboard/sell/credit-pack" />}>
            Start over
          </Button>
        </div>
      </div>

      <Suspense fallback={<PaymentSkeleton />}>
        <PaymentFormLoader
          clientId={clientId}
          productId={productId}
          clientsPromise={clientsPromise}
          creditPacksPromise={creditPacksPromise}
          backQuery={queryString}
        />
      </Suspense>
    </PageContainer>
  )
}

async function PaymentFormLoader({
  clientId,
  productId,
  clientsPromise,
  creditPacksPromise,
  backQuery,
}: {
  clientId: string
  productId: string
  clientsPromise: ReturnType<typeof loadClients>
  creditPacksPromise: ReturnType<typeof loadCreditPacks>
  backQuery: string
}) {
  const [clients, creditPacks] = await Promise.all([clientsPromise, creditPacksPromise])
  const client = clients.find((item) => item.id === clientId)
  const pack = creditPacks.find((item) => item.id === productId)

  if (!client) {
    redirect('/dashboard/sell/credit-pack')
  }
  if (!pack) {
    redirect(
      backQuery
        ? (`/dashboard/sell/credit-pack/${clientId}?${backQuery}` as Route)
        : (`/dashboard/sell/credit-pack/${clientId}` as Route)
    )
  }

  return <PaymentForm client={client} pack={pack} />
}

function PaymentSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-32" />
      <div className="flex justify-end">
        <Skeleton className="h-9 w-36" />
      </div>
    </div>
  )
}
