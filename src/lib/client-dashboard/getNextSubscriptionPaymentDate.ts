import { addDays, differenceInMilliseconds } from 'date-fns'

export function getNextSubscriptionPaymentDate({
  start,
  after,
  daysBetweenPayments,
}: {
  start: Date
  after?: Date
  daysBetweenPayments: number
}) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const anchor = after ?? new Date()
  const diff = differenceInMilliseconds(anchor, start)
  if (diff < 0) {
    return start
  }

  const millisecondsBetweenPayments = daysBetweenPayments * millisecondsPerDay
  const numPayments = Math.floor(diff / millisecondsBetweenPayments)
  const lastPaymentDate = numPayments * millisecondsBetweenPayments + +start
  return addDays(lastPaymentDate, daysBetweenPayments)
}
