'use client'

import { View, Text, StyleSheet } from 'react-native'

import { Card } from 'app/components/card'
import { Button } from 'app/components/button'
import { SecondaryButton } from 'app/components/secondary-button'
import { useTheme } from 'app/theme'
import { normalizeStatus, optionalValue, statusColors, statusOptions } from './shared'
import type { Client } from 'app/services/api'

type Props = {
  client: Client
  title?: string
  actionLabel?: string
  onClear?: () => void
  onEmail?: () => void
  onCall?: () => void
}

export function ClientDetailCard({
  client,
  title = 'Client details',
  actionLabel = 'Back',
  onClear,
  onEmail,
  onCall,
}: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const showAction = Boolean(onClear)

  const status = normalizeStatus(client.status)
  const statusLabel = statusOptions.find(option => option.id === status)?.label ?? 'Current'

  const email = optionalValue(client.email)
  const mobile = optionalValue(client.mobileNumber)
  const other = optionalValue(client.otherNumber)
  const company = optionalValue(client.company)

  const canEmail = Boolean(email)
  const canCall = Boolean(mobile ?? other)

  return (
    <Card style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text style={styles.detailTitle}>{title}</Text>
          <View style={styles.detailTopRow}>
            <View style={[styles.avatarLarge, { backgroundColor: colorForId(client.id) }]}>
              <Text style={styles.avatarText}>{initials(client)}</Text>
            </View>
            <View style={{ gap: theme.spacing.xs, flexShrink: 1 }}>
              <Text style={styles.detailName}>{clientName(client)}</Text>
              {company ? <Text style={styles.clientInfo}>{company}</Text> : null}
              <View style={[styles.statusBadge, { backgroundColor: statusColors[status] }]}>
                <Text style={styles.statusLabel}>{statusLabel}</Text>
              </View>
            </View>
          </View>
      </View>

        {showAction ? <SecondaryButton label={actionLabel} onPress={onClear} /> : null}
      </View>

      <View style={styles.divider} />

      <DetailRow label="Email" value={email ?? 'Not provided'} muted={!email} styles={styles} />
      <DetailRow label="Mobile" value={mobile ?? 'Not provided'} muted={!mobile} styles={styles} />
      <DetailRow label="Other" value={other ?? 'Not provided'} muted={!other} styles={styles} />
      {company ? <DetailRow label="Company" value={company} styles={styles} /> : null}

      <View style={styles.divider} />

      <View style={styles.actionsRow}>
        <Button label="Email" onPress={onEmail} disabled={!canEmail} />
        <SecondaryButton label="Call" onPress={onCall} disabled={!canCall} />
      </View>
    </Card>
  )
}

function DetailRow({
  label,
  value,
  muted,
  styles,
}: {
  label: string
  value: string
  muted?: boolean
  styles: ReturnType<typeof makeStyles>
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, muted && styles.detailMuted]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

function clientName(client: Client) {
  const full = `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim()
  return full.length > 0 ? full : 'Client'
}

function initials(client: Client) {
  const firstInitial = client.firstName?.[0]?.toUpperCase() ?? ''
  const lastInitial = client.lastName?.[0]?.toUpperCase() ?? ''
  return (firstInitial + lastInitial || 'C').slice(0, 2)
}

function colorForId(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 45%)`
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    detailCard: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      flexWrap: 'wrap',
    },
    detailTitle: {
      color: theme.colors.secondaryText,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: '700',
      fontSize: 12,
    },
    detailTopRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      alignItems: 'center',
    },
    detailName: {
      fontWeight: '800',
      fontSize: 18,
      color: theme.colors.text,
    },
    clientInfo: {
      color: theme.colors.secondaryText,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
      gap: theme.spacing.sm,
    },
    detailLabel: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
      flexShrink: 0,
    },
    detailValue: {
      color: theme.colors.text,
      fontWeight: '600',
      flex: 1,
      textAlign: 'right',
    },
    detailMuted: {
      color: theme.colors.secondaryText,
      fontWeight: '500',
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border,
    },
    statusBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radii.sm,
    },
    statusLabel: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 12,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    avatarLarge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 18,
    },
  })
