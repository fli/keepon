import type { Kysely, Transaction } from 'kysely'
import type { Database } from '@/lib/db'
import type { WorkflowTaskPayloadMap, WorkflowTaskType } from './types'

export const OUTBOX_STATUS = {
  Pending: 'pending',
  Dispatching: 'dispatching',
  Dispatched: 'dispatched',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS]

export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 25

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
      payload,
      dedupe_key: dedupeKey,
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

  return row.id
}

export const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error'
}
