'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'

import { BellOff } from 'lucide-react'
import type { NotificationList } from '@/server/notifications'
import { Button } from '@/components/ui/button'
import { markAllNotificationsAsViewedAction, markNotificationAsViewedAction } from './actions'

type Notification = NotificationList[number]

type NotificationsClientProps = {
  initialNotifications: NotificationList
  initialError?: string | null
}

const buildTargetHref = (notification: Notification): Route | null => {
  if (notification.modelName === 'client' && notification.modelId) {
    return `/clients/${notification.modelId}` as Route
  }

  if (notification.clientId) {
    return `/clients/${notification.clientId}` as Route
  }

  return null
}

export function NotificationsClient({ initialNotifications, initialError = null }: NotificationsClientProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationList>(initialNotifications)
  const [error, setError] = useState<string | null>(initialError)
  const [isPending, startTransition] = useTransition()
  const [isMarkingAll, setIsMarkingAll] = useState(false)

  const hasNew = useMemo(() => notifications.some((notification) => !notification.viewed), [notifications])

  const handleSelect = useCallback(
    (notification: Notification) => {
      const previous = notifications
      const targetHref = buildTargetHref(notification)

      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, viewed: true } : item))
      )
      setError(null)

      startTransition(() => {
        markNotificationAsViewedAction(notification.id).catch((err) => {
          console.error('Failed to mark notification as viewed', err)
          setNotifications(previous)
          setError('Unable to mark notification as read. Please try again.')
        })
      })

      if (targetHref) {
        router.push(targetHref)
      }
    },
    [notifications, router]
  )

  const handleMarkAll = useCallback(() => {
    if (!hasNew || isMarkingAll) {
      return
    }

    const previous = notifications
    setIsMarkingAll(true)
    setNotifications((current) => current.map((item) => ({ ...item, viewed: true })))
    setError(null)

    startTransition(() => {
      markAllNotificationsAsViewedAction()
        .catch((err) => {
          console.error('Failed to mark all notifications as viewed', err)
          setNotifications(previous)
          setError('Unable to mark all notifications as read. Please try again.')
        })
        .finally(() => setIsMarkingAll(false))
    })
  }, [hasNew, isMarkingAll, notifications])

  return (
    <section className="space-y-4">
      {hasNew ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={handleMarkAll} disabled={isMarkingAll || isPending}>
            {isMarkingAll ? 'Marking...' : 'Mark all as read'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-8 py-12 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-base font-medium text-foreground">No notifications yet</p>
            <p className="text-sm text-muted-foreground">
              You&apos;ll see updates from sales, payments, and clients here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card/40">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-start justify-between gap-3 px-6 py-4 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                onClick={() => handleSelect(notification)}
              >
                <div className="space-y-1">
                  <p className="text-sm whitespace-pre-line text-foreground">{notification.alert}</p>
                  <p className="text-xs text-muted-foreground">
                    {notification.created
                      ? new Date(notification.created).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'Unknown time'}
                  </p>
                </div>
                {!notification.viewed ? (
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-primary" aria-label="New" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
