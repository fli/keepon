import { cache } from 'react'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { db } from '@/lib/db'

export const CLIENT_DASHBOARD_COOKIE = 'kpClientDashboard'

const CLIENT_ACCESS_TOKEN_EXTENSION_MS = 7 * 24 * 60 * 60 * 1000

export type ClientDashboardSession = {
  accessToken: string
  userId: string
  clientId: string
  trainerId: string
  expiresAt: Date
}

const parseCookieValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const getClientDashboardSession = cache(async (): Promise<ClientDashboardSession | null> => {
  const cookieStore = await cookies()
  const token = parseCookieValue(cookieStore.get(CLIENT_DASHBOARD_COOKIE)?.value)
  if (!token) {
    return null
  }

  const authRow = await db
    .selectFrom('access_token')
    .innerJoin('client', 'client.user_id', 'access_token.user_id')
    .select((eb) => [
      eb.ref('access_token.id').as('accessToken'),
      eb.ref('access_token.user_id').as('userId'),
      eb.ref('client.id').as('clientId'),
      eb.ref('client.trainer_id').as('trainerId'),
      eb.ref('access_token.expires_at').as('expiresAt'),
    ])
    .where('access_token.id', '=', token)
    .where('access_token.type', '=', 'client_dashboard')
    .executeTakeFirst()

  if (!authRow?.accessToken || !authRow.userId || !authRow.clientId || !authRow.trainerId || !authRow.expiresAt) {
    return null
  }

  const expiresAt = authRow.expiresAt instanceof Date ? authRow.expiresAt : new Date(authRow.expiresAt)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return null
  }

  try {
    await db
      .updateTable('access_token')
      .set({ expires_at: new Date(Date.now() + CLIENT_ACCESS_TOKEN_EXTENSION_MS) })
      .where('id', '=', authRow.accessToken)
      .where('type', '=', 'client_dashboard')
      .execute()
  } catch (error) {
    console.error('client-dashboard: failed to extend client dashboard token expiry', error)
  }

  return {
    accessToken: authRow.accessToken,
    userId: authRow.userId,
    clientId: authRow.clientId,
    trainerId: authRow.trainerId,
    expiresAt,
  }
})

export const requireClientDashboardSession = async () => {
  const session = await getClientDashboardSession()
  if (!session) {
    redirect('/client-dashboard/login')
  }
  return session
}
