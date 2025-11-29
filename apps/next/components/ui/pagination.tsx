'use client'

import * as React from 'react'
import { mergeProps } from '@base-ui-components/react'
import { useRender, type UseRenderRenderProp } from '@base-ui-components/react/use-render'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'

type Renderable = UseRenderRenderProp<Record<string, unknown>>

interface BaseRenderProps<T extends HTMLElement>
  extends React.HTMLAttributes<T> {
  render?: Renderable
}

const Pagination = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) => (
  <nav
    aria-label="Pagination"
    className={cn('flex w-full items-center justify-between gap-4', className)}
    {...props}
  />
)
Pagination.displayName = 'Pagination'

const PaginationContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) => (
  <ul
    className={cn('flex items-center gap-1 text-sm font-medium', className)}
    {...props}
  />
)
PaginationContent.displayName = 'PaginationContent'

const PaginationItem = ({
  className,
  ...props
}: React.LiHTMLAttributes<HTMLLIElement>) => (
  <li className={cn('list-none', className)} {...props} />
)
PaginationItem.displayName = 'PaginationItem'

type PaginationLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> &
  BaseRenderProps<HTMLAnchorElement> & {
    isActive?: boolean
  }

function PaginationLink({
  className,
  isActive,
  render = <a /> as React.ReactElement<Record<string, unknown>>,
  ...props
}: PaginationLinkProps) {
  const defaultProps = {
    className: cn(
      'flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      isActive &&
        'border-primary/60 bg-primary text-primary-foreground shadow-xs hover:bg-primary',
      className
    ),
    'aria-current': isActive ? 'page' : undefined,
  }

  const element = useRender({
    render,
    props: mergeProps(defaultProps, props),
  })

  return element
}
PaginationLink.displayName = 'PaginationLink'

type PaginationButtonProps = React.AnchorHTMLAttributes<HTMLAnchorElement> &
  BaseRenderProps<HTMLAnchorElement>

function PaginationPrevious({
  className,
  render = <a /> as React.ReactElement<Record<string, unknown>>,
  ...props
}: PaginationButtonProps) {
  const element = useRender({
    render,
    props: mergeProps(
      {
        className: cn(
          'flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          className
        ),
        children: (
          <>
            <ChevronLeft className="size-4" aria-hidden />
            <span className="sr-only">Previous page</span>
          </>
        ),
      },
      props
    ),
  })

  return element
}
PaginationPrevious.displayName = 'PaginationPrevious'

function PaginationNext({
  className,
  render = <a /> as React.ReactElement<Record<string, unknown>>,
  ...props
}: PaginationButtonProps) {
  const element = useRender({
    render,
    props: mergeProps(
      {
        className: cn(
          'flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          className
        ),
        children: (
          <>
            <span className="sr-only">Next page</span>
            <ChevronRight className="size-4" aria-hidden />
          </>
        ),
      },
      props
    ),
  })

  return element
}
PaginationNext.displayName = 'PaginationNext'

const PaginationEllipsis = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    aria-hidden
    className={cn(
      'flex h-9 w-9 items-center justify-center text-muted-foreground',
      className
    )}
    {...props}
  >
    <MoreHorizontal className="size-4" />
    <span className="sr-only">More pages</span>
  </span>
)
PaginationEllipsis.displayName = 'PaginationEllipsis'

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
