"use client"

import { ActivityIndicator, View, Text, StyleSheet } from 'react-native'

import { Card } from 'app/components/card'
import { useTheme } from 'app/theme'

type Props = {
  title?: string
}

// Shared loading state for Clients across web (Suspense fallback) and native screens.
export function ClientsLoading({ title = 'Loading clients…' }: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)

  return (
    <View style={styles.container}>
      <View style={styles.header}> 
        <Text style={styles.heading}>Clients</Text>
        <Text style={styles.subtitle}>{title}</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.skeletonRow}>
          <View style={[styles.avatar, styles.skeleton]} />
          <View style={styles.textCol}>
            <View style={[styles.line, styles.skeleton, { width: '65%' }]} />
            <View style={[styles.line, styles.skeleton, { width: '45%' }]} />
          </View>
        </View>
        <View style={styles.skeletonRow}>
          <View style={[styles.avatar, styles.skeleton]} />
          <View style={styles.textCol}>
            <View style={[styles.line, styles.skeleton, { width: '72%' }]} />
            <View style={[styles.line, styles.skeleton, { width: '52%' }]} />
          </View>
        </View>
        <ActivityIndicator style={{ marginTop: theme.spacing.sm }} color={theme.colors.secondaryText} />
      </Card>
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
    header: {
      gap: theme.spacing.xs,
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
    card: {
      gap: theme.spacing.md,
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    textCol: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    line: {
      height: 12,
      borderRadius: theme.radii.sm,
    },
    skeleton: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
  })
