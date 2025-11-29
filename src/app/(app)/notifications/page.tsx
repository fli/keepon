import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/page-container'
import { NotificationsCard } from '@/components/notifications-card'
import { readSessionFromCookies } from '../../session.server'
import { listTrainerNotifications, type NotificationList } from '@/server/notifications'

type Notification = NotificationList[number]

async function loadNotifications(session: { token: string; trainerId: string; userId: string }) {
  return listTrainerNotifications(session.trainerId, session.userId)
}

export default async function NotificationsPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let notifications: Notification[] = []
  let error: string | null = null

  try {
    notifications = await loadNotifications(session)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to load notifications'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inbox
          </p>
          <h1 className="text-3xl font-semibold leading-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            See recent updates for your business.
          </p>
        </div>
      </div>

      <NotificationsCard
        notifications={notifications}
        error={error}
        title="Latest activity"
        description={
          notifications.length ? 'Newest first' : 'No notifications yet'
        }
      />
    </PageContainer>
  )
}
