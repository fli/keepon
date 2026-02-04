import type { IPostgresInterval } from 'postgres-interval'
import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import parseInterval from 'postgres-interval'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../../_lib/accessToken'

const paramsSchema = z.object({
  id: z.string().trim().min(1, 'iCalendar identifier must not be empty'),
})

const calendarRowSchema = z.object({
  timezone: z.string(),
  dtstamp: z.string(),
  id: z.string(),
  created: z.string(),
  location: z.string(),
  dtstart: z.string(),
  dtend: z.string(),
  description: z.string(),
  summary: z.string(),
})

type CalendarRow = z.infer<typeof calendarRowSchema>

type HandlerContext = { params: Promise<Record<string, string>> }

type TimeZoneInfoMap = Record<string, string>

let cachedTimeZoneInfo: TimeZoneInfoMap | null = null

const resolveZoneinfoDir = () => {
  const candidates = [
    path.join(__dirname, 'zoneinfo'),
    path.join(process.cwd(), 'src', 'app', 'api', 'icalendar', 'zoneinfo'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

const getIcsFromDir = (dir: string): string[] => {
  const dirents = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...getIcsFromDir(fullPath))
    } else if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.ics') {
      files.push(fullPath)
    }
  }

  return files
}

const loadTimeZoneInfo = (): TimeZoneInfoMap => {
  if (cachedTimeZoneInfo) {
    return cachedTimeZoneInfo
  }

  const zoneinfoDir = resolveZoneinfoDir()

  if (!zoneinfoDir) {
    cachedTimeZoneInfo = {}
    return cachedTimeZoneInfo
  }

  const map: TimeZoneInfoMap = {}

  try {
    const calFiles = getIcsFromDir(zoneinfoDir)

    for (const file of calFiles) {
      const data = fs.readFileSync(file, { encoding: 'utf8' })
      const match = /(?:^|\n)(BEGIN:VTIMEZONE\n[\s\S]+?\nEND:VTIMEZONE)(?:$|\n)/.exec(data)
      if (!match) {
        continue
      }

      const tzName = path.relative(zoneinfoDir, file).replace(/\.[^/.]+$/, '')
      const tzData = match[1].replace(/(\nTZID:)(.+?)(\n\S)/, `$1${tzName}$3`)
      map[tzName] = tzData
    }
  } catch (error) {
    console.error('Failed to load iCalendar timezone data', error)
  }

  cachedTimeZoneInfo = map
  return map
}

const wrapLines = (input: string) => {
  const lines = input.split('\n')
  const result: string[] = []

  for (const line of lines) {
    let octetCount = 0
    let extraLines = false
    let startIndex = 0

    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i)
      const toAdd = code > 0xff ? 2 : 1
      octetCount += toAdd

      if (octetCount > 75) {
        octetCount = 1 + toAdd
        if (extraLines) {
          result.push(' ' + line.slice(startIndex, i))
        } else {
          result.push(line.slice(0, i))
        }
        startIndex = i
        extraLines = true
      }
    }

    result.push(`${extraLines ? ' ' : ''}${line.slice(startIndex)}`)
  }

  return result.join('\n')
}

const escapeNewlines = (value: string) => value.replaceAll(/\n/g, '\\n')

const padNumber = (value: number, size = 2) => value.toString().padStart(size, '0')

const formatIcsUtc = (date: Date) =>
  `${date.getUTCFullYear()}${padNumber(date.getUTCMonth() + 1)}${padNumber(date.getUTCDate())}T${padNumber(
    date.getUTCHours()
  )}${padNumber(date.getUTCMinutes())}${padNumber(date.getUTCSeconds())}Z`

const formatIcsLocal = (date: Date, timeZone: string) => {
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

  return `${values.year}${values.month}${values.day}T${values.hour}${values.minute}${values.second}`
}

const intervalToMilliseconds = (value: unknown) => {
  if (!value) {
    return 0
  }

  const interval: IPostgresInterval = typeof value === 'string' ? parseInterval(value) : (value as IPostgresInterval)

  const years = interval.years ?? 0
  const months = interval.months ?? 0
  const days = interval.days ?? 0
  const hours = interval.hours ?? 0
  const minutes = interval.minutes ?? 0
  const seconds = interval.seconds ?? 0
  const milliseconds = interval.milliseconds ?? 0

  const totalDays = years * 365 + months * 30 + days

  return totalDays * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000 + milliseconds
}

const buildEventBlock = (row: CalendarRow) => `BEGIN:VEVENT
DTSTAMP:${escapeNewlines(row.dtstamp)}
UID:${escapeNewlines(row.id)}
CREATED:${escapeNewlines(row.created)}
DESCRIPTION:${escapeNewlines(row.description)}
LOCATION:${escapeNewlines(row.location)}
SUMMARY:${escapeNewlines(row.summary)}
DTSTART;TZID=${row.timezone}:${escapeNewlines(row.dtstart)}
DTEND;TZID=${row.timezone}:${escapeNewlines(row.dtend)}
END:VEVENT`

