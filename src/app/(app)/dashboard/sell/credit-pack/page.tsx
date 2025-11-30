import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'
import { ClientPicker } from './client-picker'
import { loadClients } from './actions'
import { readSessionFromCookies } from '../../../../session.server'

export default async function SellCreditPackStartPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const clients = await loadClients()

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Dashboard</p>
          <h1 className="text-3xl font-semibold leading-tight">Sell credit pack</h1>
          <p className="text-sm text-muted-foreground">Pick a client to start this sale.</p>
        </div>
        <Button size="sm" variant="outline" render={<Link href="/dashboard" />}>
          Back to dashboard
        </Button>
      </div>

      <ClientPicker clients={clients} />
    </PageContainer>
  )
}
