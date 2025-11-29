import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type PageContainerProps = HTMLAttributes<HTMLDivElement>

/**
 * Shared wrapper to keep nav and pages aligned.
 * Full-width with consistent horizontal padding.
 */
export function PageContainer({ className, ...props }: PageContainerProps) {
  return (
    <div
      className={cn('w-full px-6', className)}
      {...props}
    />
  )
}
