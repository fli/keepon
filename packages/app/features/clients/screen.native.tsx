"use client"

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from 'app/provider/auth'
import { fetchClients, type Client, type CreateClientPayload } from 'app/services/api'
import { ClientsContent } from './content'

type Props = {
  initialClients?: Client[] | null
  createClientAction?: (payload: CreateClientPayload) => Promise<Client>
}

export function ClientsScreen(_props: Props) {
  const auth = useAuth()

  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery<Client[], Error>({
    queryKey: ['clients', auth.session?.trainerId],
    enabled: auth.ready && Boolean(auth.session),
    queryFn: () => (auth.session ? fetchClients(auth.session) : Promise.resolve([])),
    staleTime: 30_000,
  })

  const clients = useMemo(() => data ?? [], [data])

  return (
    <ClientsContent
      clients={clients}
      isPending={isPending && clients.length === 0}
      isFetching={isFetching}
      error={error ?? null}
      onRetry={() => void refetch()}
      onRefresh={() => void refetch()}
    />
  )
}

export { ClientDetailCard } from './client-detail-card'
