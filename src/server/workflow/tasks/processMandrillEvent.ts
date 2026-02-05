import type { Json } from '@/lib/db/generated'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'

export const handleProcessMandrillEventTask = async ({
  ts,
  _id,
  event,
}: WorkflowTaskPayloadMap['processMandrillEvent']) => {
  const timestamp = Number.parseInt(ts, 10)
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`Invalid Mandrill event timestamp: ${ts}`)
  }
  const eventTime = new Date(timestamp * 1000)

  const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value) {
      return null
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null
      } catch {
        return null
      }
    }
    return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  }

  await db
    .updateTable('mandrill.event')
    .set({ processed_at: new Date() })
    .where('ts', '=', ts)
    .where('_id', '=', _id)
    .where('event', '=', event)
    .execute()

  switch (event) {
    case 'send': {
      await db.updateTable('mail').set({ sent_at: eventTime }).where('mandrill_message_id', '=', _id).execute()
      break
    }
    case 'open': {
      const row = await db
        .selectFrom('mandrill.event as mandrillEvent')
        .innerJoin('mail', 'mail.mandrill_message_id', 'mandrillEvent._id')
        .select((eb) => [eb.ref('mail.id').as('mailId'), eb.ref('mandrillEvent.object').as('object')])
        .where('mandrillEvent.ts', '=', ts)
        .where('mandrillEvent._id', '=', _id)
        .where('mandrillEvent.event', '=', event)
        .executeTakeFirst()

      if (row) {
        const payload = toRecord(row.object)
        const ip = typeof payload?.ip === 'string' ? payload.ip : ''
        const userAgent = typeof payload?.user_agent === 'string' ? payload.user_agent : ''
        const location = (payload?.location ?? null) as Json | null

        await db
          .insertInto('mail_open')
          .values({
            mail_id: row.mailId,
            opened_at: eventTime,
            ip,
            user_agent: userAgent,
            location,
          })
          .execute()
      }
      break
    }
    case 'click': {
      const row = await db
        .selectFrom('mandrill.event as mandrillEvent')
        .innerJoin('mail', 'mail.mandrill_message_id', 'mandrillEvent._id')
        .select((eb) => [eb.ref('mail.id').as('mailId'), eb.ref('mandrillEvent.object').as('object')])
        .where('mandrillEvent.ts', '=', ts)
        .where('mandrillEvent._id', '=', _id)
        .where('mandrillEvent.event', '=', event)
        .executeTakeFirst()

      if (row) {
        const payload = toRecord(row.object)
        const ip = typeof payload?.ip === 'string' ? payload.ip : ''
        const userAgent = typeof payload?.user_agent === 'string' ? payload.user_agent : ''
        const url = typeof payload?.url === 'string' ? payload.url : ''
        const location = (payload?.location ?? null) as Json | null

        await db
          .insertInto('mail_click')
          .values({
            mail_id: row.mailId,
            clicked_at: eventTime,
            ip,
            user_agent: userAgent,
            url,
            location,
          })
          .execute()
      }
      break
    }
    case 'reject': {
      await db.updateTable('mail').set({ rejected_at: eventTime }).where('mandrill_message_id', '=', _id).execute()
      break
    }
    default: {
      if (event === 'hard_bounce' || event === 'soft_bounce') {
        const row = await db
          .selectFrom('mandrill.event as mandrillEvent')
          .innerJoin('mail', 'mail.mandrill_message_id', 'mandrillEvent._id')
          .select((eb) => [eb.ref('mail.id').as('mailId'), eb.ref('mandrillEvent.object').as('object')])
          .where('mandrillEvent.ts', '=', ts)
          .where('mandrillEvent._id', '=', _id)
          .where('mandrillEvent.event', '=', event)
          .executeTakeFirst()

        if (row) {
          const payload = toRecord(row.object)
          const msg =
            payload && typeof payload.msg === 'object' && payload.msg && !Array.isArray(payload.msg)
              ? (payload.msg as Record<string, unknown>)
              : null
          const diagnosis = typeof msg?.diag === 'string' ? msg.diag : null
          const description = typeof msg?.bounce_description === 'string' ? msg.bounce_description : null

          await db
            .insertInto('mail_bounce')
            .values({
              mail_id: row.mailId,
              bounced_at: eventTime,
              bounce_type: event === 'hard_bounce' ? 'hard' : 'soft',
              diagnosis,
              description,
            })
            .execute()
        }
      }
    }
  }
}
