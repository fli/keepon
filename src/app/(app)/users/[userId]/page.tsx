import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../../session.server'

export default function UserPage({ params }: { params: Promise<{ userId: string }> }) {
  return (
    <Suspense
      fallback={
        <PageContainer className="flex flex-col gap-3 py-8">
          <h1 className="text-3xl font-semibold">User</h1>
          <p className="text-sm text-muted-foreground">Loading user…</p>
        </PageContainer>
      }
    >
      <UserPageContent params={params} />
    </Suspense>
  )
}

async function UserPageContent({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col gap-3 py-8">
      <p className="text-sm tracking-wide text-muted-foreground uppercase">User</p>
      <h1 className="text-3xl font-semibold">User {userId}</h1>
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">This route now renders on the server.</CardContent>
      </Card>
    </PageContainer>
  )
}
