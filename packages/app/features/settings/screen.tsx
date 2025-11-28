'use client'

import { Text, View, StyleSheet } from 'react-native'
import { Card } from 'app/components/card'
import { Button } from 'app/components/button'
import { useAuth } from 'app/provider/auth'
import { logout } from 'app/services/api'
import { useState } from 'react'
import { useTheme } from 'app/theme'

export function SettingsScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { session, token, clearSession } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      await logout(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to log out')
    } finally {
      await clearSession()
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Settings</Text>
      <Card>
        <Text style={styles.cardTitle}>Account</Text>
        <Text style={styles.cardBody}>Manage your Keepon session.</Text>
        <Button label="Sign out" onPress={() => void handleLogout()} loading={loading} disabled={!token} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
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
    heading: {
      fontSize: theme.typography.h1,
      fontWeight: '800',
      color: theme.colors.text,
    },
    cardTitle: {
      fontWeight: '700',
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    cardBody: {
      color: theme.colors.secondaryText,
      marginBottom: theme.spacing.sm,
    },
    error: {
      color: '#ef4444',
      marginTop: theme.spacing.sm,
    },
  })
