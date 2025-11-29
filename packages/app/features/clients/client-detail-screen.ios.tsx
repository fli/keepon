'use client'

import React, { useEffect, useMemo, useCallback } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useQuery } from '@tanstack/react-query'

import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { SecondaryButton } from 'app/components/secondary-button'
import { useParams, useRouter } from 'app/navigation'
import type { ClientsStackParamList } from 'app/navigation/types'
import { useAuth } from 'app/provider/auth'
import { fetchClients, type Client } from 'app/services/api'
import { useTheme } from 'app/theme'
import { ClientDetailCard } from './client-detail-card'

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
  const { theme } = useTheme()

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

  const styles = makeStyles(theme)
  const refreshing = isFetching && !isPending

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack()
      return
    }
    router.push('/clients')
  }, [navigation, router])

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.systemBackground }]} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={[styles.content, { backgroundColor: theme.colors.systemBackground }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          auth.session ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refetch()}
              tintColor={theme.colors.systemBlue}
            />
          ) : undefined
        }
      >
        <Text style={[styles.heading, { color: theme.colors.text }]}>{heading}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.secondaryText }]}>Client details</Text>

        {!auth.ready ? (
          <Card style={styles.card}>
            <ActivityIndicator color={theme.colors.systemBlue} />
            <Text style={[styles.body, { color: theme.colors.secondaryText }]}>Loading session…</Text>
          </Card>
        ) : !auth.session ? (
          <Card style={styles.card}>
            <Text style={[styles.body, { color: theme.colors.text }]}>Sign in to view this client.</Text>
            <SecondaryButton label="Back to clients" onPress={() => router.push('/clients')} />
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.card}>
            <Text style={[styles.body, { color: '#ef4444' }]}>Unable to load clients.</Text>
            <Button label="Retry" onPress={() => void refetch()} />
          </Card>
        ) : null}

        {isPending && !client ? (
          <Card style={styles.card}>
            <ActivityIndicator color={theme.colors.systemBlue} />
            <Text style={[styles.body, { color: theme.colors.secondaryText }]}>Loading client…</Text>
          </Card>
        ) : null}

        {client ? (
          <ClientDetailCard client={client} actionLabel="Back to clients" onClear={handleBack} />
        ) : !isPending && auth.session ? (
          <Card style={styles.card}>
            <Text style={[styles.body, { color: theme.colors.text }]}>Client not found.</Text>
            <Text style={[styles.bodySmall, { color: theme.colors.secondaryText }]}>
              This link may be out of date. Return to the list to refresh.
            </Text>
            <SecondaryButton label="Back to clients" onPress={handleBack} />
          </Card>
        ) : null}

        {refreshing && client ? (
          <Text style={[styles.refreshHint, { color: theme.colors.secondaryText }]}>Refreshing client details…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function clientName(client: Client) {
  const full = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  return full.length > 0 ? full : 'Client'
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
    },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.md,
      flexGrow: 1,
    },
    heading: {
      fontSize: 24,
      fontWeight: '800',
    },
    subtitle: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    card: {
      gap: theme.spacing.sm,
    },
    body: {
      fontSize: 16,
      fontWeight: '600',
    },
    bodySmall: {
      fontSize: 14,
      lineHeight: 18,
    },
    refreshHint: {
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 2,
    },
  })
