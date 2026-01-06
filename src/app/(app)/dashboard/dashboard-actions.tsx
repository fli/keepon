import Link from 'next/link'

import type { Route } from 'next'

import { Button } from '@/components/ui/button'

const actionRows: Array<Array<{ label: string; href?: Route }>> = [
  [
    { label: 'Sell credit pack', href: '/dashboard/sell/credit-pack' },
    { label: 'Sell service' },
    { label: 'Sell item' },
    { label: 'Sell subscription' },
  ],
  [{ label: 'Charge custom amount' }],
  [{ label: 'Add expense' }],
]

export function DashboardActions() {
  return (
    <div className="flex flex-col gap-2">
      {actionRows.map((row, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          {row.map(({ label, href }) => (
            <Button
              key={label}
              variant="secondary"
              nativeButton={href ? false : undefined}
              render={href ? <Link href={href} /> : undefined}
            >
              {label}
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}
