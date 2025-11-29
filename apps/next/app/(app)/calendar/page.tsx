import { redirect } from 'next/navigation'

import { CalendarShell } from '@/components/calendar/calendar-shell'
import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../session.server'

export default async function CalendarPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold leading-tight">Calendar</h1>
      </div>

      <CalendarShell />
    </PageContainer>
  )
}
