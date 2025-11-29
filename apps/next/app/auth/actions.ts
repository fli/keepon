'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import type { KeeponSession } from '@keepon/api'
import { login } from '@/server/auth'
import { createTrainerAccount } from '@/server/trainers'

const SESSION_COOKIE = 'kpSession'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 28

const getFormString = (formData: FormData, key: string, fallback = '') => {
  const value = formData.get(key)
  return typeof value === 'string' ? value : fallback
}

async function persistSession(session: KeeponSession) {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, encodeURIComponent(JSON.stringify(session)), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function loginAction(_prev: { error?: string | null }, formData: FormData) {
  try {
    const email = getFormString(formData, 'email').trim()
    const password = getFormString(formData, 'password')
    const json = await login({ email, password })
    const session: KeeponSession = {
      token: json.id,
      userId: json.userId,
      trainerId: json.trainerId,
    }

    await persistSession(session)
    redirect('/dashboard')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to sign in'
    return { error: message }
  }
}

export async function createAccountAction(_prev: { error?: string | null }, formData: FormData) {
  try {
    const firstName = getFormString(formData, 'firstName').trim()
    const lastName = getFormString(formData, 'lastName').trim() || null
    const email = getFormString(formData, 'email').trim()
    const password = getFormString(formData, 'password')
    const country = getFormString(formData, 'country', 'US').trim().slice(0, 2).toUpperCase()

    const json = await createTrainerAccount({
      firstName,
      lastName,
      email,
      password,
      country,
      businessName: null,
      brandColor: '#3b82f6',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Etc/UTC',
      locale: Intl.DateTimeFormat().resolvedOptions().locale ?? 'en-US',
    })
    const session: KeeponSession = {
      token: json.id,
      userId: json.userId,
      trainerId: json.trainerId,
    }

    await persistSession(session)
    redirect('/dashboard')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create account'
    return { error: message }
  }
}
