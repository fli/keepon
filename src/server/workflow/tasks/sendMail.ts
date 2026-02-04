import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { sendMandrillMessage } from '@/server/workflow/mandrill'

export const handleSendMailTask = async ({ id }: WorkflowTaskPayloadMap['sendMail']) => {
  const mail = await db
    .selectFrom('mail')
    .select((eb) => [
      eb.ref('mail.trainer_id').as('trainerId'),
      eb.ref('mail.client_id').as('clientId'),
      eb.ref('mail.from_email').as('fromEmail'),
      eb.ref('mail.from_name').as('fromName'),
      eb.ref('mail.to_email').as('toEmail'),
      eb.ref('mail.to_name').as('toName'),
      eb.ref('mail.subject').as('subject'),
      eb.ref('mail.html').as('html'),
      eb.ref('mail.reply_to').as('replyTo'),
    ])
    .where('mail.id', '=', id)
    .where('mail.mandrill_message_id', 'is', null)
    .where('mail.queued_at', 'is', null)
    .where('mail.rejected_at', 'is', null)
    .where('mail.sent_at', 'is', null)
    .executeTakeFirst()

  if (!mail) {
    return
  }

  try {
    const sent = await sendMandrillMessage({
      from_email: mail.fromEmail,
      from_name: mail.fromName ?? undefined,
      to: [{ email: mail.toEmail, name: mail.toName ?? undefined }],
      html: mail.html,
      subject: mail.subject,
      metadata: {
        mailId: id,
      },
      headers: mail.replyTo ? { 'Reply-To': mail.replyTo } : undefined,
    })

    const sentAt = sent.status === 'sent' ? new Date() : null
    const rejectedAt = sent.status === 'rejected' ? new Date() : null

    await db
      .updateTable('mail')
      .set({
        queued_at: new Date(),
        sent_at: sentAt,
        rejected_at: rejectedAt,
        reject_reason: sent.reject_reason ?? null,
        mandrill_message_id: sent._id,
      })
      .where('id', '=', id)
      .execute()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await db.updateTable('mail').set({ rejected_at: new Date(), reject_reason: message }).where('id', '=', id).execute()
  }
}
