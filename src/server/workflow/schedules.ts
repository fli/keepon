import type { Kysely, Transaction } from 'kysely'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db, type Database } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'

type DbExecutor = Kysely<Database> | Transaction<Database>

export type RecurringWorkflowTaskType = Extract<
  keyof WorkflowTaskPayloadMap,
  | 'chargePaymentPlans'
  | 'sendPaymentReminders'
  | 'sendAppointmentReminders'
  | 'refreshAppStoreReceipts'
  | 'tagTrialledDidntSub'
>

type DailyTime = { hour: number; minute: number }

const compareDailyTimes = (a: DailyTime, b: DailyTime) => a.hour - b.hour || a.minute - b.minute

const nextUtcDailyTime = (from: Date, times: DailyTime[]) => {
  const sorted = times.toSorted(compareDailyTimes)
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const day = from.getUTCDate()
  const fromTime = from.getTime()

  for (const time of sorted) {
    const candidate = new Date(Date.UTC(year, month, day, time.hour, time.minute, 0, 0))
    if (candidate.getTime() > fromTime) {
      return candidate
    }
  }

  const nextDay = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0))
  const first = sorted[0]
  return new Date(
    Date.UTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth(), nextDay.getUTCDate(), first.hour, first.minute, 0, 0)
  )
}

const nextUtcHourlyMinute = (from: Date, minutes: number[]) => {
  const sorted = minutes.toSorted((a, b) => a - b)
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const day = from.getUTCDate()
  const hour = from.getUTCHours()
  const fromTime = from.getTime()

  for (const minute of sorted) {
    const candidate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0))
    if (candidate.getTime() > fromTime) {
      return candidate
    }
  }

  const nextHour = new Date(Date.UTC(year, month, day, hour + 1, 0, 0, 0))
  const firstMinute = sorted[0]
  return new Date(
    Date.UTC(
      nextHour.getUTCFullYear(),
      nextHour.getUTCMonth(),
      nextHour.getUTCDate(),
      nextHour.getUTCHours(),
      firstMinute,
      0,
      0
    )
  )
}

const nextUtcMinute = (from: Date) => {
  const next = new Date(from)
  next.setUTCSeconds(0, 0)
  next.setUTCMinutes(next.getUTCMinutes() + 1)
  return next
}

const recurringTaskConfig: Record<RecurringWorkflowTaskType, { maxAttempts: number; nextAt: (from: Date) => Date }> = {
  chargePaymentPlans: {
    maxAttempts: 2,
    nextAt: (from) => nextUtcDailyTime(from, [{ hour: 0, minute: 0 }]),
  },
  sendPaymentReminders: {
    maxAttempts: 1,
    nextAt: (from) => nextUtcHourlyMinute(from, [0, 30]),
  },
  sendAppointmentReminders: {
    maxAttempts: 1,
    nextAt: (from) => nextUtcMinute(from),
  },
  refreshAppStoreReceipts: {
    maxAttempts: 2,
    nextAt: (from) =>
      nextUtcDailyTime(from, [
        { hour: 0, minute: 30 },
        { hour: 12, minute: 30 },
      ]),
  },
  tagTrialledDidntSub: {
    maxAttempts: 1,
    nextAt: (from) => nextUtcHourlyMinute(from, [2, 32]),
  },
}

export const parseScheduledAt = (value?: string | null) => {
  if (!value) {
    return new Date()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export const buildScheduledDedupeKey = (taskType: RecurringWorkflowTaskType, scheduledAt: Date) =>
  `${taskType}:${scheduledAt.toISOString()}`

export const scheduleNextRecurringTask = async (
  executor: DbExecutor,
  taskType: RecurringWorkflowTaskType,
  from: Date
) => {
  const config = recurringTaskConfig[taskType]
  const nextAt = config.nextAt(from)
  const payload: WorkflowTaskPayloadMap[RecurringWorkflowTaskType] = {
    scheduledAt: nextAt.toISOString(),
  }

  await enqueueWorkflowTask(executor, taskType, payload, {
    availableAt: nextAt,
    dedupeKey: buildScheduledDedupeKey(taskType, nextAt),
    maxAttempts: config.maxAttempts,
  })

  return nextAt
}

export const scheduleNextRecurringTaskSafe = async (
  executor: DbExecutor,
  taskType: RecurringWorkflowTaskType,
  from: Date
) => {
  try {
    await scheduleNextRecurringTask(executor, taskType, from)
  } catch (error) {
    console.error(`Failed to schedule next ${taskType} run`, error)
  }
}

export const seedRecurringTasks = async () => {
  const now = new Date()
  for (const taskType of Object.keys(recurringTaskConfig) as RecurringWorkflowTaskType[]) {
    await scheduleNextRecurringTask(db, taskType, now)
  }
}
