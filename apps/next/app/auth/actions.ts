'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createAccount, login, type KeeponSession } from 'app/services/api'

const SESSION_COOKIE = 'kpSession'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 28

function persistSession(session: KeeponSession) {
  const jar = cookies()
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
    const email = (formData.get('email') || '').toString().trim()
    const password = (formData.get('password') || '').toString()
    const session = await login({ email, password })
    persistSession(session)
    redirect('/dashboard')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to sign in'
    return { error: message }
  }
}

export async function createAccountAction(_prev: { error?: string | null }, formData: FormData) {
  try {
    const firstName = (formData.get('firstName') || '').toString().trim()
    const lastName = (formData.get('lastName') || '').toString().trim() || null
    const email = (formData.get('email') || '').toString().trim()
    const password = (formData.get('password') || '').toString()
    const country = (formData.get('country') || 'US').toString().trim().slice(0, 2).toUpperCase()

    const session = await createAccount({
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

    persistSession(session)
    redirect('/dashboard')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create account'
    return { error: message }
  }
}
