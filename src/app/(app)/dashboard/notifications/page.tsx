import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/page-container'
import { readSessionFromCookies } from '../../../session.server'
import { listTrainerNotifications, type NotificationList } from '@/server/notifications'
import NotificationsClient from './notifications-client'

async function loadNotifications(session: { token: string; trainerId: string; userId: string }) {
  return listTrainerNotifications(session.trainerId, session.userId)
}

export default async function NotificationsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let notifications: NotificationList = []
  let error: string | null = null

  try {
    notifications = await loadNotifications(session)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to load notifications'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold leading-tight">Notifications</h1>
      </div>

      <NotificationsClient
        initialNotifications={notifications}
        initialError={error}
      />
    </PageContainer>
  )
}
