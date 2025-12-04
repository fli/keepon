'use server'

import {
  listTrainerNotifications,
  markAllNotificationsAsViewed,
  markNotificationAsViewed,
  type NotificationList,
} from '@/server/notifications'
import { readSessionFromCookies } from '../../../session.server'

export async function loadNotificationsAction(): Promise<NotificationList> {
  const session = await readSessionFromCookies()
  if (!session) {
    throw new Error('Please sign in to load notifications')
  }

  return listTrainerNotifications(session.trainerId, session.userId)
}

export async function markNotificationAsViewedAction(notificationId: string): Promise<void> {
  const session = await readSessionFromCookies()
  if (!session) {
    throw new Error('Please sign in to update notifications')
  }

  await markNotificationAsViewed(session.trainerId, session.userId, notificationId)
}

export async function markAllNotificationsAsViewedAction(): Promise<number> {
  const session = await readSessionFromCookies()
  if (!session) {
    throw new Error('Please sign in to update notifications')
  }

  return markAllNotificationsAsViewed(session.trainerId, session.userId)
}
