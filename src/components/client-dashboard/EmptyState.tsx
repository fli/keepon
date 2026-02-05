import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground', className)}>
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="text-base font-medium text-foreground">{title}</div>
      {description ? <div className="max-w-sm text-sm text-muted-foreground">{description}</div> : null}
    </div>
  )
}
