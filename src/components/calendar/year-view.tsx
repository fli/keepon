'use client'

import { monthsGrid } from './data'

type YearViewProps = {
  date: string
}

export function YearView({ date }: YearViewProps) {
  const year = new Date(`${date}T12:00:00`).getFullYear()

  return (
    <div className="overflow-hidden rounded-2xl border shadow-sm">
      <div className="grid grid-cols-2 gap-6 p-6 md:grid-cols-3 xl:grid-cols-4">
        {monthsGrid.map((month) => (
          <section key={month} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">
              {month} {year}
            </h3>
            <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span>M</span>
              <span>T</span>
              <span>W</span>
              <span>T</span>
              <span>F</span>
              <span>S</span>
              <span>S</span>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-px rounded-lg bg-border text-sm">
              {Array.from({ length: 30 }).map((_, idx) => (
                <div key={idx} className="flex h-9 items-center justify-center bg-card text-muted-foreground">
                  {idx + 1}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
