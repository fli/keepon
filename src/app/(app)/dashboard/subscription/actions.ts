'use server'

import { headers } from 'next/headers'

import { readSessionFromCookies } from '../../../session.server'

type StartSubscriptionInput = {
  interval: 'month' | 'year'
  address: {
    country: string
    line1: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
  }
}

type StartSubscriptionResult = { ok: true; clientSecret: string } | { ok: false; message: string }

const FALLBACK_ORIGIN = process.env.NEXT_PUBLIC_ORPC_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:3000'

export const startSubscriptionIntent = async (input: StartSubscriptionInput): Promise<StartSubscriptionResult> => {
  const session = await readSessionFromCookies()

  if (!session) {
    return { ok: false, message: 'Please sign in again to start your subscription.' }
  }

  const headerList = await headers()
  const proto = headerList.get('x-forwarded-proto') ?? 'https'
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  const origin = host ? `${proto}://${host}` : FALLBACK_ORIGIN
  const buildInternalUrl = (path: string) => new URL(path, origin).toString()

  try {
    const res = await fetch(buildInternalUrl('/api/accountSubscription'), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        interval: input.interval,
        address: input.address,
      }),
    })

    if (!res.ok) {
      let detail = `Unable to start subscription (${res.status}).`
      try {
        const json = (await res.json()) as { message?: string; detail?: string }
        detail = json.detail ?? json.message ?? detail
      } catch {
        // ignore parse errors
      }

      return { ok: false, message: detail }
    }

    const json = (await res.json()) as { clientSecret?: string }
    const clientSecret = typeof json.clientSecret === 'string' ? json.clientSecret : null

    if (!clientSecret) {
      return { ok: false, message: 'Payment could not be started. Please try again.' }
    }

    return { ok: true, clientSecret }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error creating subscription.'
    return { ok: false, message }
  }
}
