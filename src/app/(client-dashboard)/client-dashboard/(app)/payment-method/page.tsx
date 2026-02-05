import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { getClientProfile } from '@/server/client-dashboard/queries'
import { PaymentMethodClient } from './payment-method-client'

export default async function PaymentMethodPage() {
  const clientProfile = await getClientProfile()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-foreground">Payment method</h1>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/client-dashboard" />}>
          Back to dashboard
        </Button>
      </div>

      <PaymentMethodClient card={clientProfile.card} />
    </div>
  )
}
