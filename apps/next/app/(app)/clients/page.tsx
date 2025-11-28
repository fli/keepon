import Link from 'next/link'
import { redirect } from 'next/navigation'

import { statusOptions, normalizeStatus, statusColors } from 'app/features/clients/shared'
import type { Client } from 'app/services/api'
import { loadClientsServer, readSessionFromCookies } from './actions'

export default async function ClientsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const clients = (await loadClientsServer()) ?? []
  const counts = clients.reduce<Record<string, number>>((acc, client) => {
    const key = normalizeStatus(client.status)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="page-shell flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-wide text-[var(--color-secondaryText)]">Clients</p>
        <h1 className="text-3xl font-semibold leading-tight">Your roster</h1>
        <p className="text-sm text-[var(--color-secondaryText)]">
          Segment by status and open details without leaving the web app.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/clients/add" className="btn btn-primary text-sm">
            Add client
          </Link>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--color-secondaryText)]">
            {statusOptions.map(option => (
              <span key={option.id} className="pill" style={{ color: statusColors[option.id] }}>
                {option.label}: {counts[option.id] ?? 0}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.length === 0 ? (
          <div className="card card-padded sm:col-span-2 lg:col-span-3">
            <p className="text-lg font-semibold">No clients yet</p>
            <p className="text-sm text-[var(--color-secondaryText)] mt-2">
              Add clients to start scheduling and billing.
            </p>
          </div>
        ) : null}

        {clients.map(client => (
          <Link key={client.id} href={`/clients/${client.id}`} className="card card-padded flex flex-col gap-2 hover:translate-y-[-2px] transition-transform">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                style={{ backgroundColor: statusColors[normalizeStatus(client.status)] || '#e5e7eb' }}
              >
                {(client.firstName || client.lastName || '?').charAt(0)}
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <p className="truncate font-semibold">{client.firstName} {client.lastName}</p>
                <p className="text-sm text-[var(--color-secondaryText)] truncate">{client.email || 'No email'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--color-secondaryText)]">
              <span className="pill" style={{ color: statusColors[normalizeStatus(client.status)] }}>
                {statusOptions.find(o => o.id === normalizeStatus(client.status))?.label ?? 'Current'}
              </span>
              {client.company ? <span className="pill text-[var(--color-secondaryText)]">{client.company}</span> : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
