'use client'

import React, { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LegendList } from 'app/components/legend-list'
import { useTheme } from 'app/theme'

import { getSettingsSections, type SettingItem } from './data'
import { useSettingsActions } from './use-actions'

export function SettingsScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const insets = useSafeAreaInsets()
  const sections = useMemo(() => getSettingsSections(), [])
  const { handleAction, pendingId } = useSettingsActions()

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + theme.spacing.md }]}>
      <Text style={styles.kicker}>Settings</Text>
      <Text style={styles.heading}>Control your Keepon workspace</Text>
      <Text style={styles.subtitle}>
        Mirrored from the legacy iOS app: templates, bookings, payouts, and account.
      </Text>
    </View>
  )

  return (
    <LegendList<SettingItem>
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <SettingRow
          item={item}
          onPress={() => void handleAction(item)}
          disabled={pendingId === item.id}
          themeColors={theme.colors}
          radii={theme.radii}
        />
      )}
      stickySectionHeadersEnabled
      ListHeaderComponent={header}
      contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + theme.spacing.lg }]}
    />
  )
}

type SettingRowProps = {
  item: SettingItem
  onPress: () => void
  disabled?: boolean
  themeColors: ReturnType<typeof useTheme>['theme']['colors']
  radii: ReturnType<typeof useTheme>['theme']['radii']
}

function SettingRow({ item, onPress, disabled, themeColors, radii }: SettingRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        stylesRow.row,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderRadius: radii.md },
        pressed ? { transform: [{ scale: 0.99 }], opacity: 0.9 } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      <View
        style={[
          stylesRow.glyph,
          {
            backgroundColor: hexWithAlpha(item.accent, 0.12),
            borderColor: hexWithAlpha(item.accent, 0.6),
          },
        ]}
      >
        <Text style={[stylesRow.glyphLabel, { color: item.accent }]}>{item.glyph}</Text>
      </View>

      <View style={stylesRow.body}>
        <View style={stylesRow.titleRow}>
          <Text style={[stylesRow.title, { color: themeColors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
        <Text style={[stylesRow.subtitle, { color: themeColors.secondaryText }]} numberOfLines={2}>
          {item.subtitle}
        </Text>
      </View>
    </Pressable>
  )
}

const stylesRow = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderWidth: 1,
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
  body: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
})

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    listContent: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
    },
    header: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    kicker: {
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 1,
      color: theme.colors.secondaryText,
      fontWeight: '700',
    },
    heading: {
      fontSize: 26,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      fontSize: 15,
      color: theme.colors.secondaryText,
      lineHeight: 22,
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
