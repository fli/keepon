import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getClientProfile } from '@/server/client-dashboard/queries'

export default async function UpdateEmailPage() {
  const clientProfile = await getClientProfile()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Client Dashboard</p>
          <h1 className="text-2xl font-semibold text-foreground">Update email</h1>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/client-dashboard" />}>
          Back to dashboard
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact your service provider</CardTitle>
          <CardDescription>
            Email updates are handled by your service provider. Reach out to them or to Keepon support for help.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="space-y-2 text-sm text-muted-foreground" htmlFor="email">
            Current email
            <Input id="email" type="email" value={clientProfile.email} disabled />
          </label>
          <p className="text-xs text-muted-foreground">
            Need help? Email{' '}
            <a className="underline" href="mailto:enquiry@getkeepon.com">
              enquiry@getkeepon.com
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
