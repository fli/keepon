'use server'

import { cache } from 'react'

import { cookies } from 'next/headers'

import type { Client, CreateClientPayload, KeeponSession } from '@/lib/api'
import { listClientsForTrainer, createClientForTrainer, type CreateClientInput } from '@/server/clients'

const SESSION_COOKIE = 'kpSession'

export const readSessionFromCookies = cache(async (): Promise<KeeponSession | null> => {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(SESSION_COOKIE)
  const value = typeof cookie?.value === 'string' ? cookie.value : null
  if (!value) {
    return null
  }

  try {
    const decoded = decodeURIComponent(value)
    const parsed: unknown = JSON.parse(decoded)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Partial<KeeponSession>).token === 'string' &&
      typeof (parsed as Partial<KeeponSession>).trainerId === 'string' &&
      typeof (parsed as Partial<KeeponSession>).userId === 'string'
    ) {
      return parsed as KeeponSession
    }
  } catch (error) {
    console.warn('Clients actions: unable to parse session cookie', error)
  }

  return null
})

export async function loadClientsServer(): Promise<Client[] | undefined> {
  const session = await readSessionFromCookies()
  if (!session) {
    return undefined
  }

  try {
    const clients = await listClientsForTrainer(session.trainerId, undefined)
    return clients
  } catch (error) {
    console.error('Clients actions: server-side fetch failed', error)
    return undefined
  }
}

export async function createClientAction(payload: CreateClientPayload): Promise<Client> {
  const session = await readSessionFromCookies()
  if (!session) {
    throw new Error('Sign in to add clients')
  }

  const normalizedPayload: CreateClientInput = {
    ...payload,
    status: payload.status ?? 'current',
  }

  return createClientForTrainer(session.trainerId, normalizedPayload)
}
