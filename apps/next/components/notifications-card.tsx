import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { NotificationList } from '@/server/notifications'

type Notification = NotificationList[number]

type NotificationsCardProps = {
  notifications: Notification[]
  error?: string | null
  title?: string
  description?: string
  emptyMessage?: string
  headerAction?: ReactNode
}

function formatNotificationDate(value?: string) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function NotificationsCard({
  notifications,
  error,
  title = 'Notifications',
  description,
  emptyMessage = "You're all caught up.",
  headerAction,
}: NotificationsCardProps) {
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Unable to fetch notifications</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const hasNew = notifications.some(notification => !notification.viewed)
  const showHeaderExtras = hasNew || Boolean(headerAction)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {showHeaderExtras ? (
          <div className="flex items-center gap-2">
            {headerAction}
            {hasNew ? <Badge variant="secondary">New</Badge> : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {notifications.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map(notification => (
              <li
                key={notification.id}
                className="flex items-start justify-between gap-3 px-6 py-4"
              >
                <div className="space-y-1">
                  <p className="text-sm text-foreground">{notification.alert}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNotificationDate(notification.created)}
                  </p>
                </div>
                {!notification.viewed ? (
                  <Badge variant="secondary">New</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
