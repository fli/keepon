import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

type NativeSelectProps = React.ComponentPropsWithoutRef<'select'> & {
  containerClassName?: string
}

/**
 * Shadcn-style native select for consistent inputs while keeping the platform picker.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, containerClassName, children, disabled, ...props }, ref) => {
    return (
      <div
        className={cn('relative inline-flex w-full items-center', containerClassName)}
        data-disabled={disabled ? '' : undefined}
      >
        <select
          ref={ref}
          disabled={disabled}
          className={cn(
            'appearance-none bg-input text-sm text-foreground h-9 w-full min-w-0 rounded-md border px-3 pr-9 py-1 shadow-xs transition-[color,box-shadow,border-color] outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    )
  }
)
NativeSelect.displayName = 'NativeSelect'

export { NativeSelect }
