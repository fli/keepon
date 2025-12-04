'use client'

import * as React from 'react'
import { mergeProps } from '@base-ui-components/react'
import { useRender } from '@base-ui-components/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        outline:
          'border bg-transparent text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-foreground hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/80 focus-visible:ring-destructive/50 dark:bg-destructive/80 dark:hover:bg-destructive/60 dark:focus-visible:ring-destructive/40',
      },
      size: {
        sm: 'h-8 gap-1 px-3',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        'icon-sm': "size-8 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-9',
        'icon-lg': "size-10 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends
    VariantProps<typeof buttonVariants>,
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    useRender.ComponentProps<'button'> {}

function Button({ className, variant, size, render = <button />, ...props }: ButtonProps) {
  const defaultProps = {
    'data-slot': 'button',
    className: cn(buttonVariants({ variant, size, className })),
  } as const

  const element = useRender({
    render,
    props: mergeProps<'button'>(defaultProps, props),
  })

  return element
}

export { Button, buttonVariants }
