'use server'

import { revalidatePath } from 'next/cache'

import {
  clientReminderTypeValues,
  serviceProviderReminderTypeValues,
} from '@/lib/reminders'
import {
  type ReminderSettingsInput,
  updateReminderSettings,
} from '@/server/reminders'
import { readSessionFromCookies } from '../../../session.server'

export type ActionResult = { status: 'success' | 'error'; message: string }

const authError: ActionResult = {
  status: 'error',
  message: 'Please sign in again.',
}

const isoDurationPrefix = /^P/i

const parseReminder = <
  TType extends string,
  TResult extends { type: TType; timeBeforeStart: string } | null
>(
  formData: FormData,
  prefix: string,
  allowedTypes: readonly TType[]
): TResult => {
  const rawType = formData.get(`${prefix}Type`)
  const rawTime = formData.get(`${prefix}Time`)

  if (typeof rawType !== 'string' || typeof rawTime !== 'string') {
    return null as TResult
  }

  const type = rawType.trim()
  const timeBeforeStart = rawTime.trim()

  if (!type || !timeBeforeStart) {
    return null as TResult
  }

  if (!allowedTypes.includes(type as TType)) {
    throw new Error('Invalid reminder type.')
  }

  if (!isoDurationPrefix.test(timeBeforeStart)) {
    throw new Error('Reminder time must be an ISO-8601 duration (e.g. PT1H).')
  }

  return { type: type as TType, timeBeforeStart } as TResult
}

export async function updateRemindersAction(
  formData: FormData
): Promise<ActionResult> {
  const session = await readSessionFromCookies()
  if (!session) return authError

  try {
    const payload: ReminderSettingsInput = {
      serviceProviderReminder1: parseReminder(
        formData,
        'serviceProviderReminder1',
        serviceProviderReminderTypeValues
      ),
      serviceProviderReminder2: parseReminder(
        formData,
        'serviceProviderReminder2',
        serviceProviderReminderTypeValues
      ),
      clientReminder1: parseReminder(
        formData,
        'clientReminder1',
        clientReminderTypeValues
      ),
      clientReminder2: parseReminder(
        formData,
        'clientReminder2',
        clientReminderTypeValues
      ),
    }

    await updateReminderSettings(session.trainerId, payload)
    revalidatePath('/settings/reminders')
    revalidatePath('/settings/reminders/edit')

    return {
      status: 'success',
      message: 'Reminder defaults updated.',
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to save reminders right now.'
    return {
      status: 'error',
      message,
    }
  }
}
