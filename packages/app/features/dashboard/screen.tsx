"use client"

import { useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native'
import { Card } from 'app/components/card'
import { Button } from 'app/components/button'
import { useAuth } from 'app/provider/auth'
import { useRouter } from 'app/navigation'
import { useSafeArea } from 'app/provider/safe-area/use-safe-area'
import { useTheme } from 'app/theme'
import { useDashboardData, type DashboardSummary } from './use-dashboard-data'

type Tone = 'info' | 'success' | 'warning'

type PaymentFilter = {
  id: string
  label: string
  metrics: { title: string; value: string }[]
}

type QuickAction = {
  id: string
  title: string
  detail: string
}

type BookingItem = {
  id: string
  title: string
  detail: string
  action: string
}

const toneColors: Record<Tone, { bg: string; border: string; text: string }> = {
  info: { bg: '#e0e7ff', border: '#c7d2fe', text: '#1d4ed8' },
  success: { bg: '#dcfce7', border: '#bbf7d0', text: '#15803d' },
  warning: { bg: '#fef9c3', border: '#fde68a', text: '#b45309' },
}

export function DashboardScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { token } = useAuth()
  const router = useRouter()
  const {
    data,
    isPending,
    error,
    refetch,
  } = useDashboardData()
  const insets = useSafeArea()

  const now = useMemo(() => new Date(), [])

  const dateText = useMemo(
    () =>
      now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [now]
  )

  const greeting = useMemo(() => {
    const hour = now.getHours()
    const name = data?.trainer.firstName?.trim() || 'trainer'
    if (hour < 12) return `Morning, ${name}`
    if (hour < 17) return `Afternoon, ${name}`
    return `Evening, ${name}`
  }, [now, data?.trainer.firstName])

  const infoBoxes = useMemo(() => {
    const boxes: { id: string; label: string; tone: Tone }[] = []
    if (data?.trainer.trialDaysRemaining && data.trainer.trialDaysRemaining > 0) {
      boxes.push({
        id: 'trial',
        label: `${data.trainer.trialDaysRemaining} days left on trial`,
        tone: 'info',
      })
    }
    if (typeof data?.trainer.smsCredits === 'number') {
      boxes.push({
        id: 'credits',
        label: `${data.trainer.smsCredits} text credits available`,
        tone: data.trainer.smsCredits > 0 ? 'success' : 'warning',
      })
    }
    boxes.push({
      id: 'auth',
      label: token ? 'Signed in' : 'Awaiting sign-in',
      tone: token ? 'success' : 'warning',
    })
    return boxes
  }, [data?.trainer.trialDaysRemaining, data?.trainer.smsCredits, token])

  const quickActions: QuickAction[] = [
    {
      id: 'make-sale',
      title: 'Make sale',
      detail: 'Collect a one-off payment.',
    },
    {
      id: 'make-plan',
      title: 'Make subscription',
      detail: 'Start recurring billing for a client.',
    },
    {
      id: 'add-expense',
      title: 'Add expense',
      detail: 'Track an outgoing cost.',
    },
  ]

  const paymentFilters: PaymentFilter[] = useMemo(() => {
    if (!data) return []
    return [
      {
        id: 'week',
        label: 'Last 7 days',
        metrics: [
          {
            title: 'Projected',
            value: formatCurrency(
              data.payments.last7Days.projected,
              data.payments.currency
            ),
          },
          {
            title: 'Paid',
            value: formatCurrency(data.payments.last7Days.paid, data.payments.currency),
          },
        ],
      },
      {
        id: 'today',
        label: 'Today',
        metrics: [
          {
            title: 'Projected',
            value: formatCurrency(
              data.payments.today.projected,
              data.payments.currency
            ),
          },
          {
            title: 'Paid',
            value: formatCurrency(data.payments.today.paid, data.payments.currency),
          },
        ],
      },
    ]
  }, [data])

  const [paymentFilter, setPaymentFilter] = useState<string>('week')
  const activePaymentFilter =
    paymentFilters.find(filter => filter.id === paymentFilter) ??
    paymentFilters[0]

  const bookingItems: BookingItem[] = useMemo(
    () => [
      {
        id: 'setup',
        title: 'Set up online bookings',
        detail: data
          ? `${data.onlineBookings.bookableCount} bookable sessions online`
          : 'Publish your services and let clients self-book.',
        action: 'Open setup',
      },
      {
        id: 'example',
        title: 'Preview booking page',
        detail: 'See the client experience before you share your link.',
        action: 'Open preview',
      },
      {
        id: 'availability',
        title: 'Availability overview',
        detail: 'Keep your availability updated for clients.',
        action: 'Edit availability',
      },
    ],
    [data]
  )

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: theme.spacing.lg + (insets?.top ?? 0) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.superTitle}>{dateText}</Text>
            <Text style={styles.heading}>{greeting}</Text>
          </View>
          <View style={styles.headerActions}>
            <IconButton label="!" title="Notifications" showBadge />
            <IconButton label="+" title="Quick add" />
          </View>
        </View>

        {error ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={styles.cardTitle}>Unable to load data</Text>
              <Text style={styles.cardHint}>
                {error instanceof Error ? error.message : 'Check your connection and try again.'}
              </Text>
              <Button label="Retry" onPress={() => refetch()} />
            </View>
          </Card>
        ) : null}

        {isPending && !data ? (
          <Card>
            <View style={{ paddingVertical: theme.spacing.md, alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={[styles.cardHint, { marginTop: theme.spacing.sm }]}>Loading dashboard…</Text>
            </View>
          </Card>
        ) : null}

        <View style={styles.infoRow}>
          {infoBoxes.map((info) => (
            <InfoChip key={info.id} label={info.label} tone={info.tone} />
          ))}
        </View>

        {data?.missions?.length ? (
          <Section title="Missions">
            <Card style={styles.missionCard}>
              <View style={styles.missionHeader}>
                <Text style={styles.cardTitle}>Keepon missions</Text>
                <Text style={styles.cardHint}>Complete these to finish setup.</Text>
              </View>
              <View style={styles.missionList}>
                {data.missions.map((mission) => (
                  <View key={mission.id} style={styles.missionItem}>
                    <View style={styles.missionText}>
                      <Text style={styles.missionTitle}>{mission.title}</Text>
                      <Text style={styles.missionDetail}>{mission.description}</Text>
                    </View>
                    <Pressable style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonLabel}>
                        {mission.rewardClaimed
                          ? 'Reward claimed'
                          : mission.completed
                            ? 'Claim reward'
                            : 'View'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Card>
          </Section>
        ) : null}

        <Section title="Quick actions">
          <Card>
            <View style={styles.quickActions}>
              {quickActions.map((action) => (
                <Pressable
                  key={action.id}
                  style={styles.quickAction}
                  accessibilityRole="button"
                  onPress={() => handleQuickAction(action.id, router)}
                >
                  <Text style={styles.quickActionTitle}>{action.title}</Text>
                  <Text style={styles.quickActionDetail}>{action.detail}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        </Section>

        <Section title="Payments">
          {paymentFilters.length > 0 && activePaymentFilter ? (
            <Card style={styles.paymentCard}>
              <View style={styles.filterRow}>
                {paymentFilters.map((filter) => (
                  <Pressable
                    key={filter.id}
                    style={[
                      styles.filterChip,
                      paymentFilter === filter.id && styles.filterChipActive,
                    ]}
                    onPress={() => setPaymentFilter(filter.id)}
                  >
                    <Text
                      style={[
                        styles.filterChipLabel,
                        paymentFilter === filter.id && styles.filterChipLabelActive,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.metricGrid}>
                {activePaymentFilter.metrics.map((metric) => (
                  <View key={metric.title} style={styles.metricTile}>
                    <Text style={styles.metricLabel}>{metric.title}</Text>
                    <Text style={styles.metricValue}>{metric.value}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Overdue payments</Text>
              <Text style={styles.statValue}>
                {data
                  ? `${data.payments.overdue.count} - ${formatCurrency(
                      data.payments.overdue.total,
                      data.payments.currency
                    )}`
                  : '—'}
              </Text>
              <Text style={styles.statHint}>Send reminders and collect online.</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Funds to transfer</Text>
              <Text style={styles.statValue}>
                {data
                  ? `Pending ${formatCurrency(
                      data.funds.pending,
                      data.funds.currency
                    )}`
                  : '—'}
              </Text>
              <Text style={styles.statHint}>
                {data
                  ? `Available ${formatCurrency(
                      data.funds.available,
                      data.funds.currency
                    )}`
                  : 'Totals from Stripe balance'}
              </Text>
            </Card>
          </View>

          <Card style={styles.ctaCard}>
            <View style={styles.ctaContent}>
              <Text style={styles.cardTitle}>Set up payments</Text>
              <Text style={styles.cardHint}>
                Verify your account to accept cards and see payouts here.
              </Text>
            </View>
            <Button label="Get paid" />
          </Card>
        </Section>

        <Section title="Subscriptions & packs">
          <View style={styles.statRow}>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Active subscriptions</Text>
              <Text style={styles.statValue}>
                {data ? data.subscriptions.activePlans : '—'}
              </Text>
              <Text style={styles.statHint}>Includes paused trials.</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Active packs</Text>
              <Text style={styles.statValue}>
                {data ? data.subscriptions.activePacks : '—'}
              </Text>
              <Text style={styles.statHint}>Credit packs with sessions left.</Text>
            </Card>
          </View>
        </Section>

        <Section title="Next appointment">
          <Card>
            {data?.nextAppointment ? (
              <>
                <View style={styles.appointmentRow}>
                  <View style={styles.appointmentBar} />
                  <View style={styles.appointmentText}>
                    <Text style={styles.appointmentTitle}>
                      {formatAppointmentTitle(data.nextAppointment)}
                    </Text>
                    <Text style={styles.appointmentDetail}>
                      {formatAppointmentDetail(data.nextAppointment)}
                    </Text>
                  </View>
                </View>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Open schedule</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.appointmentTitle}>No appointments coming up</Text>
                <Text style={styles.appointmentDetail}>
                  Keep your calendar full by adding sessions or availability.
                </Text>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Add appointment</Text>
                </Pressable>
              </>
            )}
          </Card>
        </Section>

        <Section title="Online bookings">
          <Card>
            <View style={styles.bookingList}>
              {bookingItems.map((item) => (
                <View key={item.id} style={styles.bookingItem}>
                  <View style={styles.bookingText}>
                    <Text style={styles.bookingTitle}>{item.title}</Text>
                    <Text style={styles.bookingDetail}>{item.detail}</Text>
                  </View>
                  <Pressable style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonLabel}>{item.action}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </Card>
        </Section>
      </ScrollView>
    </View>
  )
}

function handleQuickAction(id: string, router: ReturnType<typeof useRouter>) {
  switch (id) {
  case 'make-sale':
    router.push('/sales/make')
    break
  default:
    // Other quick actions will be wired next
    break
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)

const formatAppointmentTitle = (appointment: NonNullable<DashboardSummary['nextAppointment']>) => {
  const start = new Date(appointment.startTime)
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${time} - ${appointment.title}`
}

const formatAppointmentDetail = (appointment: NonNullable<DashboardSummary['nextAppointment']>) => {
  const parts = [
    `${appointment.durationMinutes} min`,
    appointment.location ?? appointment.address ?? 'Location TBD',
  ]
  return parts.filter(Boolean).join(' · ')
}

function InfoChip({ label, tone }: { label: string; tone: Tone }) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const palette = toneColors[tone]

  return (
    <View
      style={[
        styles.infoChip,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.infoChipLabel, { color: palette.text }]}>{label}</Text>
    </View>
  )
}

function IconButton({
  label,
  title,
  showBadge,
}: {
  label: string
  title: string
  showBadge?: boolean
}) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)

  return (
    <Pressable style={styles.iconButton} accessibilityLabel={title}>
      {showBadge ? <View style={styles.iconBadge} /> : null}
      <Text style={styles.iconLabel}>{label}</Text>
    </Pressable>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      backgroundColor: theme.colors.background,
      gap: theme.spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    headerText: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    superTitle: {
      color: theme.colors.secondaryText,
      fontSize: 14,
      letterSpacing: 0.2,
      textTransform: 'uppercase',
      fontWeight: '700',
    },
    heading: {
      fontSize: theme.typography.h1 + 4,
      fontWeight: '800',
      color: theme.colors.text,
    },
    headerActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    iconLabel: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    iconBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 10,
      height: 10,
      borderRadius: 6,
      backgroundColor: '#dc2626',
      borderWidth: 1,
      borderColor: theme.colors.surface,
    },
    infoRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    infoChip: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radii.lg,
      borderWidth: 1,
    },
    infoChipLabel: {
      fontWeight: '700',
      fontSize: 14,
    },
    section: {
      gap: theme.spacing.sm,
    },
    sectionTitle: {
      fontWeight: '800',
      fontSize: 18,
      color: theme.colors.text,
    },
    cardTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
      fontSize: 16,
    },
    cardHint: {
      color: theme.colors.secondaryText,
    },
    missionCard: {
      gap: theme.spacing.sm,
    },
    missionHeader: {
      gap: 4,
    },
    missionList: {
      gap: theme.spacing.sm,
    },
    missionItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    missionText: {
      flex: 1,
      gap: 4,
    },
    missionTitle: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    missionDetail: {
      color: theme.colors.secondaryText,
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonLabel: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    quickActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    quickAction: {
      flexGrow: 1,
      minWidth: 150,
      padding: theme.spacing.sm,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      gap: 4,
    },
    quickActionTitle: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    quickActionDetail: {
      color: theme.colors.secondaryText,
    },
    paymentCard: {
      gap: theme.spacing.md,
    },
    filterRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    filterChip: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
      backgroundColor: theme.colors.text,
      borderColor: theme.colors.text,
    },
    filterChipLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    filterChipLabelActive: {
      color: theme.colors.background,
    },
    metricGrid: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    metricTile: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      gap: 4,
    },
    metricLabel: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
    },
    metricValue: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 18,
    },
    statRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    statCard: {
      flex: 1,
      gap: 4,
      padding: theme.spacing.md,
    },
    statLabel: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    statValue: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 18,
    },
    statHint: {
      color: theme.colors.secondaryText,
    },
    ctaCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    ctaContent: {
      flex: 1,
      gap: 4,
    },
    appointmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    appointmentBar: {
      width: 6,
      height: 48,
      borderRadius: theme.radii.sm,
      backgroundColor: theme.colors.text,
    },
    appointmentText: {
      flex: 1,
      gap: 4,
    },
    appointmentTitle: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    appointmentDetail: {
      color: theme.colors.secondaryText,
    },
    bookingList: {
      gap: theme.spacing.sm,
    },
    bookingItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    bookingText: {
      flex: 1,
      gap: 4,
    },
    bookingTitle: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    bookingDetail: {
      color: theme.colors.secondaryText,
    },
  })
