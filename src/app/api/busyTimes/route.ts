import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid ISO date format (expected YYYY-MM-DD)')

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

const isoDateTimeString = z
  .string()
  .datetime({ offset: true, message: 'Invalid ISO date-time string' })

const dateOrDateTimeSchema = z.union([isoDateString, isoDateTimeString])

const busyTimeSchema = z.object({
  id: z.string(),
  startDate: dateOrDateTimeSchema,
  endDate: dateOrDateTimeSchema,
  allDay: z.boolean(),
})

const busyTimeListSchema = z.array(busyTimeSchema)

const requestBusyTimeSchema = z
  .object({
    startDate: dateOrDateTimeSchema,
    endDate: dateOrDateTimeSchema,
    allDay: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.allDay) {
      if (!isoDateTimeString.safeParse(value.startDate).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'startDate must be a full ISO date-time string with timezone when allDay is false.',
          path: ['startDate'],
        })
      }
      if (!isoDateTimeString.safeParse(value.endDate).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'endDate must be a full ISO date-time string with timezone when allDay is false.',
          path: ['endDate'],
        })
      }
    }
  })

const requestBodySchema = z.array(requestBusyTimeSchema)

type BusyTimeRow = {
  id: string | null
  startDate: Date | string | null
  startTime: Date | string | null
  endDate: Date | string | null
  endTime: Date | string | null
}

