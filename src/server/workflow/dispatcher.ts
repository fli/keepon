import { start } from 'workflow/api'
import { db } from '@/lib/db'
import { processOutboxTaskWorkflow } from '@/workflows/outbox/process-task'
import { DEFAULT_OUTBOX_MAX_ATTEMPTS, normalizeErrorMessage, OUTBOX_STATUS } from './outbox-shared'
import { parseWorkflowTaskPayload, workflowTaskTypeSchema } from './types'

const parseOptionalNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DISPATCH_INTERVAL_MS = parseOptionalNumber(process.env.WORKFLOW_OUTBOX_POLL_INTERVAL_MS, 1_500)
const CLAIM_BATCH_SIZE = parseOptionalNumber(process.env.WORKFLOW_OUTBOX_CLAIM_BATCH_SIZE, 20)
const DISPATCH_CONCURRENCY = parseOptionalNumber(process.env.WORKFLOW_OUTBOX_DISPATCH_CONCURRENCY, 4)
const LOCK_TIMEOUT_SECONDS = 120
const MISSING_RELATION_CODE = '42P01'

type WorkflowOutboxRecord = {
  id: string
  taskType: string
  payload: unknown
  dedupeKey: string | null
  attempts: number
  maxAttempts: number
}

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

const claimPendingOutboxRows = async (
  workerId: string,
  limit: number = CLAIM_BATCH_SIZE
): Promise<WorkflowOutboxRecord[]> => {
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
      .limit(limit)
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
  const baseDelaySeconds = Math.min(3_600, Math.max(5, 2 ** Math.max(0, record.attempts - 1)))
  const jitter = 0.8 + Math.random() * 0.4
  const retryDelaySeconds = Math.min(3_600, Math.max(5, Math.round(baseDelaySeconds * jitter)))

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

const dispatchOutboxRecords = async (records: WorkflowOutboxRecord[], concurrency: number) => {
  if (records.length === 0) {
    return
  }

  const queue = [...records]
  const workerCount = Math.max(1, Math.min(concurrency, queue.length))

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const record = queue.shift()
      if (!record) {
        return
      }
      await dispatchOutboxRecord(record)
    }
  })

  await Promise.allSettled(workers)
}

const runDispatchCycle = async (workerId: string, limit = CLAIM_BATCH_SIZE, concurrency = DISPATCH_CONCURRENCY) => {
  await ensureStaleDispatchesAreReleased()

  const records = await claimPendingOutboxRows(workerId, limit)
  await dispatchOutboxRecords(records, concurrency)

  return records.length
}

let isDispatchCycleRunning = false
let isDispatcherDisabled = false

export const dispatchOutboxOnce = async (
  options: {
    workerId?: string
    limit?: number
    concurrency?: number
    reason?: string
  } = {}
) => {
  if (isDispatcherDisabled) {
    return { claimed: 0, skipped: true, reason: 'disabled' as const }
  }

  if (isDispatchCycleRunning) {
    return { claimed: 0, skipped: true, reason: 'busy' as const }
  }

  isDispatchCycleRunning = true
  try {
    const workerId = options.workerId ?? `pid:${process.pid}`
    const limit = options.limit ?? CLAIM_BATCH_SIZE
    const concurrency = options.concurrency ?? DISPATCH_CONCURRENCY
    const claimed = await runDispatchCycle(workerId, limit, concurrency)
    return { claimed, skipped: false as const, reason: options.reason ?? 'manual' }
  } catch (error) {
    if (isMissingOutboxTableError(error)) {
      isDispatcherDisabled = true
      console.warn(
        'Workflow outbox dispatcher is disabled because workflow_outbox table does not exist yet. Apply migrations to enable it.'
      )
      return { claimed: 0, skipped: true, reason: 'missing_table' as const }
    }

    console.error('Workflow outbox dispatch cycle failed', error)
    return { claimed: 0, skipped: true, reason: 'error' as const }
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
    void dispatchOutboxOnce({ workerId, reason: 'poller' })
  }, DISPATCH_INTERVAL_MS)

  timer.unref?.()

  void dispatchOutboxOnce({ workerId, reason: 'poller' })

  return () => {
    clearInterval(timer)
  }
}
