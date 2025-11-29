import * as React from 'react'

import { cn } from '@/lib/utils'

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

/**
 * 9UI-inspired loading block with subtle pulse.
 */
function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/80 text-transparent', className)}
      {...props}
    />
  )
}

export { Skeleton }
