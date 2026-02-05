import { Buffer } from 'node:buffer'
import type { Json } from '@/lib/db'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'

const buildStatusCallbackUrl = () => {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  return new URL('/api/twilioStatusMessage', baseUrl).toString()
}

const parseTwilioErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { message?: unknown }
    if (typeof payload.message === 'string') {
      return payload.message
    }
  } catch {
    // ignore
  }

  return `Twilio API responded with status ${response.status}`
}

export const handleSendSmsTask = async ({ id }: WorkflowTaskPayloadMap['sendSms']) => {
  const smsRow = await db
    .selectFrom('sms')
    .leftJoin('client', 'client.id', 'sms.client_id')
    .leftJoin('trainer', 'trainer.id', 'sms.trainer_id')
    .select((eb) => [
      eb.ref('sms.trainer_id').as('trainerId'),
      eb.ref('sms.client_id').as('clientId'),
      eb.ref('sms.from_number').as('fromNumber'),
      eb.ref('sms.to_number').as('toNumber'),
      eb.ref('sms.body').as('body'),
      eb.ref('trainer.user_id').as('userId'),
      eb.ref('client.first_name').as('clientFirstName'),
      eb.ref('client.last_name').as('clientLastName'),
    ])
    .where('sms.id', '=', id)
    .where('sms.queued_at', 'is', null)
    .where('sms.queue_failed_at', 'is', null)
    .executeTakeFirst()

  if (!smsRow) {
    return
  }

  const clientName = [smsRow.clientFirstName, smsRow.clientLastName].filter(Boolean).join(' ').trim() || null
  const sms = { ...smsRow, clientName }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID

  if (!accountSid || !authToken || (!messagingServiceSid && !sms.fromNumber)) {
    throw new Error('Twilio not configured')
  }

  const params = new URLSearchParams()
  params.set('To', sms.toNumber)
  params.set('Body', sms.body)
  params.set('StatusCallback', buildStatusCallbackUrl())

  if (sms.fromNumber) {
    params.set('From', sms.fromNumber)
  } else if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid)
  }

  let response: Response
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await db
      .updateTable('sms')
      .set({ queue_failed_at: new Date(), queue_failed_reason: message })
      .where('id', '=', id)
      .execute()
    return
  }

  if (!response.ok) {
    const message = await parseTwilioErrorMessage(response)

    if (sms.userId && sms.clientId && sms.clientName && message.endsWith('is not a valid phone number.')) {
      await enqueueWorkflowTask(db, 'user.notify', {
        title: `Text reminder didn't send.`,
        body: `Sending a text reminder to ${sms.clientName} (${sms.toNumber}) failed because the number was invalid. Your credit has been refunded.`,
        clientId: sms.clientId,
        userId: sms.userId,
        messageType: 'failure',
        notificationType: 'general',
      })
    }

    await db
      .updateTable('sms')
      .set({ queue_failed_at: new Date(), queue_failed_reason: message })
      .where('id', '=', id)
      .execute()

    return
  }

  const message = (await response.json()) as { sid?: string }
  const sanitizedMessage = JSON.parse(JSON.stringify(message)) as Json

  if (message.sid) {
    await db
      .insertInto('twilio.message')
      .values({ sid: message.sid, object: sanitizedMessage })
      .onConflict((oc) => oc.column('sid').doUpdateSet({ object: sanitizedMessage }))
      .execute()

    await db
      .updateTable('sms')
      .set({ queued_at: new Date(), twilio_message_sid: message.sid })
      .where('id', '=', id)
      .execute()
  }
}
