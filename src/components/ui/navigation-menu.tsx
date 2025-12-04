'use client'

import * as React from 'react'
import { NavigationMenu as BaseNavigationMenu } from '@base-ui-components/react/navigation-menu'
import { cva } from 'class-variance-authority'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function NavigationMenu({ className, children, ...props }: React.ComponentProps<typeof BaseNavigationMenu.Root>) {
  return (
    <BaseNavigationMenu.Root
      data-slot="navigation-menu"
      className={cn('w-full min-w-0 sm:min-w-max', className)}
      {...props}
    >
      {children}
      <NavigationMenuViewport />
    </BaseNavigationMenu.Root>
  )
}

function NavigationMenuList({ className, ...props }: React.ComponentProps<typeof BaseNavigationMenu.List>) {
  return (
    <BaseNavigationMenu.List
      data-slot="navigation-menu-list"
      className={cn(
        'relative flex w-full flex-wrap items-center justify-between gap-1 sm:justify-center sm:gap-2',
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({ ...props }: React.ComponentProps<typeof BaseNavigationMenu.Item>) {
  return <BaseNavigationMenu.Item data-slot="navigation-menu-item" {...props} />
}

function NavigationMenuIcon({ ...props }: React.ComponentProps<typeof BaseNavigationMenu.Icon>) {
  return <BaseNavigationMenu.Icon data-slot="navigation-menu-icon" {...props} />
}

const navigationMenuTriggerStyle = cva(
  "inline-flex h-9 w-max shrink-0 items-center justify-center gap-1.5 rounded-md bg-background px-4 py-2 text-sm font-medium no-underline transition-[color,box-shadow] outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-accent/50 data-[popup-open]:text-accent-foreground data-[popup-open]:hover:bg-accent data-[popup-open]:focus:bg-accent [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3"
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseNavigationMenu.Trigger>) {
  return (
    <BaseNavigationMenu.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(navigationMenuTriggerStyle(), className)}
      {...props}
    >
      {children}
      <NavigationMenuIcon className="transition-transform duration-300 data-[popup-open]:rotate-180">
        <ChevronDownIcon aria-hidden="true" />
      </NavigationMenuIcon>
    </BaseNavigationMenu.Trigger>
  )
}

function NavigationMenuContent({ className, ...props }: React.ComponentProps<typeof BaseNavigationMenu.Content>) {
  return (
    <BaseNavigationMenu.Content
      data-slot="navigation-menu-content"
      className={cn('w-full p-2 md:w-auto', className)}
      {...props}
    />
  )
}

function NavigationMenuLink({ className, ...props }: React.ComponentProps<typeof BaseNavigationMenu.Link>) {
  return (
    <BaseNavigationMenu.Link
      data-slot="navigation-menu-link"
      className={cn(
        "flex h-9 min-w-[64px] flex-row items-center justify-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-[13px] leading-tight font-medium whitespace-nowrap transition-all outline-none hover:bg-accent/60 hover:text-accent-foreground focus:bg-accent/60 focus:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 data-[active]:border-border data-[active]:bg-accent/40 data-[active]:text-foreground sm:h-9 sm:px-3 sm:text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({ className, ...props }: React.ComponentProps<typeof BaseNavigationMenu.Popup>) {
  return (
    <BaseNavigationMenu.Portal data-slot="navigation-menu-portal">
      <BaseNavigationMenu.Positioner
        sideOffset={4}
        align="start"
        className="h-[var(--positioner-height)] w-[var(--positioner-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] duration-300"
        data-slot="navigation-menu-positioner"
      >
        <BaseNavigationMenu.Popup
          className={cn(
            'h-[var(--popup-height)] w-[var(--popup-width)] origin-[var(--transform-origin)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md duration-300 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            className
          )}
          data-slot="navigation-menu-popup"
          {...props}
        >
          <BaseNavigationMenu.Viewport data-slot="navigation-menu-viewport" />
        </BaseNavigationMenu.Popup>
      </BaseNavigationMenu.Positioner>
    </BaseNavigationMenu.Portal>
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
}
