import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'

export const runtime = 'nodejs'

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
    } else if (
      dirent.isFile() &&
      path.extname(dirent.name).toLowerCase() === '.ics'
    ) {
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
      const match = /(?:^|\n)(BEGIN:VTIMEZONE\n[\s\S]+?\nEND:VTIMEZONE)(?:$|\n)/.exec(
        data
      )
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

const escapeNewlines = (value: string) => value.replace(/\n/g, '\\n')

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
    const detail = parsedParams.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { id } = parsedParams.data

  try {
    const trainer = await db
      .selectFrom('trainer')
      .select('id')
      .where('icalendar_url_slug', '=', id)
      .executeTakeFirst()

    if (!trainer) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'iCalendar feed not found',
          detail: 'No iCalendar feed exists for the provided identifier.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const calendarRowsResult = await sql<CalendarRow>`
      SELECT
        session.timezone,
        to_char(timezone('UTC', NOW()), 'YYYYMMDD"T"HH24MISS"Z"') AS dtstamp,
        session.id,
        to_char(timezone('UTC', session.created_at), 'YYYYMMDD"T"HH24MISS"Z"') AS created,
        COALESCE(session.location, '') AS location,
        to_char(timezone(session.timezone, session.start), 'YYYYMMDD"T"HH24MISS') AS dtstart,
        to_char(timezone(session.timezone, session.start + session.duration), 'YYYYMMDD"T"HH24MISS') AS dtend,
        COALESCE(session.note, '') || '\nThis is a Keepon appointment, please edit this event in the Keepon app.' AS description,
        COALESCE(session_series.name,
          CASE session_series.event_type
            WHEN 'single_session' THEN
              COALESCE(
                (
                  SELECT first_name || CASE WHEN last_name IS NULL THEN '' ELSE ' ' || last_name END || ' - Appointment'
                    FROM client
                    JOIN (
                      SELECT *
                        FROM (
                          SELECT session_id, (array_agg(client_id))[1] AS client_id, count(*) AS count
                            FROM client_session
                           GROUP BY session_id
                        ) cs_
                       WHERE count = 1
                    ) cs ON client.id = cs.client_id
                   WHERE cs.session_id = session.id
                ),
                'Appointment'
              )
            WHEN 'group_session' THEN 'Group Appointment'
            WHEN 'event' THEN 'Event'
          END
        ) AS summary
      FROM session
      JOIN session_series ON session_series.id = session.session_series_id
      WHERE session_series.trainer_id = ${trainer.id}
    `.execute(db)

    const calendarRows = z.array(calendarRowSchema).parse(calendarRowsResult.rows)

    const timeZoneInfo = loadTimeZoneInfo()
    const uniqueTimeZones = Array.from(
      new Set(calendarRows.map(row => row.timezone))
    )
    const timeZoneBlocks = uniqueTimeZones
      .map(tz => timeZoneInfo[tz])
      .filter(Boolean)

    const eventBlocks = calendarRows.map(buildEventBlock)

    const calendarBody = wrapLines(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//${resolveProdIdHost()}//Calendar
CALSCALE:GREGORIAN
X-WR-CALNAME:Keepon${
      timeZoneBlocks.length === 0 ? '' : '\n' + timeZoneBlocks.join('\n').trim()
    }${
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
