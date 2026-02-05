import type { Kysely, Transaction } from 'kysely'
import { after } from 'next/server'
import type { Database } from '@/lib/db'
import type { Json } from '@/lib/db/generated'
import { dispatchOutboxOnce } from './dispatcher'
import { DEFAULT_OUTBOX_MAX_ATTEMPTS, OUTBOX_STATUS } from './outbox-shared'
import type { WorkflowTaskPayloadMap, WorkflowTaskType } from './types'

type DbExecutor = Kysely<Database> | Transaction<Database>

type EnqueueOptions = {
  dedupeKey?: string
  maxAttempts?: number
  availableAt?: Date
}

export type WorkflowOutboxRecord = {
  id: string
  taskType: WorkflowTaskType
  payload: unknown
  dedupeKey: string | null
  attempts: number
  maxAttempts: number
}

const shouldScheduleAfterDispatch = () => {
  if (process.env.WORKFLOW_OUTBOX_AFTER_ENABLED === 'false') {
    return false
  }

  const requestContext = (globalThis as Record<symbol, unknown>)[Symbol.for('@next/request-context')] as
    | { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined }
    | undefined

  return Boolean(requestContext?.get?.()?.waitUntil)
}

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const enqueueWorkflowTask = async <TTaskType extends WorkflowTaskType>(
  executor: DbExecutor,
  taskType: TTaskType,
  payload: WorkflowTaskPayloadMap[TTaskType],
  options: EnqueueOptions = {}
) => {
  const availableAt = options.availableAt ?? new Date()
  const dedupeKey = options.dedupeKey ?? null
  const maxAttempts = options.maxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS

  const result = await executor
    .insertInto('workflow_outbox')
    .values({
      task_type: taskType,
      payload: payload as Json,
      dedupe_key: dedupeKey,
      status: OUTBOX_STATUS.Pending,
      attempts: 0,
      max_attempts: maxAttempts,
      available_at: availableAt,
    })
    .onConflict((oc) =>
      oc.column('dedupe_key').where('dedupe_key', 'is not', null).doUpdateSet({
        dedupe_key: dedupeKey,
        updated_at: new Date(),
      })
    )
    .returning('id')
    .execute()

  const row = result[0]
  if (!row) {
    throw new Error(`Failed to enqueue workflow outbox task: ${taskType}`)
  }

  if (shouldScheduleAfterDispatch()) {
    try {
      const limit = parsePositiveInt(process.env.WORKFLOW_OUTBOX_AFTER_LIMIT, 5)
      after(() => {
        void dispatchOutboxOnce({ reason: 'after', limit })
      })
    } catch (error) {
      console.warn('Failed to schedule workflow outbox dispatch after response', error)
    }
  }

  return row.id
}
