import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { parseScheduledAt, scheduleNextRecurringTaskSafe } from '@/server/workflow/schedules'

export const handleTagTrialledDidntSubTask = async ({ scheduledAt }: WorkflowTaskPayloadMap['tagTrialledDidntSub']) => {
  const scheduleBase = parseScheduledAt(scheduledAt)

  try {
    await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('trainer')
        .set({ trialled_didnt_sub_mailchimp_tag_applied: true })
        .where('id', 'in', trx.selectFrom('vw_trialled_didnt_sub_trainers').select('trainer_id'))
        .returning('id')
        .execute()

      for (const row of updated) {
        await enqueueWorkflowTask(trx, 'updateMailchimpListMemberTags', {
          trainerId: row.id,
          tags: [{ name: `Trialled didn't sub`, status: 'active' }],
        })
      }
    })
  } finally {
    await scheduleNextRecurringTaskSafe(db, 'tagTrialledDidntSub', scheduleBase)
  }
}
