'use client'

import React, { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  Screen,
  SectionList,
  Section,
  Card,
  TitleText,
  CaptionText,
  PrimaryButton,
  LoadingSpinner,
} from 'app/ui/native'
import { useParams, useRouter } from 'app/navigation'
import { useAuth } from 'app/provider/auth'
import { fetchClients, type Client } from 'app/services/api'
import type { ClientsStackParamList } from 'app/navigation/types'

const useClientParams = useParams<{ clientId: string }>
type ClientsNavigation = NativeStackNavigationProp<ClientsStackParamList>

type Props = {
  initialClients?: Client[] | null
}

export function ClientDetailScreen({ initialClients }: Props) {
  const { clientId } = useClientParams()
  const router = useRouter()
  const auth = useAuth()
  const navigation = useNavigation<ClientsNavigation>()

  const preloadedClients = initialClients ?? undefined

  const {
    data: clientsData,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery<Client[], Error>({
    queryKey: ['clients', auth.session?.trainerId],
    enabled: auth.ready && Boolean(auth.session),
    queryFn: () => (auth.session ? fetchClients(auth.session) : Promise.resolve([])),
    staleTime: 30_000,
    initialData: preloadedClients,
    initialDataUpdatedAt: preloadedClients ? Date.now() : undefined,
  })

  const clients = useMemo(() => clientsData ?? preloadedClients ?? [], [clientsData, preloadedClients])
  const client = useMemo(() => clients.find(item => item.id === clientId) ?? null, [clients, clientId])
  const heading = client ? clientName(client) : 'Client details'

  useEffect(() => {
    navigation.setOptions({ title: heading })
  }, [heading, navigation])

  if (!auth.ready) {
    return (
      <Screen title={heading} subtitle="Loading session">
        <Card>
          <LoadingSpinner />
        </Card>
      </Screen>
    )
  }

  if (!auth.session) {
    return (
      <Screen title={heading} subtitle="Sign in to view this client">
        <CaptionText>Authentication required.</CaptionText>
      </Screen>
    )
  }

  return (
    <Screen title={heading} subtitle="SwiftUI-native details">
      <SectionList>
        {error ? (
          <Section title="Error">
            <Card>
              <CaptionText color="#f87171">Unable to load clients.</CaptionText>
              <PrimaryButton onPress={() => void refetch()}>Retry</PrimaryButton>
            </Card>
          </Section>
        ) : null}

        {isPending && !client ? (
          <Section title="Loading">
            <Card>
              <LoadingSpinner />
            </Card>
          </Section>
        ) : null}

        {client ? (
          <Section title="Client">
            <Card>
              <TitleText size={20}>{clientName(client)}</TitleText>
              {client.email ? <CaptionText>{client.email}</CaptionText> : null}
              {client.mobileNumber || client.otherNumber ? (
                <CaptionText>{client.mobileNumber ?? client.otherNumber}</CaptionText>
              ) : null}
              {client.status ? <CaptionText>Status: {client.status}</CaptionText> : null}
              <PrimaryButton onPress={() => router.push('/clients')}>Back to clients</PrimaryButton>
            </Card>
          </Section>
        ) : !isPending ? (
          <Section title="Missing">
            <Card>
              <TitleText size={18}>Client not found</TitleText>
              <CaptionText>This link may be out of date. Return to the list to refresh.</CaptionText>
            </Card>
          </Section>
        ) : null}

        {isFetching && client ? (
          <Section title="Refreshing">
            <CaptionText>Updating client details…</CaptionText>
          </Section>
        ) : null}
      </SectionList>
    </Screen>
  )
}

function clientName(client: Client) {
  const full = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  return full.length > 0 ? full : 'Client'
}
