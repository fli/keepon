import { redirect } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../../session.server'

export default async function MakeSalePage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col gap-4 py-8">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">Sales</p>
      <h1 className="text-3xl font-semibold">Collect payment</h1>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Card collection coming soon</CardTitle>
          <CardDescription>Server actions will drive web mutations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Card collection and payment requests are coming next.</p>
          <p>Use the native app for live payments today.</p>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
