'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  isStatusFilter,
  normalizeStatus,
  statusColors,
  statusOptions,
  type StatusFilter,
} from '@/lib/app/features/clients/shared'
import type { Client } from '@/lib/api'
import { Plus } from 'lucide-react'

type Props = {
  clients: Client[]
}

const STATUS_TABS: (StatusFilter | 'all')[] = ['current', 'lead', 'past', 'all']

export function ClientPicker({ clients }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const statusParam = searchParams.get('status')

  const statusFilter: StatusFilter | 'all' = isStatusFilter(statusParam) ? statusParam : 'all'

  const updateQuery = useCallback(
    (updates: { status?: StatusFilter | 'all' }) => {
      const params = new URLSearchParams(searchParams.toString())

      if (updates.status !== undefined) {
        if (updates.status === 'all') params.delete('status')
        else params.set('status', updates.status)
      }

      const qs = params.toString()
      const href = (qs ? `${pathname}?${qs}` : pathname) as Route
      router.replace(href, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      const matchesStatus = statusFilter === 'all' || normalizeStatus(client.status) === statusFilter
      return matchesStatus
    })
  }, [clients, statusFilter])

  const goToClient = useCallback(
    (clientId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      const href = (
        params.size > 0
          ? `/dashboard/sell/credit-pack/${clientId}?${params.toString()}`
          : `/dashboard/sell/credit-pack/${clientId}`
      ) as Route
      router.push(href)
    },
    [router, searchParams]
  )

  const redirectTarget = (
    searchParams.size > 0 ? `/dashboard/sell/credit-pack?${searchParams.toString()}` : '/dashboard/sell/credit-pack'
  ) as Route
  const redirectParam = encodeURIComponent(redirectTarget)
  const addClientHref = `/clients/add?redirect=${redirectParam}` as Route

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((status) => {
            const label =
              status === 'all' ? 'All' : (statusOptions.find((option) => option.id === status)?.label ?? status)
            const active = statusFilter === status
            return (
              <Button
                key={status}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => updateQuery({ status })}
                className="capitalize"
              >
                {label}
              </Button>
            )
          })}
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={addClientHref} />}
            className="inline-flex items-center gap-2"
          >
            <Plus className="size-4" aria-hidden />
            New client
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredClients.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No clients match your filters.
          </div>
        ) : (
          filteredClients.map((client) => {
            const status = normalizeStatus(client.status)
            const initials = (client.firstName?.[0] ?? '') + (client.lastName?.[0] ?? '') || '?'

            return (
              <button
                key={client.id}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-background p-4 text-left shadow-xs transition hover:-translate-y-px hover:border-primary/60 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                onClick={() => goToClient(client.id)}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-background"
                  style={{ backgroundColor: statusColors[status] }}
                  aria-hidden
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">
                      {`${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() || 'Unnamed client'}
                    </p>
                    <Badge
                      variant="outline"
                      className="shrink-0"
                      style={{
                        color: statusColors[status],
                        borderColor: `${statusColors[status]}33`,
                        backgroundColor: `${statusColors[status]}12`,
                      }}
                    >
                      {statusOptions.find((option) => option.id === status)?.label ?? 'Current'}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {client.email || client.mobileNumber || 'No contact info'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground/80">{client.company || 'Individual'}</p>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
