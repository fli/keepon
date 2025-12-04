'use client'

import { Clock3 } from 'lucide-react'

import { cn } from '@/lib/utils'

import { dayEvents } from './data'

type DayViewProps = {
  date: string
}

export function DayView({ date }: DayViewProps) {
  return (
    <div className="overflow-hidden rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/60 px-6 py-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
            })}
          </p>
          <p className="text-lg leading-tight font-semibold">
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{dayEvents.length} events</span>
      </div>

      <ol className="divide-y">
        {dayEvents.map((event, index) => (
          <li
            key={event.id}
            className={cn('flex flex-col gap-1 px-6 py-4', index % 2 === 0 ? 'bg-card' : 'bg-background')}
          >
            <p className="text-sm leading-tight font-semibold">{event.name}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-4" aria-hidden />
              <time dateTime={event.datetime}>{event.time}</time>
              {event.location ? `· ${event.location}` : null}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
