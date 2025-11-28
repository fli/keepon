"use client"

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View, Platform, type StyleProp, type ViewStyle, StyleSheet } from 'react-native'

import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { LegendList } from 'app/components/legend-list'
import { SecondaryButton } from 'app/components/secondary-button'
import { useRouter } from 'app/navigation'
import { useTheme } from 'app/theme'
import { normalizeStatus, statusColors, statusOptions, type StatusFilter } from './shared'
import { ClientsLoading } from './loading'
import type { Client } from 'app/services/api'

export type ClientsContentProps = {
  clients: Client[]
  isPending: boolean
  isFetching: boolean
  error: Error | null
  onRetry: () => void
  onRefresh: () => void
}

type ClientSection = {
  title: string
  data: Client[]
}

export function ClientsContent({
  clients,
  isPending,
  isFetching,
  error,
  onRetry,
  onRefresh,
}: ClientsContentProps) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()

  const [status, setStatus] = useState<StatusFilter>('current')

  const statusCounts = useMemo(() => {
    return clients.reduce(
      (acc, client) => {
        const key = normalizeStatus(client.status)
        acc[key] = acc[key] + 1
        return acc
      },
      { current: 0, lead: 0, past: 0 } as Record<StatusFilter, number>
    )
  }, [clients])

  const filteredClients = useMemo(
    () => clients.filter(client => normalizeStatus(client.status) === status),
    [clients, status]
  )

  const sections = useMemo<ClientSection[]>(
    () => buildSections(filteredClients),
    [filteredClients]
  )

  const openAddModal = useCallback(
    (currentStatus: StatusFilter) => {
      router.push(`/clients/add?status=${currentStatus}`)
    },
    [router]
  )

  if (isPending && clients.length === 0) {
    return <ClientsLoading />
  }

  return (
    <LegendList
      sections={sections}
      keyExtractor={item => item.id}
      renderItem={({ item }) => {
        const href = `/clients/${item.id}`
        return (
          <Pressable
            onPress={() => router.push(href)}
            accessibilityRole="button"
            style={({ pressed }): StyleProp<ViewStyle> =>
              [
                styles.itemRow as ViewStyle,
                pressed && Platform.OS !== 'web' ? (styles.itemPressed as ViewStyle) : undefined,
              ]}
          >
            <ClientRowContent client={item} styles={styles} theme={theme} />
          </Pressable>
        )
      }}
      ListHeaderComponent={
        <View style={styles.headerArea}>
          <View style={styles.headingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>Clients</Text>
              <Text style={styles.subtitle}>
                Segmented client list mirrored from the native app. Use the legend list to jump by initials.
              </Text>
            </View>
            <Button label="Add client" onPress={() => openAddModal(status)} style={styles.primaryButton} />
          </View>

          <View style={styles.filterRow}>
            {statusOptions.map(option => {
              const active = status === option.id
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  onPress={() => setStatus(option.id)}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{option.label}</Text>
                  <View
                    style={[
                      styles.pillCount,
                      { backgroundColor: active ? 'rgba(255,255,255,0.15)' : theme.colors.surface },
                    ]}
                  >
                    <Text style={[styles.pillCountLabel, active && styles.pillCountLabelActive]}>
                      {statusCounts[option.id] ?? 0}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.legendRow}>
            {(Object.keys(statusColors) as StatusFilter[]).map(key => (
              <View key={key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: statusColors[key] }]} />
                <Text style={styles.legendLabel}>{statusOptions.find(o => o.id === key)?.label}</Text>
              </View>
            ))}
          </View>

          {error ? (
            <Card style={styles.card}>
              <Text style={styles.errorText}>Unable to load clients.</Text>
              <Button label="Retry" onPress={onRetry} />
            </Card>
          ) : null}

          {isPending ? (
            <Card style={styles.card}>
              <ActivityIndicator color={theme.colors.secondaryText} />
            </Card>
          ) : null}
        </View>
      }
      refreshing={isFetching && !isPending}
      onRefresh={onRefresh}
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
      ListEmptyComponent={
        !isPending ? (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>No clients yet</Text>
            <Text style={styles.helperText}>
              Add clients or import them from your phone to start booking and billing.
            </Text>
            <View style={styles.actionsRow}>
              <Button label="Add client" onPress={() => openAddModal(status)} />
              <SecondaryButton
                label="Import (native)"
                onPress={() => {
                  if (typeof globalThis.alert === 'function') {
                    globalThis.alert('Import from contacts is available in the native app.')
                  } else {
                    console.info('Import from contacts is available in the native app.')
                  }
                }}
              />
            </View>
          </Card>
        ) : null
      }
    />
  )
}

function buildSections(clients: Client[]): ClientSection[] {
  // same as before: group by first letter of last or first name
  const map = new Map<string, Client[]>()
  for (const client of clients) {
    const letter = (client.lastName || client.firstName || '').trim().charAt(0).toUpperCase() || '#'
    if (!map.has(letter)) map.set(letter, [])
    map.get(letter)!.push(client)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, data]) => ({ title, data }))
}

function ClientRowContent({
  client,
  styles,
  theme,
}: {
  client: Client
  styles: ReturnType<typeof makeStyles>
  theme: ReturnType<typeof useTheme>['theme']
}) {
  return (
    <View style={styles.itemInner}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(client.firstName || '?').charAt(0)}</Text>
      </View>
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <Text style={styles.clientName}>
          {client.firstName} {client.lastName}
        </Text>
        <Text style={styles.clientStatus}>{client.status ?? 'current'}</Text>
      </View>
    </View>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
      backgroundColor: theme.colors.background,
    },
    listContent: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    headerArea: {
      gap: theme.spacing.md,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    heading: {
      fontSize: theme.typography.h1 + 6,
      fontWeight: '900',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
      lineHeight: 20,
    },
    primaryButton: {
      alignSelf: 'flex-start',
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    pill: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    pillActive: {
      backgroundColor: theme.colors.text,
      borderColor: theme.colors.text,
    },
    pillLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    pillLabelActive: {
      color: theme.colors.background,
    },
    pillCount: {
      marginTop: 4,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: 2,
      borderRadius: theme.radii.sm,
      alignSelf: 'flex-start',
    },
    pillCountLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    pillCountLabelActive: {
      color: theme.colors.background,
    },
    legendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      flexWrap: 'wrap',
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    legendDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    legendLabel: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
    },
    card: {
      gap: theme.spacing.md,
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
    actionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    itemRow: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    itemPressed: {
      backgroundColor: theme.colors.surface,
    },
    itemInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    avatarText: {
      fontWeight: '800',
      color: theme.colors.text,
    },
    clientName: {
      fontWeight: '800',
      color: theme.colors.text,
    },
    clientStatus: {
      color: theme.colors.secondaryText,
      fontSize: 12,
      textTransform: 'capitalize',
    },
  })
