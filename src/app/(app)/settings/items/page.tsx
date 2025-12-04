import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'

import { listProducts } from '@/server/products'
import { readSessionFromCookies } from '../../../session.server'

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.string(),
  currency: z.string(),
})

type Item = z.infer<typeof itemSchema>

async function loadItems(trainerId: string): Promise<Item[]> {
  const data = await listProducts(trainerId, { type: 'item' })
  return z.array(itemSchema).parse(data ?? [])
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

export default async function ItemsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let items: Item[] = []
  let error: string | null = null

  try {
    items = await loadItems(session.trainerId)
  } catch (cause: unknown) {
    console.error('ItemsPage: failed to load items', cause)
    error = cause instanceof Error ? cause.message : 'Unable to load items.'
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-muted-foreground">Settings</p>
            <h1 className="text-3xl font-semibold leading-tight">Items</h1>
            <p className="text-sm text-muted-foreground">
              Sell add-ons and one-off items.
            </p>
          </div>
          <Button size="sm" render={<Link href="/settings/items/add" />}>Add item</Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
        <div className="grid grid-cols-3 gap-3 bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Item</span>
          <span>Description</span>
          <span className="text-right">Price</span>
        </div>
        <div className="divide-y divide-border bg-background">
          {sorted.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">{error ?? 'No items yet.'}</div>
          ) : (
            sorted.map(item => (
              <div
                key={item.id}
                className="grid grid-cols-3 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="font-medium">{item.name}</div>
                <div className="truncate text-muted-foreground">
                  {item.description?.trim() || '—'}
                </div>
                <div className="text-right">
                  {formatPrice(item.price, item.currency)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </PageContainer>
  )
}
