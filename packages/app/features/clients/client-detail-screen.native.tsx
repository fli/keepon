'use client'

import { useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  StyleSheet,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'app/navigation'

import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { useAuth } from 'app/provider/auth'
import { fetchClients, type Client } from 'app/services/api'
import { useTheme } from 'app/theme'
import { ClientDetailCard } from './client-detail-card'

const useClientParams = useParams<{ clientId: string }>

const openLinkSafely = async (url: string) => {
  const open = Linking.openURL as (target: string) => Promise<void>
  return open(url)
}

type Props = {
  initialClients?: Client[] | null
}

export function ClientDetailScreen({ initialClients }: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { clientId } = useClientParams()
  const router = useRouter()
  const auth = useAuth()
  const isWeb = Platform.OS === 'web'
  const preloadedClients = isWeb ? initialClients ?? undefined : undefined

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

  const clients = useMemo(
    () => clientsData ?? preloadedClients ?? [],
    [clientsData, preloadedClients]
  )

  const client = useMemo(() => clients.find(item => item.id === clientId) ?? null, [clients, clientId])
  const heading = client ? clientName(client) : 'Client details'

  const handleBack = useCallback(() => {
    if (Platform.OS === 'web') {
      router.replace('/clients')
    } else {
      router.back()
    }
  }, [router])

  const handleEmail = useCallback(() => {
    if (!client?.email) return
    const url = `mailto:${client.email}`
    void openLinkSafely(url).catch(() => {
      if (typeof globalThis.alert === 'function') {
        globalThis.alert('Unable to open mail app.')
      }
    })
  }, [client])

  const handleCall = useCallback(() => {
    const number = client?.mobileNumber ?? client?.otherNumber
    if (!number) return
    const url = `tel:${number}`
    void openLinkSafely(url).catch(() => {
      if (typeof globalThis.alert === 'function') {
        globalThis.alert('Unable to start a call on this device.')
      }
    })
  }, [client])

  if (!auth.ready) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.colors.secondaryText} />
      </View>
    )
  }

  if (!auth.session) {
    return (
      <View style={[styles.container, styles.centered]}>
        {isWeb ? (
          <View style={styles.breadcrumbRow}>
            <Pressable
              onPress={handleBack}
              accessibilityRole="link"
              accessibilityLabel="Back to clients"
            >
              <Text style={styles.breadcrumbLink}>Clients</Text>
            </Pressable>
            <Text style={styles.breadcrumbSeparator}>/</Text>
            <Text style={styles.breadcrumbCurrent}>{heading}</Text>
          </View>
        ) : null}
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.subtitle}>Sign in to view and manage your clients.</Text>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
      contentContainerStyle={styles.content}
    >
      {isWeb ? (
        <View style={styles.headerRow}>
          <View style={styles.breadcrumbRow}>
            <Pressable
              onPress={handleBack}
              accessibilityRole="link"
              accessibilityLabel="Back to clients"
            >
              <Text style={styles.breadcrumbLink}>Clients</Text>
            </Pressable>
            <Text style={styles.breadcrumbSeparator}>/</Text>
            <Text style={styles.breadcrumbCurrent}>{heading}</Text>
          </View>
          <Text style={styles.heading}>{heading}</Text>
        </View>
      ) : null}

      {error ? (
        <Card style={styles.card}>
          <Text style={styles.errorText}>Unable to load clients.</Text>
          <Button label="Retry" onPress={() => void refetch()} />
        </Card>
      ) : null}

      {isPending && !client ? (
        <Card style={styles.card}>
          <ActivityIndicator color={theme.colors.secondaryText} />
        </Card>
      ) : null}

      {client ? (
        <ClientDetailCard
          client={client}
          onEmail={handleEmail}
          onCall={handleCall}
          title="Client details"
        />
      ) : !isPending ? (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Client not found</Text>
          <Text style={styles.helperText}>
            This link may be out of date. Return to the client list to refresh.
          </Text>
        </Card>
      ) : null}

      {isFetching && client ? (
        <Card style={styles.card}>
          <ActivityIndicator color={theme.colors.secondaryText} />
        </Card>
      ) : null}
    </ScrollView>
  )
}

function clientName(client: Client) {
  const full = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  return full.length > 0 ? full : 'Client'
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      flexGrow: 1,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    headerRow: {
      gap: theme.spacing.xs,
      alignItems: 'flex-start',
    },
    breadcrumbRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    breadcrumbLink: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
      _web: { cursor: 'pointer' },
    },
    breadcrumbSeparator: {
      color: theme.colors.secondaryText,
    },
    breadcrumbCurrent: {
      color: theme.colors.text,
      fontWeight: '800',
    },
    heading: {
      fontSize: theme.typography.h1 + 4,
      fontWeight: '900',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
      marginTop: 4,
      lineHeight: 20,
    },
    card: {
      gap: theme.spacing.sm,
    },
    cardTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    helperText: {
      color: theme.colors.secondaryText,
    },
    errorText: {
      color: '#dc2626',
      fontWeight: '700',
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
  })
