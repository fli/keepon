import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { PageContainer } from '@/components/page-container'
import { Skeleton } from '@/components/ui/skeleton'
import { ClientPicker } from './client-picker'
import { loadClients } from './actions'
import { readSessionFromCookies } from '../../../../session.server'

export default async function SellCreditPackStartPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  // Fetch once at the top; Suspense below unwraps the promise.
  const clientsPromise = loadClients()

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl leading-tight font-semibold">Sell credit pack</h1>
          <p className="text-sm text-muted-foreground">Pick a client to start this sale.</p>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={idx} className="h-24" />
            ))}
          </div>
        }
      >
        <ClientPickerLoader clientsPromise={clientsPromise} />
      </Suspense>
    </PageContainer>
  )
}

async function ClientPickerLoader({ clientsPromise }: { clientsPromise: ReturnType<typeof loadClients> }) {
  const clients = await clientsPromise
  return <ClientPicker clients={clients} />
}
