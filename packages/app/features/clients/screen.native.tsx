'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from 'app/provider/auth'
import { fetchClients, type Client } from 'app/services/api'
// Explicitly import the iOS-only implementation to avoid accidental resolution to shared/web variants.
import { ClientsContent } from './content.ios'

export function ClientsScreen() {
  const auth = useAuth()

  const {
    data: clients = [],
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery<Client[], Error>({
    queryKey: ['clients', auth.session?.trainerId],
    enabled: auth.ready && Boolean(auth.session),
    queryFn: async () => {
      if (!auth.session) return []
      return fetchClients(auth.session)
    },
    staleTime: 10_000,
  })

  return (
    <ClientsContent
      clients={clients}
      isPending={isPending}
      isFetching={isFetching}
      error={error ?? null}
      onRetry={() => void refetch()}
      onRefresh={() => void refetch()}
    />
  )
}
