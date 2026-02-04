import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { processAppleReceipt } from '@/server/appStore/receipts'
import { parseScheduledAt, scheduleNextRecurringTaskSafe } from '@/server/workflow/schedules'

export const handleRefreshAppStoreReceiptsTask = async ({
  scheduledAt,
}: WorkflowTaskPayloadMap['refreshAppStoreReceipts']) => {
  const scheduleBase = parseScheduledAt(scheduledAt)

  try {
    const sharedSecret = process.env.APP_STORE_SHARED_SECRET
    if (!sharedSecret) {
      throw new Error('APP_STORE_SHARED_SECRET is not configured')
    }

    const receipts = await db
      .selectFrom('vw_app_store_latest_receipts')
      .select([
        'original_transaction_id as originalTransactionId',
        'encoded_receipt as encodedReceipt',
        'trainer_id as trainerId',
      ])
      .execute()

    for (const receipt of receipts) {
      await processAppleReceipt({
        trainerId: receipt.trainerId,
        encodedReceipt: receipt.encodedReceipt,
        sharedSecret,
      })
    }
  } finally {
    await scheduleNextRecurringTaskSafe(db, 'refreshAppStoreReceipts', scheduleBase)
  }
}
