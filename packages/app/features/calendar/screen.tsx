"use client"

import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { getLocalTimeZone, parseZonedDateTime } from '@internationalized/date'

import { Card } from 'app/components/card'
import { useAuth } from 'app/provider/auth'
import { useTheme } from 'app/theme'
import {
  fetchClients,
  fetchSessionSeries,
  type Client,
  type SessionSeries,
} from 'app/services/api'

const localTimeZone = getLocalTimeZone()

type CalendarEvent = {
  kind: 'event'
  id: string
  sessionSeriesId: string
  name: string
  type: 'event' | 'single' | 'group'
  start: Date
  end: Date
  timezone: string
  clients: string[]
  location?: string | null
}

type FreeSlot = {
  kind: 'free'
  start: Date
  end: Date
}

type TimelineItem = CalendarEvent | FreeSlot

export function CalendarScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const auth = useAuth()
  const hasSession = Boolean(auth.session)

  const {
    data: clients = [],
    isPending: loadingClients,
    error: clientsError,
    refetch: refetchClients,
  } = useQuery<Client[], Error>({
    queryKey: ['clients', auth.session?.trainerId],
    enabled: hasSession,
    queryFn: async () => {
      if (!auth.session) return []
      return fetchClients(auth.session)
    },
  })

  const {
    data: series = [],
    isPending: loadingSeries,
    error: seriesError,
    refetch: refetchSeries,
  } = useQuery<SessionSeries[], Error>({
    queryKey: ['session-series', auth.session?.trainerId],
    enabled: hasSession,
    queryFn: async () => {
      if (!auth.session) return []
      return fetchSessionSeries(auth.session)
    },
  })

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()))
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')

  const firstDayOfWeek = useMemo<number>(() => getFirstDayOfWeek(), [])

  const events = useMemo(() => buildEvents(series, clients), [series, clients])

  const datesWithEvents = useMemo(() => buildDateCounts(events), [events])

  const dayStart = useMemo(() => startOfDay(selectedDate), [selectedDate])
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart])

  const eventsForDay = useMemo(
    () => events.filter((event) => event.start < dayEnd && event.end > dayStart),
    [events, dayEnd, dayStart]
  )

  const timeline = useMemo(
    () => buildTimeline(eventsForDay, dayStart, dayEnd),
    [eventsForDay, dayStart, dayEnd]
  )

  const calendarDays = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(selectedDate, firstDayOfWeek)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }

    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    const gridStart = startOfWeek(first, firstDayOfWeek)
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [firstDayOfWeek, selectedDate, viewMode])

  const todayKey = useMemo(() => dateKey(new Date()), [])
  const selectedKey = dateKey(selectedDate)

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
    []
  )

  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
    []
  )

  const monthLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [selectedDate]
  )

  const relativeLabel = useMemo(() => labelForDate(selectedDate), [selectedDate])

  const isLoading = loadingClients || loadingSeries

  const handleSelectDay = useCallback((day: Date) => {
    setSelectedDate(startOfDay(day))
  }, [])

  const handleChangePage = useCallback(
    (direction: -1 | 1) => {
      setSelectedDate((current) =>
        viewMode === 'week' ? addDays(current, 7 * direction) : addMonths(current, direction)
      )
    },
    [viewMode]
  )

  const handleAdd = useCallback(
    (slot?: FreeSlot) => {
      const message = slot
        ? `Add an appointment between ${formatTime(slot.start, timeFormatter)} and ${formatTime(slot.end, timeFormatter)}.`
        : 'Add a new appointment or event.'
      if (typeof globalThis.alert === 'function') {
        globalThis.alert(`Coming soon\n\n${message}`)
      } else {
        console.info('Coming soon:', message)
      }
    },
    [timeFormatter]
  )

  const handleRetry = useCallback(() => {
    void refetchClients()
    void refetchSeries()
  }, [refetchClients, refetchSeries])

  if (!auth.ready) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={theme.colors.secondaryText} />
      </View>
    )
  }

  if (!hasSession) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.heading}>Calendar</Text>
        <Text style={styles.subtitle}>Sign in to view your schedule.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.heading}>Calendar</Text>
          <Text style={styles.subtitle}>{relativeLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={[styles.pillButton, viewMode === 'week' ? styles.pillActive : null]}
            onPress={() => setViewMode('week')}
          >
            <Text style={viewMode === 'week' ? styles.pillTextActive : styles.pillText}>Week</Text>
          </Pressable>
          <Pressable
            style={[styles.pillButton, viewMode === 'month' ? styles.pillActive : null]}
            onPress={() => setViewMode('month')}
          >
            <Text style={viewMode === 'month' ? styles.pillTextActive : styles.pillText}>Month</Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={() => handleAdd()}>
            <Text style={styles.addButtonLabel}>＋</Text>
          </Pressable>
        </View>
      </View>

      <Card style={styles.calendarCard} padded={false}>
        <View style={styles.calendarHeader}>
          <Pressable style={styles.navButton} onPress={() => handleChangePage(-1)}>
            <Text style={styles.navLabel}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Pressable style={styles.navButton} onPress={() => handleChangePage(1)}>
            <Text style={styles.navLabel}>›</Text>
          </Pressable>
        </View>

        <View style={styles.weekdayRow}>
          {Array.from({ length: 7 }).map((_, index) => {
            const sample = addDays(startOfWeek(new Date(), firstDayOfWeek), index)
            return (
              <Text key={index} style={styles.weekdayLabel}>
                {weekdayFormatter.format(sample)}
              </Text>
            )
          })}
        </View>

        <View style={styles.grid}>
          {calendarDays.map((day) => {
            const key = dateKey(day)
            const inMonth = day.getMonth() === selectedDate.getMonth()
            const isSelected = key === selectedKey
            const isToday = key === todayKey
            const dots = datesWithEvents.get(key) ?? 0

            return (
              <Pressable
                key={key}
                onPress={() => handleSelectDay(day)}
                style={[styles.dayCell, !inMonth && styles.outsideMonth]}
              >
                <View
                  style={[
                    styles.dayNumber,
                    isSelected && styles.daySelected,
                    isToday && !isSelected && styles.dayToday,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumberText,
                      !inMonth && styles.dayMuted,
                      isSelected && styles.daySelectedText,
                      isToday && !isSelected && styles.dayTodayText,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.dot,
                    dots > 0 ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              </Pressable>
            )
          })}
        </View>

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={theme.colors.secondaryText} />
          </View>
        )}
      </Card>

      {clientsError || seriesError ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorTitle}>Unable to load your schedule.</Text>
          <Text style={styles.errorCopy}>
            {(clientsError || seriesError)?.message || 'Something went wrong fetching calendar data.'}
          </Text>
          <Pressable style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={styles.timelineHeader}>
        <Text style={styles.timelineTitle}>{formatLongDate(selectedDate)}</Text>
        <Text style={styles.timelineSubtitle}>
          {eventsForDay.length === 0
            ? 'No appointments yet'
            : `${eventsForDay.length} scheduled`}
        </Text>
      </View>

      {timeline.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Today is a free day</Text>
          <Text style={styles.emptyCopy}>Tap the plus button to add a session or event.</Text>
        </Card>
      ) : (
        <View>
          {timeline.map((item, index) => {
            const key =
              item.kind === 'event'
                ? `${item.id}-${item.start.toISOString()}`
                : `free-${item.start.toISOString()}-${index}`
            const spacingStyle = index === 0 ? null : { marginTop: theme.spacing.sm }

            if (item.kind === 'event') {
              return (
                <View key={key} style={spacingStyle}>
                  <Card style={styles.eventCard}>
                    <View style={styles.eventHeader}>
                      <Text style={styles.eventName}>{item.name}</Text>
                      <Text style={styles.eventType}>{labelForType(item.type)}</Text>
                    </View>
                    <Text style={styles.eventTime}>
                      {formatTime(item.start, timeFormatter)} {' – '}
                      {formatTime(item.end, timeFormatter)}
                    </Text>
                    {item.clients.length > 0 && (
                      <Text style={styles.eventClients}>{item.clients.join(', ')}</Text>
                    )}
                    {item.location ? <Text style={styles.eventLocation}>{item.location}</Text> : null}
                  </Card>
                </View>
              )
            }

            const duration = minutesBetween(item.start, item.end)
            return (
              <View key={key} style={spacingStyle}>
                <Pressable onPress={() => handleAdd(item)}>
                  <Card style={[styles.eventCard, styles.freeCard]}>
                    <Text style={styles.freeLabel}>Free time</Text>
                    <Text style={styles.freeDuration}>{formatDuration(duration)}</Text>
                  </Card>
                </Pressable>
              </View>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}

function buildEvents(series: SessionSeries[], clients: Client[]): CalendarEvent[] {
  const clientNames = new Map<string, string>()
  for (const client of clients) {
    const name = `${client.firstName} ${client.lastName ?? ''}`.trim()
    clientNames.set(client.id, name)
  }

  const fallbackTz = localTimeZone
  const events: CalendarEvent[] = []

  for (const item of series) {
    const sessions = item.sessions ?? []
    for (const session of sessions) {
      const tz = session.timezone || item.timezone || fallbackTz
      const zonedStart = parseSessionDate(session.date, tz) ?? parseSessionDate(session.startTime, tz)
      if (!zonedStart) continue

      const minutes = durationMinutes(session.length ?? item.sessionLength ?? 0)
      const zonedEnd = zonedStart.add({ minutes })

      const rawType = session.type ?? item.sessionType
      const eventType: CalendarEvent['type'] =
        rawType === 'group' || rawType === 'event' || rawType === 'single' ? rawType : 'single'

      events.push({
        kind: 'event',
        id: session.id,
        sessionSeriesId: item.id,
        name: session.name ?? item.sessionName ?? 'Appointment',
        type: eventType,
        start: zonedStart.toDate(),
        end: zonedEnd.toDate(),
        timezone: tz,
        clients: (session.clientSessions ?? [])
          .map((cs) => clientNames.get(cs.clientId))
          .filter(Boolean) as string[],
        location: session.location ?? item.location ?? null,
      })
    }
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime())
}

function buildDateCounts(events: CalendarEvent[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const event of events) {
    let cursor = startOfDay(event.start)
    const endDay = startOfDay(event.end)
    while (cursor.getTime() <= endDay.getTime()) {
      const key = dateKey(cursor)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      cursor = addDays(cursor, 1)
    }
  }

  return counts
}

function buildTimeline(events: CalendarEvent[], dayStart: Date, dayEnd: Date): TimelineItem[] {
  if (events.length === 0) return []

  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime())
  const items: TimelineItem[] = []
  let cursor = dayStart

  for (const event of sorted) {
    if (event.start.getTime() > cursor.getTime()) {
      items.push({ kind: 'free', start: cursor, end: event.start })
    }
    items.push(event)
    const later = event.end.getTime() > cursor.getTime() ? event.end : cursor
    cursor = new Date(later)
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    items.push({ kind: 'free', start: cursor, end: dayEnd })
  }

  return items
}

function durationMinutes(length: number): number {
  const minutes = Math.round(Number(length) * 60)
  if (!Number.isFinite(minutes) || minutes <= 0) return 60
  return minutes
}

function parseSessionDate(value: string | Date | null | undefined, timezone: string) {
  if (!value) return null
  const normalized = value instanceof Date ? value.toISOString() : String(value)
  const withTime = normalized.includes('T') ? normalized : normalized.replace(' ', 'T')

  try {
    return parseZonedDateTime(`${withTime}[${timezone || localTimeZone}]`)
  } catch (error) {
    console.warn('calendar: unable to parse session date', value, timezone, error)
    return null
  }
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfWeek(date: Date, firstDay: number) {
  const start = startOfDay(date)
  const day = start.getDay()
  const diff = (day - firstDay + 7) % 7
  start.setDate(start.getDate() - diff)
  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

function formatTime(date: Date, formatter: Intl.DateTimeFormat) {
  return formatter.format(date)
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function minutesBetween(start: Date, end: Date) {
  const diff = end.getTime() - start.getTime()
  return Math.max(0, Math.round(diff / 60000))
}

function labelForDate(date: Date) {
  const todayStart = startOfDay(new Date())
  const dayStart = startOfDay(date)
  const diffDays = Math.round((dayStart.getTime() - todayStart.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  return formatLongDate(date)
}

function labelForType(type: CalendarEvent['type']) {
  if (type === 'group') return 'Group'
  if (type === 'event') return 'Event'
  return '1:1'
}

function getFirstDayOfWeek(): number {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? 'en-US'
  const LocaleCtor = (Intl as typeof Intl & { Locale?: typeof Intl.Locale }).Locale
  if (typeof LocaleCtor === 'function') {
    const info = (
      (new LocaleCtor(locale) as { weekInfo?: { firstDay?: number } }).weekInfo ?? {}
    ) as {
      firstDay?: number
    }
    const day = typeof info.firstDay === 'number' ? info.firstDay : 0
    return day === 7 ? 0 : day
  }
  return 0
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    heading: {
      fontSize: theme.typography.h1,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
      marginTop: 4,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    pillButton: {
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.surface,
    },
    pillActive: {
      backgroundColor: theme.colors.text,
      borderColor: theme.colors.text,
    },
    pillText: {
      color: theme.colors.text,
      fontWeight: '600',
    },
    pillTextActive: {
      color: theme.colors.surface,
      fontWeight: '700',
    },
    addButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.text,
    },
    addButtonLabel: {
      color: theme.colors.surface,
      fontSize: 20,
      fontWeight: '800',
      lineHeight: 20,
    },
    calendarCard: {
      position: 'relative',
      padding: theme.spacing.md,
    },
    calendarHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.sm,
    },
    navButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    navLabel: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
    },
    monthLabel: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 16,
    },
    weekdayRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.xs,
    },
    weekdayLabel: {
      flex: 1,
      textAlign: 'center',
      color: theme.colors.secondaryText,
      fontWeight: '600',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    dayCell: {
      width: `${100 / 7}%`,
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      gap: 6,
    },
    outsideMonth: {
      opacity: 0.4,
    },
    dayNumber: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayNumberText: {
      color: theme.colors.text,
      fontWeight: '600',
    },
    dayMuted: {
      color: theme.colors.secondaryText,
    },
    daySelected: {
      backgroundColor: theme.colors.text,
    },
    daySelectedText: {
      color: theme.colors.surface,
      fontWeight: '800',
    },
    dayToday: {
      borderWidth: 1,
      borderColor: theme.colors.text,
    },
    dayTodayText: {
      fontWeight: '800',
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    dotActive: {
      backgroundColor: theme.colors.text,
    },
    dotInactive: {
      backgroundColor: theme.colors.border,
    },
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.04)',
      borderRadius: theme.radii.md,
    },
    errorCard: {
      gap: theme.spacing.sm,
    },
    errorTitle: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 16,
    },
    errorCopy: {
      color: theme.colors.secondaryText,
    },
    retryButton: {
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.text,
      borderRadius: theme.radii.sm,
    },
    retryLabel: {
      color: theme.colors.surface,
      fontWeight: '700',
    },
    timelineHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    timelineTitle: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 18,
    },
    timelineSubtitle: {
      color: theme.colors.secondaryText,
    },
    emptyCard: {
      gap: theme.spacing.xs,
    },
    emptyTitle: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 16,
    },
    emptyCopy: {
      color: theme.colors.secondaryText,
    },
    eventCard: {
      padding: theme.spacing.md,
    },
    eventHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    eventName: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 16,
      flex: 1,
    },
    eventType: {
      color: theme.colors.secondaryText,
      fontWeight: '600',
      marginLeft: theme.spacing.sm,
    },
    eventTime: {
      color: theme.colors.text,
      marginBottom: 4,
    },
    eventClients: {
      color: theme.colors.secondaryText,
      marginBottom: 2,
    },
    eventLocation: {
      color: theme.colors.secondaryText,
    },
    freeCard: {
      borderStyle: 'dashed',
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    freeLabel: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    freeDuration: {
      color: theme.colors.secondaryText,
      marginTop: 4,
    },
  })

export default CalendarScreen
