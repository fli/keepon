'use server'

import { revalidatePath } from 'next/cache'

import { changeTrainerPassword, updateTrainerAccount } from '@/server/account'
import { readSessionFromCookies } from '../../../session.server'

export type ActionResult = { status: 'success' | 'error'; message: string }

const authError: ActionResult = {
  status: 'error',
  message: 'You need to sign in again.',
}

export async function updateAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await readSessionFromCookies()
  if (!session) {
    return authError
  }

  const firstName = formData.get('firstName')
  const lastName = formData.get('lastName')
  const email = formData.get('email')
  const businessName = formData.get('businessName')

  try {
    await updateTrainerAccount(session.trainerId, {
      firstName: typeof firstName === 'string' ? firstName : '',
      lastName: typeof lastName === 'string' ? lastName : null,
      email: typeof email === 'string' ? email : '',
      businessName: typeof businessName === 'string' ? businessName : null,
    })

    revalidatePath('/settings/account')

    return { status: 'success', message: 'Account details updated.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : null
    return {
      status: 'error',
      message: message ?? 'Unable to save your changes right now.',
    }
  }
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const session = await readSessionFromCookies()
  if (!session) {
    return authError
  }

  const currentPassword = formData.get('currentPassword')
  const newPassword = formData.get('newPassword')

  try {
    await changeTrainerPassword(session.trainerId, {
      currentPassword: typeof currentPassword === 'string' ? currentPassword : '',
      newPassword: typeof newPassword === 'string' ? newPassword : '',
    })

    return { status: 'success', message: 'Password updated.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : null
    return {
      status: 'error',
      message: message ?? 'Unable to change your password right now.',
    }
  }
}
