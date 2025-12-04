import Link from 'next/link'
import type { Route } from 'next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CreditPack } from './actions'

type Props = {
  clientId: string
  creditPacks: CreditPack[]
  backQuery?: string
}

const formatPrice = (amount: string, currency: string) => {
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed)) return `${amount} ${currency}`

  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(parsed)
  } catch {
    return `${parsed.toFixed(2)} ${currency}`
  }
}

export function CreditPackSelector({ clientId, creditPacks, backQuery }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {creditPacks.length === 0 ? (
        <Card className="col-span-full">
          <CardHeader>
            <CardTitle>No credit packs yet</CardTitle>
            <CardDescription>Create a pack and return to complete the sale.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        creditPacks.map((pack) => {
          const href = (
            backQuery
              ? `/dashboard/sell/credit-pack/${clientId}/pack/${pack.id}?${backQuery}`
              : `/dashboard/sell/credit-pack/${clientId}/pack/${pack.id}`
          ) as Route

          return (
            <Card
              key={pack.id}
              className="flex flex-col border-border/80 shadow-xs transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
            >
              <CardHeader>
                <CardTitle className="text-xl">{pack.name}</CardTitle>
                <CardDescription className="line-clamp-2">
                  {pack.description?.trim() || 'Good for any service'}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-lg font-semibold">{formatPrice(pack.price, pack.currency)}</p>
                  <p className="text-sm text-muted-foreground">{pack.totalCredits} credits</p>
                </div>
                <Button size="sm" render={<Link href={href} />} className="shrink-0">
                  Choose
                </Button>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
