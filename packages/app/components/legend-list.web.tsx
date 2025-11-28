import React from 'react'

export type LegendSection<T> = { title: string; data: T[] }

export type LegendListProps<T> = {
  sections: LegendSection<T>[]
  renderItem: (info: { item: T; index: number; section: LegendSection<T> }) => React.ReactNode
  keyExtractor?: (item: T, index: number) => string
  ListHeaderComponent?: React.ReactNode
}

export function LegendList<T>({ sections, renderItem, keyExtractor, ListHeaderComponent }: LegendListProps<T>) {
  return (
    <div className="flex flex-col gap-4">
      {ListHeaderComponent}
      {sections.map((section, sectionIndex) => (
        <div key={section.title ?? sectionIndex} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-1 shadow-sm">{section.title}</span>
            <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
          </div>
          <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
            {section.data.map((item, itemIndex) => {
              const key = keyExtractor ? keyExtractor(item, itemIndex) : `${sectionIndex}-${itemIndex}`
              return (
                <div key={key} className="p-3">
                  {renderItem({ item, index: itemIndex, section })}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
