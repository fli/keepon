export type LocalDateTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/

export const parseIsoLocalDateTime = (value: string): LocalDateTime => {
  const trimmed = value.trim()
  const match = ISO_DATE_TIME.exec(trimmed)
  if (!match) {
    throw new Error(`Invalid ISO date-time: ${value}`)
  }

  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match
  const ms = millisecond.padEnd(3, '0')

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(ms),
  }
}

const getTimeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  )

  return asUtc - date.getTime()
}

export const localDateTimeToUtc = (parts: LocalDateTime, timeZone: string): Date => {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond)
  )
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone)

  return new Date(utcGuess.getTime() - offset)
}

export const isoLocalDateTimeToUtc = (value: string, timeZone: string): Date =>
  localDateTimeToUtc(parseIsoLocalDateTime(value), timeZone)

export const addDaysToLocalDateTime = (parts: LocalDateTime, days: number): LocalDateTime => {
  const base = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond)
  )

  base.setUTCDate(base.getUTCDate() + days)

  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    hour: base.getUTCHours(),
    minute: base.getUTCMinutes(),
    second: base.getUTCSeconds(),
    millisecond: base.getUTCMilliseconds(),
  }
}

export const compareLocalDateTimes = (left: LocalDateTime, right: LocalDateTime): number => {
  const leftMs = Date.UTC(left.year, left.month - 1, left.day, left.hour, left.minute, left.second, left.millisecond)
  const rightMs = Date.UTC(
    right.year,
    right.month - 1,
    right.day,
    right.hour,
    right.minute,
    right.second,
    right.millisecond
  )

  if (leftMs === rightMs) {
    return 0
  }

  return leftMs < rightMs ? -1 : 1
}
