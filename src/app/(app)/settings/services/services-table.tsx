'use client'

import { CheckCircle2, CircleSlash } from 'lucide-react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'

type ServiceRow = {
  id: string
  name: string
  price: string
  currency: string
  durationMinutes: number
  bookableOnline: boolean
}

type Props = {
  services: ServiceRow[]
  error?: string | null
}

export function ServicesTable({ services, error }: Props) {
  const sorted = useMemo(() => [...services].toSorted((a, b) => a.name.localeCompare(b.name)), [services])

  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm">
      <div className="grid grid-cols-4 gap-3 bg-muted/50 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span>Bookable online</span>
        <span>Service</span>
        <span>Duration</span>
        <span className="text-right">Price</span>
      </div>
      <div className="divide-y divide-border bg-background">
        {error ? (
          <div className="px-4 py-6 text-sm text-destructive">{error}</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No services yet. Add a service in the legacy app and it will appear here.
          </div>
        ) : (
          sorted.map((service) => (
            <div
              key={service.id}
              className="grid grid-cols-4 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40"
            >
              <div>
                <Badge
                  variant={service.bookableOnline ? 'default' : 'outline'}
                  className="flex w-fit items-center gap-2"
                >
                  {service.bookableOnline ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : (
                    <CircleSlash className="size-4" aria-hidden />
                  )}
                  <span>{service.bookableOnline ? 'Bookable' : 'Hidden'}</span>
                </Badge>
              </div>
              <div className="font-medium">{service.name}</div>
              <div>{formatDuration(service.durationMinutes)}</div>
              <div className="text-right font-medium tabular-nums">{formatPrice(service.price, service.currency)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatDuration(minutes?: number | null) {
  if (!minutes || minutes <= 0) {
    return '—'
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (remainder > 0 || parts.length === 0) {
    parts.push(`${remainder}m`)
  }
  return parts.join(' ')
}

function formatPrice(amount: string | number, currency: string) {
  const parsed = typeof amount === 'number' ? amount : Number.parseFloat(amount ?? '0')
  const safeAmount = Number.isFinite(parsed) ? parsed : 0
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount)
  } catch {
    return `${currency} ${safeAmount.toFixed(2)}`
  }
}