const resolveProdIdHost = () => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  try {
    return new URL(base).hostname
  } catch (error) {
    console.error('Invalid BASE_URL; falling back to getkeepon.com', {
      base,
      error,
    })
    return 'getkeepon.com'
  }
}

export async function GET(_request: Request, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { id } = parsedParams.data

  try {
    const trainer = await db.selectFrom('trainer').select('id').where('icalendar_url_slug', '=', id).executeTakeFirst()

    if (!trainer) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'iCalendar feed not found.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const sessions = await db
      .selectFrom('session')
      .innerJoin('session_series', 'session_series.id', 'session.session_series_id')
      .select((eb) => [
        eb.ref('session.id').as('id'),
        eb.ref('session.timezone').as('timezone'),
        eb.ref('session.created_at').as('createdAt'),
        eb.ref('session.start').as('start'),
        eb.ref('session.duration').as('duration'),
        eb.ref('session.location').as('location'),
        eb.ref('session.note').as('note'),
        eb.ref('session_series.name').as('seriesName'),
        eb.ref('session_series.event_type').as('eventType'),
      ])
      .where('session_series.trainer_id', '=', trainer.id)
      .execute()

    const sessionIds = sessions.map((session) => session.id)
    const clientNameBySessionId = new Map<string, string>()

    if (sessionIds.length > 0) {
      const counts = await db
        .selectFrom('client_session')
        .select((eb) => [eb.ref('client_session.session_id').as('sessionId'), eb.fn.countAll<number>().as('count')])
        .where('client_session.session_id', 'in', sessionIds)
        .groupBy('client_session.session_id')
        .execute()

      const singleSessionIds = counts
        .filter((row) => Number(row.count) === 1)
        .map((row) => row.sessionId)
        .filter((value): value is string => Boolean(value))

      if (singleSessionIds.length > 0) {
        const clientRows = await db
          .selectFrom('client_session')
          .innerJoin('client', 'client.id', 'client_session.client_id')
          .select((eb) => [
            eb.ref('client_session.session_id').as('sessionId'),
            eb.ref('client.first_name').as('firstName'),
            eb.ref('client.last_name').as('lastName'),
          ])
          .where('client_session.session_id', 'in', singleSessionIds)
          .execute()

        for (const row of clientRows) {
          const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim()
          if (row.sessionId && name) {
            clientNameBySessionId.set(row.sessionId, name)
          }
        }
      }
    }

    const dtstamp = formatIcsUtc(new Date())

    const calendarRows = z.array(calendarRowSchema).parse(
      sessions.map((session) => {
        const start = session.start instanceof Date ? session.start : new Date(session.start)
        const createdAt = session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt)
        const durationMs = intervalToMilliseconds(session.duration)
        const end = new Date(start.getTime() + durationMs)

        const clientName = clientNameBySessionId.get(session.id)
        const summary =
          session.seriesName ??
          (session.eventType === 'single_session'
            ? clientName
              ? `${clientName} - Appointment`
              : 'Appointment'
            : session.eventType === 'group_session'
              ? 'Group Appointment'
              : 'Event')

        const description = `${session.note ?? ''}\nThis is a Keepon appointment, please edit this event in the Keepon app.`

        return {
          timezone: session.timezone,
          dtstamp,
          id: session.id,
          created: formatIcsUtc(createdAt),
          location: session.location ?? '',
          dtstart: formatIcsLocal(start, session.timezone),
          dtend: formatIcsLocal(end, session.timezone),
          description,
          summary,
        }
      })
    )

    const timeZoneInfo = loadTimeZoneInfo()
    const uniqueTimeZones = Array.from(new Set(calendarRows.map((row) => row.timezone)))
    const timeZoneBlocks = uniqueTimeZones.map((tz) => timeZoneInfo[tz]).filter(Boolean)

    const eventBlocks = calendarRows.map(buildEventBlock)

    const calendarBody = wrapLines(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//${resolveProdIdHost()}//Calendar
CALSCALE:GREGORIAN
X-WR-CALNAME:Keepon${timeZoneBlocks.length === 0 ? '' : '\n' + timeZoneBlocks.join('\n').trim()}${
      eventBlocks.length === 0 ? '' : '\n' + eventBlocks.join('\n').trim()
    }
END:VCALENDAR
`)

    return new Response(calendarBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse calendar data from database',
          detail: 'Calendar data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to generate iCalendar feed', { id, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to generate iCalendar feed',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
