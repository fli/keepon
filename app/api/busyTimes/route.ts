import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z, ZodError } from 'zod'

import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'

export const runtime = 'nodejs'

const rawBusyTimeSchema = z.object({
  id: z.string().min(1, 'Busy time id is missing.'),
  start_date: z.coerce.date().nullable(),
  start_time: z.coerce.date().nullable(),
  end_date: z.coerce.date().nullable(),
  end_time: z.coerce.date().nullable(),
})

const rawBusyTimeListSchema = z.array(rawBusyTimeSchema)

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const busyTimeSchema = z.object({
  id: z.string().min(1, 'Busy time id must not be empty.'),
  startDate: z
    .string()
    .refine(
      value => dateOnlyPattern.test(value) || isoDateTimePattern.test(value),
      'startDate must be a YYYY-MM-DD or ISO-8601 datetime string.'
    ),
  endDate: z
    .string()
    .refine(
      value => dateOnlyPattern.test(value) || isoDateTimePattern.test(value),
      'endDate must be a YYYY-MM-DD or ISO-8601 datetime string.'
    ),
  allDay: z.boolean(),
})

const busyTimeListSchema = z.array(busyTimeSchema)

type RawBusyTimeRow = z.infer<typeof rawBusyTimeSchema>
type BusyTime = z.infer<typeof busyTimeSchema>

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10)

const formatUtcDateTime = (date: Date) =>
  date.toISOString().replace(/\.\d{3}Z$/, 'Z')

const ensureDate = (value: Date | null, fieldName: string): Date => {
  if (!value) {
    throw new Error(`${fieldName} is missing from busy time record.`)
  }

  if (Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} is not a valid date.`)
  }

  return value
}

const adaptBusyTimeRow = (row: RawBusyTimeRow): BusyTime => {
  const allDay = row.start_time === null

  const startDate = allDay
    ? formatDateOnly(ensureDate(row.start_date, 'start_date'))
    : formatUtcDateTime(ensureDate(row.start_time, 'start_time'))

  const endDate = allDay
    ? formatDateOnly(ensureDate(row.end_date, 'end_date'))
    : formatUtcDateTime(ensureDate(row.end_time, 'end_time'))

  return {
    id: row.id,
    startDate,
    endDate,
    allDay,
  }
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching busy times',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let rows: unknown
  try {
    rows = await db
      .selectFrom('busy_time')
      .select(['id', 'start_date', 'start_time', 'end_date', 'end_time'])
      .where('trainer_id', '=', authorization.trainerId)
      .execute()
  } catch (error) {
    console.error('Failed to fetch busy times from database', error, {
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch busy times',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  let rawBusyTimes: RawBusyTimeRow[]
  try {
    rawBusyTimes = rawBusyTimeListSchema.parse(rows)
  } catch (error) {
    if (error instanceof ZodError) {
      console.error('Busy time rows did not match expected schema', error, {
        trainerId: authorization.trainerId,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse busy time data from database',
          detail: 'Busy time rows did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Unexpected error while parsing busy time rows', error, {
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to parse busy time data from database',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  let busyTimes: BusyTime[]
  try {
    busyTimes = rawBusyTimes.map(adaptBusyTimeRow)
  } catch (error) {
    console.error('Failed to adapt busy time row', error, {
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to normalize busy time data',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  try {
    const validated = busyTimeListSchema.parse(busyTimes)
    return NextResponse.json(validated)
  } catch (error) {
    if (error instanceof ZodError) {
      console.error('Normalized busy time data failed validation', error, {
        trainerId: authorization.trainerId,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate busy time data',
          detail: 'Busy time data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Unexpected error while validating busy time data', error, {
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to validate busy time data',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
