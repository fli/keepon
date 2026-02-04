import { start } from 'workflow/api'
import { db } from '@/lib/db'
import { processOutboxTaskWorkflow } from '@/workflows/outbox/process-task'
import { DEFAULT_OUTBOX_MAX_ATTEMPTS, normalizeErrorMessage, OUTBOX_STATUS, type WorkflowOutboxRecord } from './outbox'
import { parseWorkflowTaskPayload, workflowTaskTypeSchema } from './types'

const DISPATCH_INTERVAL_MS = 1_500
const CLAIM_BATCH_SIZE = 20
const LOCK_TIMEOUT_SECONDS = 120
const MISSING_RELATION_CODE = '42P01'

const isMissingOutboxTableError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  const maybeCode = (error as { code?: unknown }).code
  if (maybeCode === MISSING_RELATION_CODE) {
    return true
  }

  return error.message.includes('relation "workflow_outbox" does not exist')
}

const ensureStaleDispatchesAreReleased = async () => {
  const now = new Date()
  const staleCutoff = new Date(Date.now() - LOCK_TIMEOUT_SECONDS * 1000)

  await db
    .updateTable('workflow_outbox')
    .set({
      status: OUTBOX_STATUS.Pending,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .where('status', '=', OUTBOX_STATUS.Dispatching)
    .where('locked_at', '<', staleCutoff)
    .execute()
}

const claimPendingOutboxRows = async (workerId: string): Promise<WorkflowOutboxRecord[]> => {
  return db.transaction().execute(async (trx) => {
    const now = new Date()
    const rows = await trx
      .selectFrom('workflow_outbox')
      .select((eb) => [
        eb.ref('workflow_outbox.id').as('id'),
        eb.ref('workflow_outbox.task_type').as('taskType'),
        eb.ref('workflow_outbox.payload').as('payload'),
        eb.ref('workflow_outbox.dedupe_key').as('dedupeKey'),
        eb.ref('workflow_outbox.attempts').as('attempts'),
        eb.ref('workflow_outbox.max_attempts').as('maxAttempts'),
      ])
      .where('workflow_outbox.status', '=', OUTBOX_STATUS.Pending)
      .where('workflow_outbox.available_at', '<=', now)
      .whereRef('workflow_outbox.attempts', '<', 'workflow_outbox.max_attempts')
      .orderBy('workflow_outbox.available_at', 'asc')
      .orderBy('workflow_outbox.created_at', 'asc')
      .limit(CLAIM_BATCH_SIZE)
      .forUpdate()
      .skipLocked()
      .execute()

    if (rows.length === 0) {
      return []
    }

    const ids = rows.map((row) => row.id)

    await trx
      .updateTable('workflow_outbox')
      .set((eb) => ({
        status: OUTBOX_STATUS.Dispatching,
        locked_at: now,
        locked_by: workerId,
        attempts: eb('attempts', '+', 1),
        updated_at: now,
      }))
      .where('id', 'in', ids)
      .execute()

    return rows.map((row) => ({
      ...row,
      attempts: Number(row.attempts) + 1,
    }))
  })
}

const markOutboxRowAsDispatched = async (outboxId: string, runId: string) => {
  const now = new Date()
  await db
    .updateTable('workflow_outbox')
    .set({
      status: OUTBOX_STATUS.Dispatched,
      dispatched_at: now,
      workflow_run_id: runId,
      locked_at: null,
      locked_by: null,
      updated_at: now,
      last_error: null,
    })
    .where('id', '=', outboxId)
    .execute()
}

const markOutboxRowAsFailedToDispatch = async (record: WorkflowOutboxRecord, error: unknown) => {
  const message = normalizeErrorMessage(error)
  const hasAttemptsRemaining = record.attempts < (record.maxAttempts || DEFAULT_OUTBOX_MAX_ATTEMPTS)
  const retryDelaySeconds = Math.min(3_600, Math.max(5, 2 ** Math.max(0, record.attempts - 1)))

  if (!hasAttemptsRemaining) {
    const now = new Date()
    await db
      .updateTable('workflow_outbox')
      .set({
        status: OUTBOX_STATUS.Failed,
        failed_at: now,
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', record.id)
      .execute()

    return
  }

  const now = new Date()
  const retryAt = new Date(Date.now() + retryDelaySeconds * 1000)
  await db
    .updateTable('workflow_outbox')
    .set({
      status: OUTBOX_STATUS.Pending,
      available_at: retryAt,
      last_error: message,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .where('id', '=', record.id)
    .execute()
}

const dispatchOutboxRecord = async (record: WorkflowOutboxRecord) => {
  try {
    const taskType = workflowTaskTypeSchema.parse(record.taskType)
    const payload = parseWorkflowTaskPayload(taskType, record.payload)

    const run = await start(processOutboxTaskWorkflow, [
      {
        outboxId: record.id,
        taskType,
        payload,
        dedupeKey: record.dedupeKey,
      },
    ])

    await markOutboxRowAsDispatched(record.id, run.runId)
  } catch (error) {
    await markOutboxRowAsFailedToDispatch(record, error)
  }
}

const runDispatchCycle = async (workerId: string) => {
  await ensureStaleDispatchesAreReleased()

  const records = await claimPendingOutboxRows(workerId)
  if (records.length === 0) {
    return
  }

  for (const record of records) {
    await dispatchOutboxRecord(record)
  }
}

let isDispatchCycleRunning = false
let isDispatcherDisabled = false

const runDispatchCycleSafely = async (workerId: string) => {
  if (isDispatcherDisabled) {
    return
  }

  if (isDispatchCycleRunning) {
    return
  }

  isDispatchCycleRunning = true
  try {
    await runDispatchCycle(workerId)
  } catch (error) {
    if (isMissingOutboxTableError(error)) {
      isDispatcherDisabled = true
      console.warn(
        'Workflow outbox dispatcher is disabled because workflow_outbox table does not exist yet. Apply migrations to enable it.'
      )
      return
    }

    console.error('Workflow outbox dispatch cycle failed', error)
  } finally {
    isDispatchCycleRunning = false
  }
}

export const startWorkflowOutboxDispatcher = () => {
  if (process.env.WORKFLOW_OUTBOX_DISPATCHER_ENABLED === 'false') {
    return () => void 0
  }

  const workerId = `pid:${process.pid}`
  const timer = setInterval(() => {
    void runDispatchCycleSafely(workerId)
  }, DISPATCH_INTERVAL_MS)

  timer.unref?.()

  void runDispatchCycleSafely(workerId)

  return () => {
    clearInterval(timer)
  }
}
