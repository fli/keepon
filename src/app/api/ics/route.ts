import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

type TimeZoneInfoMap = Record<string, string>

let cachedTimeZoneInfo: TimeZoneInfoMap | null = null

const resolveZoneinfoDir = () => {
  const candidates = [
    path.join(__dirname, '..', 'icalendar', 'zoneinfo'),
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

const formatDateTimeInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? '00'

  return `${lookup('year')}${lookup('month')}${lookup('day')}T${lookup('hour')}${lookup('minute')}${lookup('second')}`
}

const buildDtStamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')

const makeCalendarEvent = (args: {
  title: string
  description?: string
  location?: string
  timeZone: string
  startTime: Date
  endTime: Date
}) => {
  const timeZoneInfo = loadTimeZoneInfo()
  const iCalendarTimeZone = timeZoneInfo[args.timeZone]

  if (!iCalendarTimeZone) {
    return null
  }

  const dtstart = formatDateTimeInTimeZone(args.startTime, args.timeZone)
  const dtend = formatDateTimeInTimeZone(args.endTime, args.timeZone)

  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//getkeepon.com//Online Bookings//Add to Calendar
CALSCALE:GREGORIAN
${iCalendarTimeZone}
BEGIN:VEVENT
DTSTAMP:${buildDtStamp()}
UID:${escapeNewlines(randomUUID())}
DTSTART;TZID=${args.timeZone}:${dtstart}
DTEND;TZID=${args.timeZone}:${dtend}
SUMMARY:${escapeNewlines(args.title)}${
    args.description
      ? `
DESCRIPTION:${escapeNewlines(args.description)}`
      : ''
  }${
    args.location
      ? `
LOCATION:${escapeNewlines(args.location)}`
      : ''
  }
END:VEVENT
END:VCALENDAR`

  return wrapLines(ics)
}

const querySchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  timeZone: z.string().trim().min(1, 'timeZone is required'),
  startTime: z.string().trim().min(1, 'startTime is required'),
  endTime: z.string().trim().min(1, 'endTime is required'),
  description: z.string().optional(),
  location: z.string().optional(),
})

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const query = {
    title: requestUrl.searchParams.get('title'),
    timeZone: requestUrl.searchParams.get('timeZone'),
    startTime: requestUrl.searchParams.get('startTime'),
    endTime: requestUrl.searchParams.get('endTime'),
    description: requestUrl.searchParams.get('description') ?? undefined,
    location: requestUrl.searchParams.get('location') ?? undefined,
  }

  const parsedQuery = querySchema.safeParse(query)

  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail ||
          'Request query parameters did not match the expected schema.',
        type: '/invalid-query-parameters',
      }),
      { status: 400 }
    )
  }

  const startTime = new Date(parsedQuery.data.startTime)
  const endTime = new Date(parsedQuery.data.endTime)

  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid date values',
        detail: 'startTime and endTime must be valid date strings.',
        type: '/invalid-query-parameters',
      }),
      { status: 400 }
    )
  }

  const ics = makeCalendarEvent({
    ...parsedQuery.data,
    startTime,
    endTime,
  })

  if (!ics) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Invalid timezone',
        detail: 'The provided timeZone value is not supported.',
        type: '/invalid-timezone',
      }),
      { status: 500 }
    )
  }

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Disposition': 'attachment; filename="open-to-add-to-calendar.ics"',
      'Content-Type': 'text/calendar; charset=UTF-8',
    },
  })
}
