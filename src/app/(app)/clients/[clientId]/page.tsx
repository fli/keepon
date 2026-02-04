import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { PageContainer } from '@/components/page-container'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

import { statusColors, normalizeStatus, optionalValue } from '@/lib/app/features/clients/shared'
import { loadClientsServer, readSessionFromCookies } from '../actions'

export default function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col gap-6 py-8">
          <h1 className="text-3xl leading-tight font-semibold">Client</h1>
          <p className="text-sm text-muted-foreground">Loading client details…</p>
        </PageContainer>
      }
    >
      <ClientDetailContent params={params} />
    </Suspense>
  )
}

async function ClientDetailContent({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const clients = (await loadClientsServer()) ?? []
  const client = clients.find((item) => item.id === clientId)

  if (!client) {
    return (
      <PageContainer className="flex flex-col gap-3 py-8">
        <h1 className="text-2xl font-semibold">Client not found</h1>
      </PageContainer>
    )
  }

  const status = normalizeStatus(client.status)

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl leading-tight font-semibold">
          {client.firstName} {client.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">{client.company ?? 'Independent client'}</p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold text-background"
              style={{ backgroundColor: statusColors[status] || '#e5e7eb' }}
            >
              {(client.firstName || client.lastName || '?').charAt(0)}
            </div>
            <div className="flex flex-col gap-2">
              <Badge variant="outline" style={{ color: statusColors[status] }}>
                {status}
              </Badge>
              {client.company ? (
                <Badge variant="outline" className="w-fit text-muted-foreground">
                  {client.company}
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DetailRow label="Email" value={optionalValue(client.email) ?? 'Not provided'} />
          <DetailRow label="Mobile" value={optionalValue(client.mobileNumber) ?? 'Not provided'} />
          <DetailRow label="Other" value={optionalValue(client.otherNumber) ?? 'Not provided'} />
          <DetailRow label="Company" value={optionalValue(client.company) ?? 'Not provided'} />
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const muted = value === 'Not provided'
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={muted ? 'text-muted-foreground' : 'font-medium'}>{value}</p>
    </div>
  )
}
