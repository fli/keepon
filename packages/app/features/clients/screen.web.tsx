"use client"

import { useMemo } from 'react'

import type { Client, CreateClientPayload } from 'app/services/api'
import { ClientsContent } from './content'

type Props = {
  initialClients?: Client[] | null
  createClientAction?: (payload: CreateClientPayload) => Promise<Client>
}

// Web version avoids AuthProvider/QueryProvider; data is provided by the server page.
export function ClientsScreen({ initialClients = [] }: Props) {
  const clients = useMemo(() => initialClients ?? [], [initialClients])

  return (
    <ClientsContent
      clients={clients}
      isPending={false}
      isFetching={false}
      error={null}
      onRetry={() => {}}
      onRefresh={() => {}}
    />
  )
}

export { ClientDetailCard } from './client-detail-card'
