import { AlertTriangle } from 'lucide-react'

import { cardIsExpired } from '@/lib/client-dashboard/format'
import { CardIcon } from './CardIcon'

type CardDetails = {
  last4: string
  expYear: number
  expMonth: number
  brand: string
}

type Props = {
  card: CardDetails | null
}

export function CardDetails({ card }: Props) {
  if (!card) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground">
        <AlertTriangle className="size-4 text-amber-500" aria-hidden />
        <span>No card on file</span>
      </div>
    )
  }

  const expired = cardIsExpired({ expMonth: card.expMonth, expYear: card.expYear })

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <CardIcon className="h-6 w-auto" brand={card.brand} />
      <span className="font-medium text-foreground">•••• {card.last4}</span>
      <span className={expired ? 'text-destructive' : 'text-muted-foreground'}>
        {expired ? 'Expired' : 'Expires'} {card.expMonth}/{card.expYear.toString()}
      </span>
    </div>
  )
}