const ensureDate = (value: Date | string | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`)
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label}`)
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`Invalid ${label}`)
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${label}`)
    }
    return parsed
  }

  throw new Error(`Invalid ${label}`)
}

const formatIsoDate = (value: Date) => value.toISOString().slice(0, 10)

const formatIsoDateTime = (value: Date) => value.toISOString()

const normalizeRow = (row: BusyTimeRow) => {
  if (!row.id) {
    throw new Error('Encountered busy time without an id')
  }

  const allDay = row.startTime === null

  return {
    id: row.id,
    allDay,
    startDate: allDay
      ? formatIsoDate(ensureDate(row.startDate, 'start date'))
      : formatIsoDateTime(ensureDate(row.startTime, 'start time')),
    endDate:
      row.endTime === null
        ? formatIsoDate(ensureDate(row.endDate, 'end date'))
        : formatIsoDateTime(ensureDate(row.endTime, 'end time')),
  }
}

const buildBusyTimeResponse = (rows: BusyTimeRow[]) =>
  busyTimeListSchema.parse(rows.map(normalizeRow))

type BusyTimeInsertValues = {
  trainer_id: string
  start_date: Date | null
  end_date: Date | null
  start_time: Date | null
  end_time: Date | null
}

class InvalidBusyTimeInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBusyTimeInputError'
  }
}

const formatZodIssues = (issues: z.ZodIssue[]) =>
  issues
    .map(issue => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const parseIsoCalendarDate = (value: string, label: string) => {
  const match = isoDatePattern.exec(value.slice(0, 10))
  if (!match) {
    throw new InvalidBusyTimeInputError(
      `${label} must be a valid ISO date (YYYY-MM-DD).`
    )
  }

  const [, yearStr, monthStr, dayStr] = match
  if (!yearStr || !monthStr || !dayStr) {
    throw new InvalidBusyTimeInputError(
      `${label} must be a valid ISO date (YYYY-MM-DD).`
    )
  }

  const year = Number.parseInt(yearStr, 10)
  const month = Number.parseInt(monthStr, 10)
  const day = Number.parseInt(dayStr, 10)

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12
  ) {
    throw new InvalidBusyTimeInputError(
      `${label} must be a valid ISO date (YYYY-MM-DD).`
    )
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > maxDay) {
    throw new InvalidBusyTimeInputError(
      `${label} must be a valid calendar date.`
    )
  }

  return { year, month, day }
}

const ensureAllDayDate = (value: string, label: string) => {
  const { year, month, day } = parseIsoCalendarDate(value, label)
  return new Date(Date.UTC(year, month - 1, day))
}

const ensureDateTimeValue = (value: string, label: string) => {
  parseIsoCalendarDate(value, label)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidBusyTimeInputError(
      `${label} must be a valid ISO date-time with timezone.`
    )
  }
  return parsed
}

const buildInsertValues = (
  items: z.infer<typeof requestBodySchema>,
  trainerId: string
): BusyTimeInsertValues[] =>
  items.map((item, index) => {
    const prefix = `body[${index}]`
    if (item.allDay) {
      const startDate = ensureAllDayDate(item.startDate, `${prefix}.startDate`)
      const endDate = ensureAllDayDate(item.endDate, `${prefix}.endDate`)

      if (endDate.getTime() < startDate.getTime()) {
        throw new InvalidBusyTimeInputError(
          `${prefix}.endDate must be on or after startDate.`
        )
      }

      return {
        trainer_id: trainerId,
        start_date: startDate,
        end_date: endDate,
        start_time: null,
        end_time: null,
      }
    }

    const startTime = ensureDateTimeValue(
      item.startDate,
      `${prefix}.startDate`
    )
    const endTime = ensureDateTimeValue(item.endDate, `${prefix}.endDate`)

    if (endTime.getTime() < startTime.getTime()) {
      throw new InvalidBusyTimeInputError(
        `${prefix}.endDate must be on or after startDate.`
      )
    }

    return {
      trainer_id: trainerId,
      start_date: null,
      end_date: null,
      start_time: startTime,
      end_time: endTime,
    }
  })

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching busy times',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rows = (await db
      .selectFrom('busy_time')
      .select(({ ref }) => [
        ref('busy_time.id').as('id'),
        ref('busy_time.start_date').as('startDate'),
        ref('busy_time.start_time').as('startTime'),
        ref('busy_time.end_date').as('endDate'),
        ref('busy_time.end_time').as('endTime'),
      ])
      .where('busy_time.trainer_id', '=', authorization.trainerId)
      .orderBy('busy_time.start_date')
      .orderBy('busy_time.start_time')
      .execute()) as BusyTimeRow[]
    const busyTimes = buildBusyTimeResponse(rows)

    return NextResponse.json(busyTimes)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse busy time data from database',
          detail: 'Busy time data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch busy times', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch busy times',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestBodySchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = formatZodIssues(validation.error.issues)
      return createInvalidBodyResponse(detail)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse busy time request body', error)
    return createInvalidJsonResponse()
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while updating busy times',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let insertValues: BusyTimeInsertValues[] = []
  try {
    insertValues =
      parsedBody.length > 0
        ? buildInsertValues(parsedBody, authorization.trainerId)
        : []
  } catch (error) {
    if (error instanceof InvalidBusyTimeInputError) {
      return createInvalidBodyResponse(error.message)
    }
    throw error
  }

  try {
    const busyTimes = await db.transaction().execute(async trx => {
      await trx
        .deleteFrom('busy_time')
        .where('trainer_id', '=', authorization.trainerId)
        .execute()

      if (insertValues.length > 0) {
        await trx.insertInto('busy_time').values(insertValues).execute()
      }

      const rows = (await trx
        .selectFrom('busy_time')
        .select(({ ref }) => [
          ref('busy_time.id').as('id'),
          ref('busy_time.start_date').as('startDate'),
          ref('busy_time.start_time').as('startTime'),
          ref('busy_time.end_date').as('endDate'),
          ref('busy_time.end_time').as('endTime'),
        ])
        .where('busy_time.trainer_id', '=', authorization.trainerId)
        .orderBy('busy_time.start_date')
        .orderBy('busy_time.start_time')
        .execute()) as BusyTimeRow[]
      return buildBusyTimeResponse(rows)
    })

    return NextResponse.json(busyTimes)
  } catch (error) {
    if (error instanceof InvalidBusyTimeInputError) {
      return createInvalidBodyResponse(error.message)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse busy time data from database',
          detail: 'Busy time data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update busy times', {
      error,
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update busy times',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
