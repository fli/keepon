import { Text, View, StyleSheet } from 'react-native'
import { Card } from 'app/components/card'
import { useTheme } from 'app/theme'

export function FinanceScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Finance</Text>
      <Card>
        <Text style={styles.cardTitle}>Revenue snapshot</Text>
        <Text style={styles.cardBody}>Detailed finance charts will land once data hooks are migrated.</Text>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Overdue items</Text>
        <Text style={styles.cardBody}>Track overdue payments and nudge clients with reminders.</Text>
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
    },
  })
