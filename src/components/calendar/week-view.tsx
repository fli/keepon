'use client'
import { Clock3 } from 'lucide-react'

import { cn } from '@/lib/utils'

import { weekColumns } from './data'

type WeekViewProps = {
  date: string
  onDateChange: (date: string) => void
}

export function WeekView({ date: selectedDate, onDateChange }: WeekViewProps) {
  return (
    <div className="overflow-hidden rounded-2xl border shadow-sm">
      <div className="grid grid-cols-7 border-b bg-muted/60 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {weekColumns.map((day) => {
          const isSelected = day.date === selectedDate
          return (
            <button
              key={day.date}
              className={cn(
                'flex flex-col items-center gap-1 px-2 py-3 text-foreground transition-colors hover:bg-accent/50',
                isSelected && 'bg-primary text-primary-foreground'
              )}
              onClick={() => onDateChange(day.date)}
            >
              <span className="text-xs">{day.label}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-sm font-semibold">
                {new Date(`${day.date}T12:00:00`).getDate()}
              </span>
            </button>
          )
        })}
      </div>

      <div className="max-h-[480px] overflow-auto">
        <div className="grid min-w-[720px] grid-cols-7 divide-x">
          {weekColumns.map((day) => (
            <div key={day.date} className="min-h-[360px] p-4">
              <div className="flex items-center justify-between pb-2">
                <span className="text-sm font-semibold">{day.label}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className="space-y-3">
                {day.events.length ? (
                  day.events.map((event) => (
                    <div key={event.id} className="rounded-xl border bg-card px-3 py-2 text-sm shadow-xs">
                      <p className="font-semibold leading-tight">{event.name}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="size-4" aria-hidden />
                        {event.time}
                        {event.location ? ` · ${event.location}` : null}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">No events</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
