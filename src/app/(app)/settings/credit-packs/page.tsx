import { redirect } from 'next/navigation'
import { z } from 'zod'

import Link from 'next/link'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'

import { listProducts } from '@/server/products'
import { readSessionFromCookies } from '../../../session.server'

const creditPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.string(),
  currency: z.string(),
  totalCredits: z.number().int(),
})

type CreditPack = z.infer<typeof creditPackSchema>

async function loadCreditPacks(trainerId: string): Promise<CreditPack[]> {
  const data = await listProducts(trainerId, { type: 'creditPack' })
  return z.array(creditPackSchema).parse(data ?? [])
}

function formatPrice(amount: string, currency: string) {
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed)) return `${amount} ${currency}`

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(parsed)
  } catch {
    return `${parsed.toFixed(2)} ${currency}`
  }
}

export default async function CreditPacksPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let creditPacks: CreditPack[] = []
  let error: string | null = null

  try {
    creditPacks = await loadCreditPacks(session.trainerId)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to load credit packs.'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
            <h1 className="text-3xl font-semibold leading-tight">Credit packs</h1>
            <p className="text-sm text-muted-foreground">
              Review packs of credits that clients can purchase and apply toward sessions.
            </p>
          </div>
          <Button size="sm" render={<Link href="/settings/credit-packs/add" />}>
            Add credit pack
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
        <div className="grid grid-cols-4 gap-3 bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Credit pack</span>
          <span>Service name</span>
          <span className="text-right">Credits</span>
          <span className="text-right">Price</span>
        </div>
        <div className="divide-y divide-border bg-background">
          {creditPacks.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">{error ?? 'No credit packs yet.'}</div>
          ) : (
            creditPacks.map((pack) => (
              <div
                key={pack.id}
                className="grid grid-cols-4 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="font-medium">{pack.name}</div>
                <div className="max-w-xs truncate text-muted-foreground">
                  {pack.description?.trim() || 'Any service'}
                </div>
                <div className="text-right">{pack.totalCredits}</div>
                <div className="text-right">{formatPrice(pack.price, pack.currency)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </PageContainer>
  )
}
