import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'

export const handleProcessMandrillEventTask = async ({
  ts,
  _id,
  event,
}: WorkflowTaskPayloadMap['processMandrillEvent']) => {
  const eventTime = new Date(ts * 1000)

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
        const payload =
          typeof row.object === 'string' ? (JSON.parse(row.object) as Record<string, unknown>) : row.object
        const ip = typeof payload?.ip === 'string' ? payload.ip : null
        const userAgent = typeof payload?.user_agent === 'string' ? payload.user_agent : null
        const location = payload?.location ?? null

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
        const payload =
          typeof row.object === 'string' ? (JSON.parse(row.object) as Record<string, unknown>) : row.object
        const ip = typeof payload?.ip === 'string' ? payload.ip : null
        const userAgent = typeof payload?.user_agent === 'string' ? payload.user_agent : null
        const url = typeof payload?.url === 'string' ? payload.url : null
        const location = payload?.location ?? null

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
          const payload =
            typeof row.object === 'string' ? (JSON.parse(row.object) as Record<string, unknown>) : row.object
          const msg = typeof payload?.msg === 'object' && payload.msg ? (payload.msg as Record<string, unknown>) : null
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
