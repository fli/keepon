"use client"

import { useMemo } from 'react'
import { Pressable, Text, View, StyleSheet } from 'react-native'
import { SectionList } from '@legendapp/list/section-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useRouter } from 'app/navigation'
import { useTheme } from 'app/theme'
import { normalizeStatus } from './shared'
import type { Client } from 'app/services/api'

export type ClientsContentProps = {
  clients: Client[]
  isPending: boolean
  isFetching: boolean
  error: Error | null
  onRetry: () => void
  onRefresh: () => void
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
  const styles = makeIosStyles(theme, useSafeAreaInsets())
  const router = useRouter()

  const sections = useMemo(() => buildSections(clients), [clients])
  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item: Client) => item.id}
        renderItem={({ item }: { item: Client }) => (
          <Pressable
            onPress={() => router.push(`/clients/${item.id}`)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : undefined]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(item.firstName || '?').charAt(0)}</Text>
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
          error ? (
            <View style={styles.inlineAlert}>
              <Text style={styles.alertText}>Unable to load clients.</Text>
              <Pressable accessibilityRole="button" onPress={onRetry}>
                <Text style={styles.alertLink}>Retry</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !isPending ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No clients yet</Text>
              <Text style={styles.emptyBody}>Add clients to get started.</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        refreshing={isFetching && !isPending}
        onRefresh={onRefresh}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
      />
    </View>
  )
}

type ClientSection = { title: string; data: Client[] }

function buildSections(clients: Client[]): ClientSection[] {
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

const makeIosStyles = (
  theme: ReturnType<typeof useTheme>['theme'],
  insets: ReturnType<typeof useSafeAreaInsets>
) => {
  const hairlineWidth = (StyleSheet as { hairlineWidth?: number }).hairlineWidth ?? 0.5

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#f2f2f7',
    },
    listContent: {
      paddingBottom: 24 + insets.bottom,
      paddingTop: 8,
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
