import * as React from 'react'

import { cn } from '@/lib/utils'

interface InputProps extends React.ComponentProps<'input'> {
  inputContainerClassName?: string
  leadingIcon?: React.ReactNode
  trailingIcon?: React.ReactNode
}

function Input({
  inputContainerClassName,
  className,
  type,
  leadingIcon,
  trailingIcon,
  disabled,
  ...props
}: InputProps) {
  return (
    <div
      className={cn('group relative w-full data-[disabled]:pointer-events-none', inputContainerClassName)}
      data-disabled={disabled ? '' : undefined}
      data-slot="input-container"
    >
      {leadingIcon && (
        <span
          data-slot="input-leading-icon"
          className="absolute top-1/2 left-3 shrink-0 -translate-y-1/2 text-muted-foreground [&_svg]:shrink-0 [&_svg:not([class*='pointer-events-'])]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
        >
          {leadingIcon}
        </span>
      )}
      <input
        type={type}
        data-slot="input"
        className={cn(
          'flex h-9 w-full min-w-0 rounded-md border bg-input px-3 py-1 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none group-hover:border-ring/70 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 md:text-sm',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/50',
          leadingIcon && 'pl-10',
          trailingIcon && 'pr-10',
          className
        )}
        disabled={disabled}
        {...props}
      />
      {trailingIcon && (
        <span
          data-slot="input-trailing-icon"
          className="absolute top-1/2 right-3 shrink-0 -translate-y-1/2 text-muted-foreground [&_svg]:shrink-0 [&_svg:not([class*='pointer-events-'])]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
        >
          {trailingIcon}
        </span>
      )}
    </div>
  )
}

export { Input }
