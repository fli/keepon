'use server'

import { cookies } from 'next/headers'

import { readSessionFromCookies } from '../../session.server'
import { logout } from '@/server/auth'

const SESSION_COOKIE = 'kpSession'

export async function logoutAction() {
  const jar = await cookies()
  const session = await readSessionFromCookies()

  if (session) {
    try {
      await logout(session.token)
    } catch (error) {
      console.warn('logoutAction: API logout failed', error)
    }
  }

  jar.delete(SESSION_COOKIE)
}
