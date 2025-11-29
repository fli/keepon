'use client'

import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from 'app/theme'

import { getSettingsSections, type SettingItem, type SettingSection } from './data'
import { useSettingsActions } from './use-actions'

type Tile = SettingItem & { section: SettingSection['title'] }

export function SettingsScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const sections = useMemo(() => getSettingsSections(), [])
  const tiles: Tile[] = useMemo(
    () => sections.flatMap(section => section.data.map(item => ({ ...item, section: section.title } as Tile))),
    [sections]
  )
  const { handleAction, pendingId } = useSettingsActions()

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Settings</Text>
        <Text style={styles.heading}>Grid overview</Text>
        <Text style={styles.subtitle}>
          The essentials from the legacy iOS settings, now grouped into fast actions.
        </Text>
      </View>

      <View style={styles.grid}>
        {tiles.map(tile => (
          <Pressable
            key={tile.id}
            accessibilityRole="button"
            onPress={() => void handleAction(tile)}
            disabled={pendingId === tile.id}
            style={({ pressed }) => [
              styles.tile,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
              pressed ? styles.tilePressed : null,
              pendingId === tile.id ? styles.tileDisabled : null,
            ]}
          >
            <View
              style={[
                styles.glyph,
                {
                  backgroundColor: hexWithAlpha(tile.accent, 0.1),
                  borderColor: hexWithAlpha(tile.accent, 0.4),
                },
              ]}
            >
              <Text style={[styles.glyphLabel, { color: tile.accent }]}>{tile.glyph}</Text>
            </View>

            <View style={styles.tileBody}>
              <View style={styles.tileTopRow}>
                <Text style={[styles.sectionLabel, { color: theme.colors.secondaryText }]}>{tile.section}</Text>
                {renderBadge(tile.badge)}
              </View>
              <Text style={[styles.tileTitle, { color: theme.colors.text }]} numberOfLines={1}>
                {tile.title}
              </Text>
              <Text style={[styles.tileSubtitle, { color: theme.colors.secondaryText }]} numberOfLines={2}>
                {tile.subtitle}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function renderBadge(badge?: SettingItem['badge']) {
  if (!badge) return null
  const label = badge === 'web' ? 'Web' : badge === 'native' ? 'Native' : 'Soon'
  return (
    <View style={stylesBadges.badge}>
      <Text style={stylesBadges.badgeLabel}>{label}</Text>
    </View>
  )
}

const stylesBadges = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#374151',
  },
})

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    header: {
      gap: 8,
      maxWidth: 680,
    },
    kicker: {
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 1,
      color: theme.colors.secondaryText,
      fontWeight: '700',
    },
    heading: {
      fontSize: 28,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      fontSize: 15,
      color: theme.colors.secondaryText,
      lineHeight: 22,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -8,
      marginVertical: -8,
    },
    tile: {
      borderWidth: 1,
      borderRadius: theme.radii.lg,
      padding: theme.spacing.md,
      marginHorizontal: 8,
      marginVertical: 8,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 260,
      maxWidth: 360,
      gap: 12,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    tilePressed: {
      transform: [{ scale: 0.99 }],
      opacity: 0.9,
    },
    tileDisabled: {
      opacity: 0.6,
    },
    glyph: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    glyphLabel: {
      fontSize: 22,
    },
    tileBody: {
      gap: 4,
    },
    tileTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    tileTitle: {
      fontSize: 17,
      fontWeight: '800',
    },
    tileSubtitle: {
      fontSize: 14,
      lineHeight: 20,
    },
  })

function hexWithAlpha(hex: string, alpha: number) {
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return hex
}
