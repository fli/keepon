'use client'

import { useMemo, useState } from 'react'
import type { DashboardSummary } from '@/server/dashboard'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'

type Timeframe = 'last7Days' | 'today'

type ProjectedPaidCardProps = {
  payments: DashboardSummary['payments'] | null
}

const timeframeOptions: { value: Timeframe; label: string }[] = [
  { value: 'last7Days', label: 'Last 7 days' },
  { value: 'today', label: 'Today' },
]

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function ProjectedPaidCard({ payments }: ProjectedPaidCardProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('last7Days')

  const selected = useMemo(() => {
    if (!payments) {
      return null
    }
    return payments[timeframe]
  }, [payments, timeframe])

  const currency = payments?.currency

  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Payments</p>
          <NativeSelect
            aria-label="Select revenue timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value as Timeframe)}
            className="w-36"
          >
            {timeframeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Projected</p>
            <p className="text-2xl font-semibold text-foreground">
              {selected && currency ? formatCurrency(selected.projected, currency) : '—'}
            </p>
          </div>
          <div className="mx-3 h-10 w-px bg-border" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Paid</p>
            <p className="text-2xl font-semibold text-foreground">
              {selected && currency ? formatCurrency(selected.paid, currency) : '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
