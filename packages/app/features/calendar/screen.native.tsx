'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { getLocalTimeZone, parseZonedDateTime } from '@internationalized/date'

import { Card } from 'app/components/card'
import { LegendList, type LegendSection } from 'app/components/legend-list'
import { useAuth } from 'app/provider/auth'
import { useTheme } from 'app/theme'
import { fetchClients, fetchSessionSeries, type Client, type SessionSeries } from 'app/services/api'

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

const localTimeZone = getLocalTimeZone()
const ONE_DAY_MS = 86_400_000

export function CalendarScreen() {
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const auth = useAuth()
  const hasSession = Boolean(auth.session)

  const {
    data: clients = [],
    isPending: loadingClients,
    isFetching: fetchingClients,
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
    isFetching: fetchingSeries,
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

  const isLoading = loadingClients || loadingSeries
  const isRefreshing = fetchingClients || fetchingSeries
  const error = clientsError || seriesError

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()))
  const firstDayOfWeek = useMemo<number>(() => getFirstDayOfWeek(), [])
  const [visibleWeekStart, setVisibleWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), firstDayOfWeek)
  )

  const events = useMemo(() => buildEvents(series, clients), [series, clients])
  const datesWithEvents = useMemo(() => buildDateCounts(events), [events])

  const dayStart = useMemo(() => startOfDay(selectedDate), [selectedDate])
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart])

  const eventsForDay = useMemo(
    () => events.filter(event => event.start < dayEnd && event.end > dayStart),
    [events, dayEnd, dayStart]
  )

  const timeline = useMemo(
    () => buildTimeline(eventsForDay, dayStart, dayEnd),
    [eventsForDay, dayStart, dayEnd]
  )

  const todayKey = useMemo(() => dateKey(new Date()), [])
  const selectedKey = useMemo(() => dateKey(selectedDate), [selectedDate])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(visibleWeekStart, index)),
    [visibleWeekStart]
  )

  const selectedRelativeIndex = useMemo(() => {
    const diffDays = Math.round(
      (startOfDay(selectedDate).getTime() - visibleWeekStart.getTime()) / ONE_DAY_MS
    )
    return Math.min(6, Math.max(0, diffDays))
  }, [selectedDate, visibleWeekStart])

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
    []
  )

  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
    []
  )

  const headerLabel = useMemo(() => labelForDate(selectedDate), [selectedDate])
  const weekLabel = useMemo(() => formatWeekRange(visibleWeekStart), [visibleWeekStart])

  const handleSelectDay = useCallback(
    (day: Date) => {
      const normalized = startOfDay(day)
      setSelectedDate(normalized)
      const nextWeekStart = startOfWeek(normalized, firstDayOfWeek)
      if (nextWeekStart.getTime() !== visibleWeekStart.getTime()) {
        setVisibleWeekStart(nextWeekStart)
      }
    },
    [firstDayOfWeek, visibleWeekStart]
  )

  const handleChangeWeek = useCallback(
    (direction: -1 | 1) => {
      const nextWeekStart = addDays(visibleWeekStart, 7 * direction)
      setVisibleWeekStart(nextWeekStart)
      setSelectedDate(addDays(nextWeekStart, selectedRelativeIndex))
    },
    [selectedRelativeIndex, visibleWeekStart]
  )

  const handleRefresh = useCallback(() => {
    void Promise.all([refetchClients(), refetchSeries()])
  }, [refetchClients, refetchSeries])

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

  const sections = useMemo<LegendSection<TimelineItem>[]>(
    () => [
      {
        title: formatLongDate(selectedDate),
        data: timeline,
      },
    ],
    [selectedDate, timeline]
  )

  const renderAgendaItem = useCallback(
    ({ item }: { item: TimelineItem; index: number; section: LegendSection<TimelineItem> }) => {
      if (item.kind === 'event') {
        return (
          <Card style={styles.eventCard}>
            <View style={styles.row}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeText}>{formatTime(item.start, timeFormatter)}</Text>
                <Text style={[styles.timeText, styles.timeSub]}>to {formatTime(item.end, timeFormatter)}</Text>
              </View>
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.eventType}>{labelForType(item.type)}</Text>
                {item.clients.length ? (
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {item.clients.join(', ')}
                  </Text>
                ) : null}
                {item.location ? (
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {item.location}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        )
      }

      const duration = minutesBetween(item.start, item.end)
      return (
        <Pressable onPress={() => handleAdd(item)}>
          <Card style={[styles.eventCard, styles.freeCard]}>
            <View style={styles.row}>
              <View style={styles.timeColumn}>
                <Text style={styles.timeText}>{formatTime(item.start, timeFormatter)}</Text>
                <Text style={[styles.timeText, styles.timeSub]}>to {formatTime(item.end, timeFormatter)}</Text>
              </View>
              <View style={styles.eventBody}>
                <Text style={styles.freeTitle}>Free time</Text>
                <Text style={styles.freeMeta}>{formatDuration(duration)}</Text>
              </View>
            </View>
          </Card>
        </Pressable>
      )
    },
    [handleAdd, styles, timeFormatter]
  )

  const showEmpty = !isLoading && timeline.length === 0 && !error

  if (!auth.ready) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={theme.colors.secondaryText} />
        <Text style={[styles.subtitle, { marginTop: theme.spacing.sm }]}>Loading account…</Text>
      </View>
    )
  }

  if (!hasSession) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.heading}>Calendar</Text>
        <Text style={[styles.subtitle, { marginTop: theme.spacing.xs }]}>Sign in to view your schedule.</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <LegendList
        sections={sections}
        keyExtractor={(item, index) =>
          item.kind === 'event'
            ? `${item.id}-${item.start.toISOString()}`
            : `free-${item.start.toISOString()}-${index}`
        }
        renderItem={renderAgendaItem}
        stickySectionHeadersEnabled
        estimatedItemSize={112}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.titleRow}>
              <View>
                <Text style={styles.heading}>Calendar</Text>
                <Text style={styles.subtitle}>{headerLabel}</Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable style={styles.todayButton} onPress={() => handleSelectDay(new Date())}>
                  <Text style={styles.todayLabel}>Today</Text>
                </Pressable>
                {isLoading ? <ActivityIndicator size="small" color={theme.colors.secondaryText} /> : null}
              </View>
            </View>

            {error ? (
              <Card style={styles.errorCard}>
                <Text style={styles.errorTitle}>Unable to load your schedule.</Text>
                <Text style={styles.errorCopy}>{error.message}</Text>
                <Pressable style={styles.retryButton} onPress={handleRefresh}>
                  <Text style={styles.retryLabel}>Retry</Text>
                </Pressable>
              </Card>
            ) : null}

            <Card style={styles.weekCard} padded={false}>
              <View style={styles.weekHeader}>
                <Pressable style={styles.navButton} onPress={() => handleChangeWeek(-1)}>
                  <Text style={styles.navLabel}>‹</Text>
                </Pressable>
                <Text style={styles.weekLabel}>{weekLabel}</Text>
                <Pressable style={styles.navButton} onPress={() => handleChangeWeek(1)}>
                  <Text style={styles.navLabel}>›</Text>
                </Pressable>
              </View>

              <View style={styles.weekRow}>
                {weekDays.map((day) => {
                  const key = dateKey(day)
                  const isSelected = key === selectedKey
                  const isToday = key === todayKey
                  const eventCount = datesWithEvents.get(key) ?? 0

                  return (
                    <Pressable
                      key={key}
                      style={[styles.dayCell, isSelected && styles.daySelected, isToday && !isSelected && styles.dayToday]}
                      onPress={() => handleSelectDay(day)}
                      hitSlop={8}
                    >
                      <Text style={[styles.dayLabel, isSelected && styles.dayLabelActive]}>
                        {weekdayFormatter.format(day)}
                      </Text>
                      <View style={styles.dayNumberBubble}>
                        <Text style={[styles.dayNumber, isSelected && styles.dayNumberActive]}>
                          {day.getDate()}
                        </Text>
                      </View>
                      <View style={[styles.dot, eventCount > 0 ? styles.dotActive : styles.dotInactive]}>
                        {eventCount > 1 ? (
                          <Text style={styles.dotText}>{Math.min(eventCount, 9)}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </Card>
          </View>
        }
        ListFooterComponent={
          showEmpty ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing scheduled</Text>
              <Text style={styles.emptyCopy}>
                Add a session for {formatLongDate(selectedDate)} to populate your agenda.
              </Text>
              <Pressable style={styles.retryButton} onPress={() => handleAdd()}>
                <Text style={styles.retryLabel}>Add event</Text>
              </Pressable>
            </Card>
          ) : null
        }
      />
    </View>
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
          .map(cs => clientNames.get(cs.clientId))
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

function formatWeekRange(start: Date) {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const startLabel = `${monthFormatter.format(start)} ${start.getDate()}`
  const endLabel = `${sameMonth ? '' : `${monthFormatter.format(end)} `}${end.getDate()}`
  return `${startLabel} – ${endLabel}`
}

function minutesBetween(start: Date, end: Date) {
  const diff = end.getTime() - start.getTime()
  return Math.max(0, Math.round(diff / 60000))
}

function labelForDate(date: Date) {
  const todayStart = startOfDay(new Date())
  const dayStart = startOfDay(date)
  const diffDays = Math.round((dayStart.getTime() - todayStart.getTime()) / ONE_DAY_MS)
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
    ) as { firstDay?: number }
    const day = typeof info.firstDay === 'number' ? info.firstDay : 0
    return day === 7 ? 0 : day
  }
  return 0
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    listContent: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
      gap: theme.spacing.md,
    },
    headerBlock: {
      gap: theme.spacing.md,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    heading: {
      fontSize: theme.typography.h1,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    todayButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    todayLabel: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    weekCard: {
      padding: theme.spacing.md,
    },
    weekHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    weekLabel: {
      fontWeight: '700',
      color: theme.colors.text,
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
      lineHeight: 20,
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 6,
    },
    dayCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: 'transparent',
      gap: 6,
    },
    daySelected: {
      borderColor: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
    dayToday: {
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.secondarySystemBackground ?? theme.colors.surface,
    },
    dayLabel: {
      fontWeight: '600',
      color: theme.colors.secondaryText,
      fontSize: 12,
    },
    dayLabelActive: {
      color: theme.colors.text,
    },
    dayNumberBubble: {
      minWidth: 32,
      minHeight: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.secondarySystemBackground ?? theme.colors.surface,
    },
    dayNumber: {
      fontWeight: '700',
      color: theme.colors.text,
    },
    dayNumberActive: {
      color: theme.colors.text,
    },
    dot: {
      minWidth: 14,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    dotActive: {
      backgroundColor: theme.colors.text,
      borderColor: theme.colors.text,
    },
    dotInactive: {
      backgroundColor: theme.colors.surface,
    },
    dotText: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.colors.surface,
    },
    eventCard: {
      padding: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    timeColumn: {
      width: 86,
    },
    timeText: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    timeSub: {
      color: theme.colors.secondaryText,
      marginTop: 4,
      fontWeight: '600',
    },
    eventBody: {
      flex: 1,
      gap: 4,
    },
    eventTitle: {
      fontWeight: '800',
      color: theme.colors.text,
      fontSize: 16,
    },
    eventType: {
      color: theme.colors.secondaryText,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    eventMeta: {
      color: theme.colors.secondaryText,
    },
    freeCard: {
      borderStyle: 'dashed',
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    freeTitle: {
      fontWeight: '700',
      color: theme.colors.text,
      fontSize: 16,
    },
    freeMeta: {
      color: theme.colors.secondaryText,
    },
    errorCard: {
      gap: theme.spacing.xs,
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
      marginTop: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radii.sm,
      backgroundColor: theme.colors.text,
      alignSelf: 'flex-start',
    },
    retryLabel: {
      color: theme.colors.surface,
      fontWeight: '700',
    },
    emptyCard: {
      marginTop: theme.spacing.md,
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
  })
