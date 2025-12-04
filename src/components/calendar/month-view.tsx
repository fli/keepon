'use client'

import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { monthDays, upcomingEvents } from './data'
import type { CalendarEvent } from './types'

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

type MonthViewProps = {
  date: string
  onDateChange: (date: string) => void
}

function getDayNumber(date: string) {
  return Number.parseInt(date.split('-')[2] ?? '0', 10)
}

export function MonthView({ date, onDateChange }: MonthViewProps) {
  const selectedDay = useMemo(() => monthDays.find((day) => day.date === date), [date])

  return (
    <div className="flex flex-col gap-6">
      <div className="hidden gap-2 lg:flex lg:flex-col">
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {weekdayLabels.map((label) => (
            <span key={label} className="py-1">
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 grid-rows-6 gap-px rounded-xl border border-border bg-border">
          {monthDays.map((day) => {
            const dayNumber = getDayNumber(day.date)
            const isSelected = day.date === date
            const isToday = day.isToday
            return (
              <div
                key={day.date}
                className={cn(
                  'relative min-h-[124px] bg-card px-3 py-2 text-xs transition-colors',
                  !day.isCurrentMonth && 'bg-muted/40 text-muted-foreground/70',
                  isSelected && 'shadow-xs ring-2 ring-primary ring-offset-0',
                  isToday && 'outline outline-1 outline-primary/40'
                )}
              >
                <button
                  type="button"
                  onClick={() => onDateChange(day.date)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : isToday
                        ? 'text-primary'
                        : day.isCurrentMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground/80'
                  )}
                >
                  {dayNumber}
                </button>

                {day.events.length > 0 ? (
                  <ol className="mt-2 space-y-1">
                    {day.events.slice(0, 2).map((event) => (
                      <li key={event.id}>
                        <div className="flex items-center gap-2 truncate rounded-md px-2 py-1 hover:bg-accent/40">
                          <span className="truncate text-[13px] font-medium text-foreground">{event.name}</span>
                          <time className="ml-auto text-[11px] text-muted-foreground">{event.time}</time>
                        </div>
                      </li>
                    ))}
                    {day.events.length > 2 ? (
                      <li className="text-[11px] text-muted-foreground">+ {day.events.length - 2} more</li>
                    ) : null}
                  </ol>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile / tablet grid */}
      <div className="isolate grid w-full grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-xl border border-border bg-border lg:hidden">
        {monthDays.map((day) => {
          const dayNumber = getDayNumber(day.date)
          const isSelected = day.date === date
          const isToday = day.isToday
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onDateChange(day.date)}
              className={cn(
                'relative flex h-14 flex-col items-start justify-start bg-card px-2 py-2 text-xs transition-colors',
                !day.isCurrentMonth && 'bg-muted/40 text-muted-foreground/70',
                isSelected && 'bg-primary text-primary-foreground',
                !isSelected && isToday && 'outline outline-1 outline-primary/40',
                'hover:bg-accent/40'
              )}
            >
              <span
                className={cn(
                  'ml-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                  isSelected
                    ? 'bg-white/20 text-white'
                    : isToday
                      ? 'text-primary'
                      : day.isCurrentMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground/80'
                )}
              >
                {dayNumber}
              </span>
              <span className="sr-only">{day.events.length} events</span>
              {day.events.length > 0 ? (
                <span className="-mx-0.5 mt-auto flex flex-wrap-reverse">
                  {day.events.map((event) => (
                    <span
                      key={event.id}
                      className={cn(
                        'mx-0.5 mb-1 h-1.5 w-1.5 rounded-full',
                        isSelected ? 'bg-white/80' : 'bg-muted-foreground/70'
                      )}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Selected day agenda (mobile-first) */}
      <SelectedAgenda selectedDayEvents={selectedDay?.events ?? []} selectedDate={date} />

      {/* Desktop upcoming list */}
      <div className="hidden lg:block">
        <div className="overflow-hidden rounded-2xl border shadow-sm">
          <div className="flex flex-row items-center justify-between border-b px-6 py-4">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Upcoming highlights</p>
              <h3 className="text-lg leading-tight font-semibold">
                {shortDateFormatter.format(new Date(`${date}T12:00:00`))}
              </h3>
            </div>
            <Button size="sm" variant="secondary">
              Add event
            </Button>
          </div>
          <div className="p-0">
            <ol className="divide-y">
              {upcomingEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <li className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="space-y-1">
        <p className="text-sm leading-tight font-semibold">{event.name}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <time dateTime={event.datetime}>{event.time}</time>
        </p>
      </div>
      <Button size="sm" variant="outline">
        Edit
      </Button>
    </li>
  )
}

function SelectedAgenda({
  selectedDayEvents,
  selectedDate,
}: {
  selectedDayEvents: CalendarEvent[]
  selectedDate: string
}) {
  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between rounded-t-xl border border-b-0 bg-card px-4 py-3 shadow-sm">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Selected day</p>
          <p className="text-base leading-tight font-semibold">
            {shortDateFormatter.format(new Date(`${selectedDate}T12:00:00`))}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{selectedDayEvents.length || 'No'} events</span>
      </div>
      <ol className="divide-y overflow-hidden rounded-b-xl border bg-card shadow-sm">
        {selectedDayEvents.length ? (
          selectedDayEvents.map((event) => <EventRowMobile key={event.id} event={event} />)
        ) : (
          <li className="px-4 py-4 text-sm text-muted-foreground">No events for this day yet.</li>
        )}
      </ol>
    </div>
  )
}

function EventRowMobile({ event }: { event: CalendarEvent }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="space-y-1">
        <p className="text-sm leading-tight font-semibold">{event.name}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">{event.time}</p>
      </div>
      <Button size="sm" variant="outline" className="px-3">
        Edit
      </Button>
    </li>
  )
}
