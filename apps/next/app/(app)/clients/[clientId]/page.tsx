import Link from 'next/link'
import { redirect } from 'next/navigation'

import { statusColors, normalizeStatus, optionalValue } from 'app/features/clients/shared'
import { loadClientsServer, readSessionFromCookies } from '../actions'

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const clients = (await loadClientsServer()) ?? []
  const client = clients.find(item => item.id === clientId)

  if (!client) {
    return (
      <div className="page-shell flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondaryText)]">Clients</p>
        <h1 className="text-2xl font-semibold">Client not found</h1>
        <Link href="/clients" className="btn btn-secondary text-sm w-fit">Back to clients</Link>
      </div>
    )
  }

  const status = normalizeStatus(client.status)

  return (
    <div className="page-shell flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-[var(--color-secondaryText)]">Clients</p>
          <h1 className="text-3xl font-semibold leading-tight">{client.firstName} {client.lastName}</h1>
          <p className="text-sm text-[var(--color-secondaryText)]">{client.company || 'Independent client'}</p>
        </div>
        <Link href="/clients" className="btn btn-secondary text-sm">Back</Link>
      </div>

      <div className="card card-padded flex flex-col gap-4 max-w-3xl">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold"
            style={{ backgroundColor: statusColors[status] || '#e5e7eb' }}
          >
            {(client.firstName || client.lastName || '?').charAt(0)}
          </div>
          <div className="flex flex-col gap-1">
            <span className="pill text-sm" style={{ color: statusColors[status] }}>
              {status}
            </span>
            {client.company ? <span className="pill text-sm text-[var(--color-secondaryText)]">{client.company}</span> : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DetailRow label="Email" value={optionalValue(client.email) ?? 'Not provided'} />
          <DetailRow label="Mobile" value={optionalValue(client.mobileNumber) ?? 'Not provided'} />
          <DetailRow label="Other" value={optionalValue(client.otherNumber) ?? 'Not provided'} />
          <DetailRow label="Company" value={optionalValue(client.company) ?? 'Not provided'} />
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const muted = value === 'Not provided'
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-[var(--color-secondaryText)]">{label}</p>
      <p className={muted ? 'text-[var(--color-secondaryText)]' : 'font-medium'}>{value}</p>
    </div>
  )
}
