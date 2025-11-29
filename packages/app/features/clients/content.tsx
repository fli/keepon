'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  Platform,
  type StyleProp,
  type ViewStyle,
  StyleSheet,
} from 'react-native'
import { SectionList, type SectionListRef } from '@legendapp/list/section-list'
import { Button } from 'app/components/button'
import { Card } from 'app/components/card'
import { SecondaryButton } from 'app/components/secondary-button'

import { LegendList } from 'app/components/legend-list'
import { useRouter } from 'app/navigation'
import { useTheme } from 'app/theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  normalizeStatus,
  statusColors,
  statusOptions,
  type StatusFilter,
} from './shared'
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
  const isIOS = Platform.OS === 'ios'

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
    () => clients.filter((client) => normalizeStatus(client.status) === status),
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

  const handleClientPress = useCallback(
    (clientId: string) => {
      router.push(`/clients/${clientId}`)
    },
    [router]
  )

  if (isPending && clients.length === 0) {
    return <ClientsLoading />
  }

  if (isIOS) {
    return (
      <ClientsListIOS
        sections={sections}
        status={status}
        statusCounts={statusCounts}
        onStatusChange={setStatus}
        isPending={isPending}
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        onRefresh={onRefresh}
        onPressClient={handleClientPress}
        onAdd={() => openAddModal(status)}
        theme={theme}
      />
    )
  }

  return (
    <LegendList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const href = `/clients/${item.id}`
        return (
          <Pressable
            onPress={() => router.push(href)}
            accessibilityRole="button"
            style={({ pressed }): StyleProp<ViewStyle> => [
              styles.itemRow as ViewStyle,
              pressed && Platform.OS !== 'web'
                ? (styles.itemPressed as ViewStyle)
                : undefined,
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
                Segmented client list mirrored from the native app. Use the
                legend list to jump by initials.
              </Text>
            </View>
            <Button
              label="Add client"
              onPress={() => openAddModal(status)}
              style={styles.primaryButton}
            />
          </View>

          <View style={styles.filterRow}>
            {statusOptions.map((option) => {
              const active = status === option.id
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  onPress={() => setStatus(option.id)}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text
                    style={[styles.pillLabel, active && styles.pillLabelActive]}
                  >
                    {option.label}
                  </Text>
                  <View
                    style={[
                      styles.pillCount,
                      {
                        backgroundColor: active
                          ? 'rgba(255,255,255,0.15)'
                          : theme.colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillCountLabel,
                        active && styles.pillCountLabelActive,
                      ]}
                    >
                      {statusCounts[option.id] ?? 0}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.legendRow}>
            {(Object.keys(statusColors) as StatusFilter[]).map((key) => (
              <View key={key} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: statusColors[key] },
                  ]}
                />
                <Text style={styles.legendLabel}>
                  {statusOptions.find((o) => o.id === key)?.label}
                </Text>
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
      contentInsetAdjustmentBehavior={
        Platform.OS === 'ios' ? 'automatic' : undefined
      }
      ListEmptyComponent={
        !isPending ? (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>No clients yet</Text>
            <Text style={styles.helperText}>
              Add clients or import them from your phone to start booking and
              billing.
            </Text>
            <View style={styles.actionsRow}>
              <Button label="Add client" onPress={() => openAddModal(status)} />
              <SecondaryButton
                label="Import (native)"
                onPress={() => {
                  if (typeof globalThis.alert === 'function') {
                    globalThis.alert(
                      'Import from contacts is available in the native app.'
                    )
                  } else {
                    console.info(
                      'Import from contacts is available in the native app.'
                    )
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

type ClientsListIOSProps = {
  sections: ClientSection[]
  status: StatusFilter
  statusCounts: Record<StatusFilter, number>
  onStatusChange: (status: StatusFilter) => void
  isPending: boolean
  isFetching: boolean
  error: Error | null
  onRetry: () => void
  onRefresh: () => void
  onPressClient: (clientId: string) => void
  onAdd: () => void
  theme: ReturnType<typeof useTheme>['theme']
}

function ClientsListIOS({
  sections,
  status,
  statusCounts,
  onStatusChange,
  isPending,
  isFetching,
  error,
  onRetry,
  onRefresh,
  onPressClient,
  onAdd,
  theme,
}: ClientsListIOSProps) {
  const insets = useSafeAreaInsets()
  const listRef = useRef<SectionListRef>(null)
  const styles = makeIosStyles(theme, insets)

  const sectionTitles = useMemo(
    () => sections.map((section) => section.title),
    [sections]
  )

  const handleJumpToSection = useCallback(
    (index: number) => {
      listRef.current?.scrollToLocation({
        sectionIndex: index,
        itemIndex: 0,
        viewOffset: 24,
        animated: true,
      })
    },
    []
  )

  return (
    <View style={styles.container}>
      <SectionList<Client, ClientSection>
        ref={listRef}
        style={styles.list}
        sections={sections}
        keyExtractor={(item: Client) => item.id}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        refreshing={isFetching && !isPending}
        onRefresh={onRefresh}
        scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }: { item: Client }) => (
          <Pressable
            onPress={() => onPressClient(item.id)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.rowPressed : undefined,
            ]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.firstName || '?').charAt(0)}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.name} numberOfLines={1}>
                {item.firstName} {item.lastName}
              </Text>
              <Text style={styles.status} numberOfLines={1}>
                {normalizeStatus(item.status)}
              </Text>
            </View>
          </Pressable>
        )}
        renderSectionHeader={({ section }: { section: ClientSection }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.heading}>Clients</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onAdd}
                style={styles.addButton}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Alphabetized list with quick index, like Contacts.
            </Text>

            <View style={styles.segmentRow}>
              {statusOptions.map((option) => {
                const active = status === option.id
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    onPress={() => onStatusChange(option.id)}
                    style={[
                      styles.segmentButton,
                      active && styles.segmentButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentLabel,
                        active && styles.segmentLabelActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <View
                      style={[
                        styles.segmentCount,
                        active && styles.segmentCountActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentCountText,
                          active && styles.segmentCountTextActive,
                        ]}
                      >
                        {statusCounts[option.id] ?? 0}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>

            {error ? (
              <View style={styles.inlineAlert}>
                <Text style={styles.alertText}>Unable to load clients.</Text>
                <Pressable accessibilityRole="button" onPress={onRetry}>
                  <Text style={styles.alertLink}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            {isPending ? (
              <View style={styles.inlineLoader}>
                <ActivityIndicator color={theme.colors.secondaryText} />
                <Text style={styles.loaderText}>Syncing…</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !isPending ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No clients yet</Text>
              <Text style={styles.emptyBody}>
                Add clients or import them from your phone contacts to start
                booking and billing.
              </Text>
              <View style={styles.emptyActions}>
                <Pressable style={styles.addClientButton} onPress={onAdd}>
                  <Text style={styles.addClientButtonText}>Add client</Text>
                </Pressable>
                <Pressable
                  style={styles.importButton}
                  onPress={() => {
                    if (typeof globalThis.alert === 'function') {
                      globalThis.alert(
                        'Import from contacts is available in the native app.'
                      )
                    } else {
                      console.info(
                        'Import from contacts is available in the native app.'
                      )
                    }
                  }}
                >
                  <Text style={styles.importButtonText}>Import from contacts</Text>
                </Pressable>
              </View>
            </View>
          ) : null
        }
      />

      {sectionTitles.length > 1 ? (
        <View pointerEvents="box-none" style={styles.indexRail}>
          {sectionTitles.map((title, index) => (
            <Pressable
              key={title}
              accessibilityRole="button"
              onPress={() => handleJumpToSection(index)}
              style={styles.indexLetterHit}
              hitSlop={6}
            >
              <Text style={styles.indexLetter}>{title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function buildSections(clients: Client[]): ClientSection[] {
  // same as before: group by first letter of last or first name
  const map = new Map<string, Client[]>()
  for (const client of clients) {
    const letter =
      (client.lastName || client.firstName || '')
        .trim()
        .charAt(0)
        .toUpperCase() || '#'
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
        <Text style={styles.avatarText}>
          {(client.firstName || '?').charAt(0)}
        </Text>
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

const makeIosStyles = (
  theme: ReturnType<typeof useTheme>['theme'],
  insets: ReturnType<typeof useSafeAreaInsets>
) => {
  const hairlineWidth =
    (StyleSheet as { hairlineWidth?: number }).hairlineWidth ?? 0.5

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#f2f2f7',
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingBottom: 24 + insets.bottom,
      paddingTop: 8,
    },
    header: {
      paddingTop: 12 + insets.top,
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 10,
      backgroundColor: '#f2f2f7',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heading: {
      fontSize: theme.typography.h1 + 2,
      fontWeight: '800',
      color: theme.colors.text,
    },
    addButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: 'rgba(0,122,255,0.12)',
    },
    addButtonText: {
      color: '#007AFF',
      fontWeight: '700',
    },
    addClientButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: '#007AFF',
    },
    addClientButtonText: {
      color: '#fff',
      fontWeight: '700',
    },
    importButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: '#e5e5ea',
    },
    importButtonText: {
      color: '#3a3a3c',
      fontWeight: '700',
    },
    subtitle: {
      color: theme.colors.secondaryText,
      lineHeight: 18,
    },
    segmentRow: {
      flexDirection: 'row',
      backgroundColor: '#e5e5ea',
      borderRadius: 12,
      padding: 4,
      gap: 6,
      alignSelf: 'flex-start',
    },
    segmentButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
    },
    segmentButtonActive: {
      backgroundColor: '#fff',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    segmentLabel: {
      color: '#3a3a3c',
      fontWeight: '700',
    },
    segmentLabelActive: {
      color: '#000',
    },
    segmentCount: {
      marginLeft: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    segmentCountActive: {
      backgroundColor: 'rgba(0,122,255,0.12)',
    },
    segmentCountText: {
      fontSize: 12,
      color: '#3a3a3c',
      fontWeight: '700',
    },
    segmentCountTextActive: {
      color: '#007AFF',
    },
    inlineAlert: {
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: '#fef2f2',
      borderRadius: 12,
      borderWidth: hairlineWidth,
      borderColor: '#fecdd3',
    },
    alertText: {
      color: '#b91c1c',
      fontWeight: '700',
    },
    alertLink: {
      color: '#007AFF',
      fontWeight: '700',
    },
    inlineLoader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    loaderText: {
      color: theme.colors.secondaryText,
      fontWeight: '600',
    },
    sectionHeader: {
      backgroundColor: '#f2f2f7',
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderBottomWidth: hairlineWidth,
      borderBottomColor: '#c7c7cc',
    },
    sectionTitle: {
      color: '#6e6e73',
      fontWeight: '700',
      fontSize: 12,
      letterSpacing: 0.4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#fff',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: hairlineWidth,
      borderBottomColor: '#c7c7cc',
    },
    rowPressed: {
      backgroundColor: '#f0f0f5',
    },
    rowBody: {
      flex: 1,
      marginLeft: 12,
      gap: 2,
    },
    name: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 16,
    },
    status: {
      color: theme.colors.secondaryText,
      fontSize: 12,
      textTransform: 'capitalize',
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#e5e5ea',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: '#3a3a3c',
      fontWeight: '800',
    },
    separator: {
      height: hairlineWidth,
      backgroundColor: '#c7c7cc',
      marginLeft: 64,
    },
    emptyState: {
      backgroundColor: '#fff',
      marginHorizontal: 16,
      marginTop: 12,
      padding: 16,
      borderRadius: 14,
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1,
    },
    emptyTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    emptyBody: {
      color: theme.colors.secondaryText,
      lineHeight: 18,
    },
    emptyActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    indexRail: {
      position: 'absolute',
      right: 4,
      top: insets.top + 96,
      bottom: insets.bottom + 12,
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: 'rgba(242,242,247,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    indexLetterHit: {
      paddingVertical: 3,
      paddingHorizontal: 6,
    },
    indexLetter: {
      fontSize: 11,
      color: '#007AFF',
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  })
}
