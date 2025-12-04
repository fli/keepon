import * as React from 'react'
import Image from 'next/image'

import { cn } from '@/lib/utils'

const Avatar = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted text-foreground',
        className
      )}
      {...props}
    />
  )
)
Avatar.displayName = 'Avatar'

type AvatarImageProps = Omit<React.ComponentProps<typeof Image>, 'fill' | 'sizes'> & {
  sizes?: string
}

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, alt, sizes = '2.5rem', ...props }, ref) => (
    <Image
      ref={ref}
      alt={alt}
      sizes={sizes}
      fill
      className={cn('aspect-square h-full w-full object-cover', className)}
      {...props}
    />
  )
)
AvatarImage.displayName = 'AvatarImage'

const AvatarFallback = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground',
        className
      )}
      {...props}
    />
  )
)
AvatarFallback.displayName = 'AvatarFallback'

export { Avatar, AvatarImage, AvatarFallback }
