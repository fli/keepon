import { redirect } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../session.server'

export default async function FinancePage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col gap-4 py-8">
      <h1 className="text-3xl font-semibold">Finance</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Payouts</CardDescription>
            <CardTitle className="text-lg">
              Reconciliation moves to the dashboard data source.
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Overdue</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Detailed charts will land once the new server pipelines are wired.
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
