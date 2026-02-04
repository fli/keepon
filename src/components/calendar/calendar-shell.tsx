'use client'

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { CalendarView } from './types'
import { DayView } from './day-view'
import { MonthView } from './month-view'
import { WeekView } from './week-view'
import { YearView } from './year-view'

const fallbackDate = '2022-01-22'

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, delta: number) {
  const date = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return dateStr
  }
  date.setDate(date.getDate() + delta)
  return date.toISOString().slice(0, 10)
}

function addMonths(dateStr: string, delta: number) {
  const date = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return dateStr
  }
  date.setMonth(date.getMonth() + delta)
  return date.toISOString().slice(0, 10)
}

function addYears(dateStr: string, delta: number) {
  const date = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return dateStr
  }
  date.setFullYear(date.getFullYear() + delta)
  return date.toISOString().slice(0, 10)
}

export function CalendarShell() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const viewParam = (searchParams.get('view') ?? 'month').toLowerCase()
  const view: CalendarView = viewParam === 'week' || viewParam === 'day' || viewParam === 'year' ? viewParam : 'month'

  const selectedDateParam = searchParams.get('date')
  const date = useMemo(() => {
    if (!selectedDateParam) {
      return fallbackDate
    }
    const parsed = new Date(`${selectedDateParam}T12:00:00`)
    return Number.isNaN(parsed.getTime()) ? fallbackDate : selectedDateParam
  }, [selectedDateParam])

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set(key, value)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  const setDate = (nextDate: string) => setParam('date', nextDate)
  const setView = (nextView: CalendarView) => setParam('view', nextView)

  const handlePrev = () => {
    if (view === 'day') {
      setDate(addDays(date, -1))
      return
    }
    if (view === 'week') {
      setDate(addDays(date, -7))
      return
    }
    if (view === 'year') {
      setDate(addYears(date, -1))
      return
    }
    setDate(addMonths(date, -1))
  }

  const handleNext = () => {
    if (view === 'day') {
      setDate(addDays(date, 1))
      return
    }
    if (view === 'week') {
      setDate(addDays(date, 7))
      return
    }
    if (view === 'year') {
      setDate(addYears(date, 1))
      return
    }
    setDate(addMonths(date, 1))
  }

  const titleLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00`)
    if (view === 'year') {
      return d.getFullYear().toString()
    }
    if (view === 'day') {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    }
    return monthFormatter.format(d)
  }, [date, view])

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-6 py-4 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{view} view</p>
          <h2 className="text-2xl leading-tight font-semibold">{titleLabel}</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border bg-background px-1 shadow-xs">
            <Button aria-label="Previous" size="icon" variant="ghost" className="h-9 w-9" onClick={handlePrev}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hidden px-3 font-semibold md:inline-flex"
              onClick={() => setDate(todayIso())}
            >
              Today
            </Button>
            <Button aria-label="Next" size="icon" variant="ghost" className="h-9 w-9" onClick={handleNext}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="hidden items-center gap-1 rounded-md border bg-background px-1 md:flex">
            {(['day', 'week', 'month', 'year'] as const).map((option) => (
              <Button
                key={option}
                variant={view === option ? 'secondary' : 'ghost'}
                size="sm"
                className={cn('capitalize', view === option && 'font-semibold')}
                onClick={() => setView(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="md:hidden">
            <MoreHorizontal className="size-4" aria-hidden />
            <span className="sr-only">Open calendar actions</span>
          </Button>
        </div>
      </header>

      {view === 'day' && <DayView date={date} />}
      {view === 'week' && <WeekView date={date} onDateChange={setDate} />}
      {view === 'year' && <YearView date={date} />}
      {view === 'month' && <MonthView date={date} onDateChange={setDate} />}
    </section>
  )
}
