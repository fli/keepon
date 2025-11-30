import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
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

  const [clients, creditPacks] = await Promise.all([loadClients(), loadCreditPacks()])
  const client = clients.find((item) => item.id === clientId)
  if (!client) {
    redirect('/dashboard/sell/credit-pack')
  }

  const queryString = new URLSearchParams(
    Object.entries(qs).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value
      return acc
    }, {})
  ).toString()

  const currentHref = queryString
    ? `/dashboard/sell/credit-pack/${clientId}?${queryString}`
    : `/dashboard/sell/credit-pack/${clientId}`
  const backHref = queryString
    ? `/dashboard/sell/credit-pack?${queryString}`
    : '/dashboard/sell/credit-pack'
  const redirectParam = encodeURIComponent(currentHref)

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Dashboard</p>
          <h1 className="text-3xl font-semibold leading-tight">
            Choose a credit pack for {client.firstName || 'this client'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your selection is stored in the URL so you can refresh or share safely.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" render={<Link href={backHref} />}>
            Change client
          </Button>
          <Button
            size="sm"
            render={<Link href={`/settings/credit-packs/add?redirect=${redirectParam}`} />}
          >
            New credit pack
          </Button>
        </div>
      </div>

      <CreditPackSelector clientId={clientId} creditPacks={creditPacks} backQuery={queryString} />
    </PageContainer>
  )
}
