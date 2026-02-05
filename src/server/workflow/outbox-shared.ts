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

export const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error'
}
