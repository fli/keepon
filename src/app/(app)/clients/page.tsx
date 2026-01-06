import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/page-container'
import { loadClientsServer, readSessionFromCookies } from './actions'
import { ClientsGrid } from './clients-grid'
import { ImportClientsButton } from './import-button'

export default async function ClientsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const clients = (await loadClientsServer()) ?? []

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl leading-tight font-semibold">Clients</h1>
          <div className="flex items-center gap-2">
            <ImportClientsButton />
            <Button size="sm" nativeButton={false} render={<Link href="/clients/add" />}>
              Add client
            </Button>
          </div>
        </div>
      </div>

      <Suspense fallback={<ClientsGridSkeleton />}>
        <ClientsGrid clients={clients} />
      </Suspense>
    </PageContainer>
  )
}

function ClientsGridSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-16" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
        <div className="grid grid-cols-5 gap-3 bg-muted/50 px-4 py-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`header-${index}`} className="h-4 w-20" />
          ))}
        </div>
        <div className="divide-y divide-border bg-background">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`row-${index}`} className="grid grid-cols-5 items-center gap-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
