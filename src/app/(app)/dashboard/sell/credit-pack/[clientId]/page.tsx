import Link from 'next/link'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CreditPackSelector } from '../credit-pack-selector'
import { loadClients, loadCreditPacks } from '../actions'
import { readSessionFromCookies } from '../../../../../session.server'

export default async function SelectCreditPackPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { clientId } = await params
  const qs = (await searchParams) ?? {}

  const session = await readSessionFromCookies()
  if (!session) redirect('/auth')

  // Single fetch fan-out reused in nested Suspense boundaries.
  const clientsPromise = loadClients()
  const creditPacksPromise = loadCreditPacks()

  const queryString = new URLSearchParams(
    Object.entries(qs).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value
      return acc
    }, {})
  ).toString()

  const currentHref = (queryString
    ? `/dashboard/sell/credit-pack/${clientId}?${queryString}`
    : `/dashboard/sell/credit-pack/${clientId}`) as Route
  const backHref = (queryString
    ? `/dashboard/sell/credit-pack?${queryString}`
    : '/dashboard/sell/credit-pack') as Route
  const redirectParam = encodeURIComponent(currentHref)
  const addCreditPackHref = `/settings/credit-packs/add?redirect=${redirectParam}` as Route

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Dashboard</p>
          <Suspense
            fallback={
              <div className="space-y-2">
                <Skeleton className="h-8 w-80" />
                <Skeleton className="h-4 w-96" />
              </div>
            }
          >
            <Heading clientId={clientId} clientsPromise={clientsPromise} />
          </Suspense>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" render={<Link href={backHref} />}>
            Change client
          </Button>
          <Button
            size="sm"
            render={<Link href={addCreditPackHref} />}
          >
            New credit pack
          </Button>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={idx} className="h-32" />
            ))}
          </div>
        }
      >
        <CreditPackSelectorLoader
          clientId={clientId}
          backQuery={queryString}
          creditPacksPromise={creditPacksPromise}
        />
      </Suspense>
    </PageContainer>
  )
}

async function Heading({
  clientId,
  clientsPromise,
}: {
  clientId: string
  clientsPromise: ReturnType<typeof loadClients>
}) {
  const clients = await clientsPromise
  const client = clients.find((item) => item.id === clientId)
  if (!client) {
    redirect('/dashboard/sell/credit-pack')
  }

  return (
    <>
      <h1 className="text-3xl font-semibold leading-tight">
        Choose a credit pack for {client.firstName || 'this client'}
      </h1>
      <p className="text-sm text-muted-foreground">
        Your selection is stored in the URL so you can refresh or share safely.
      </p>
    </>
  )
}

async function CreditPackSelectorLoader({
  clientId,
  backQuery,
  creditPacksPromise,
}: {
  clientId: string
  backQuery: string
  creditPacksPromise: ReturnType<typeof loadCreditPacks>
}) {
  const creditPacks = await creditPacksPromise
  return <CreditPackSelector clientId={clientId} creditPacks={creditPacks} backQuery={backQuery} />
}
