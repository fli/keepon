import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .or(
    z.object({
      lat: z.null(),
      lng: z.null(),
    })
  )

const recentLocationSchema = z.object({
  location: z.string(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
})

const recentLocationListSchema = z.array(recentLocationSchema)

type RawLocationRow = {
  location: string | null
  address: string | null
  geo: unknown
  googlePlaceId: string | null
  createdAt: Date | string
}

type NormalizedLocationRow = {
  location: string
  address: string | null
  geo: z.infer<typeof geoSchema> | null
  googlePlaceId: string | null
  createdAt: Date
}

const parseTimestamp = (value: unknown) => {
  if (value instanceof Date) {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return null
}

const normalizeGeo = (value: unknown): z.infer<typeof geoSchema> | null => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    const match = trimmed.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/)
    if (match && match[1] !== undefined && match[2] !== undefined) {
      const lat = Number.parseFloat(match[1])
      const lng = Number.parseFloat(match[2])
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        return { lat, lng }
      }
    }
    return null
  }

  if (Array.isArray(value) && value.length >= 2) {
    const arrayValue: readonly unknown[] = value
    const first = arrayValue[0]
    const second = arrayValue[1]
    const lat = typeof first === 'number' ? first : typeof first === 'string' ? Number.parseFloat(first) : undefined
    const lng = typeof second === 'number' ? second : typeof second === 'string' ? Number.parseFloat(second) : undefined
    if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng }
    }
    return null
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('lat' in record && 'lng' in record) {
      const latValue = record.lat
      const lngValue = record.lng
      const lat =
        typeof latValue === 'number'
          ? latValue
          : typeof latValue === 'string'
            ? Number.parseFloat(latValue)
            : latValue === null
              ? null
              : undefined
      const lng =
        typeof lngValue === 'number'
          ? lngValue
          : typeof lngValue === 'string'
            ? Number.parseFloat(lngValue)
            : lngValue === null
              ? null
              : undefined
      if (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
        return { lat, lng }
      }
      if (lat === null && lng === null) {
        return { lat: null, lng: null }
      }
    }
    if ('x' in record && 'y' in record) {
      const lat =
        typeof record.x === 'number' ? record.x : typeof record.x === 'string' ? Number.parseFloat(record.x) : undefined
      const lng =
        typeof record.y === 'number' ? record.y : typeof record.y === 'string' ? Number.parseFloat(record.y) : undefined
      if (lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng)) {
        return { lat, lng }
      }
    }
  }

  return null
}

const dedupeAndSortLocations = (rows: RawLocationRow[]) => {
  const map = new Map<string, NormalizedLocationRow>()

  for (const row of rows) {
    const location = typeof row.location === 'string' && row.location.length > 0 ? row.location : null

    if (!location) {
      continue
    }

    const createdAt = parseTimestamp(row.createdAt)
    if (!createdAt) {
      continue
    }

    const existing = map.get(location)
    if (!existing || createdAt.getTime() > existing.createdAt.getTime()) {
      map.set(location, {
        location,
        address: row.address ?? null,
        geo: normalizeGeo(row.geo),
        googlePlaceId: row.googlePlaceId ?? null,
        createdAt,
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function GET(request: Request) {
  try {
    const authorization = await authenticateTrainerRequest(request, {
      extensionFailureLogMessage: 'Failed to extend access token expiry while fetching recent locations',
    })
    if (!authorization.ok) {
      return authorization.response
    }
    const { trainerId } = authorization

    const [sessionRows, serviceRows] = await Promise.all([
      db
        .selectFrom('session')
        .select(({ ref }) => [
          ref('session.location').as('location'),
          ref('session.address').as('address'),
          ref('session.geo').as('geo'),
          ref('session.google_place_id').as('googlePlaceId'),
          ref('session.created_at').as('createdAt'),
        ])
        .where('session.trainer_id', '=', trainerId)
        .where('session.location', 'is not', null)
        .execute(),
      db
        .selectFrom('service')
        .select(({ ref }) => [
          ref('service.location').as('location'),
          ref('service.address').as('address'),
          ref('service.geo').as('geo'),
          ref('service.google_place_id').as('googlePlaceId'),
          ref('service.created_at').as('createdAt'),
        ])
        .where('service.trainer_id', '=', trainerId)
        .where('service.location', 'is not', null)
        .execute(),
    ])

    const combinedRows: RawLocationRow[] = [...sessionRows, ...serviceRows].map((row) => ({
      location: row.location ?? null,
      address: row.address ?? null,
      geo: row.geo ?? null,
      googlePlaceId: row.googlePlaceId ?? null,
      createdAt: row.createdAt,
    }))

    const normalizedRows = dedupeAndSortLocations(combinedRows)

    const responseBody = recentLocationListSchema.parse(
      normalizedRows.map((row) => ({
        location: row.location,
        address: row.address,
        geo: row.geo,
        googlePlaceId: row.googlePlaceId,
      }))
    )

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse recent locations from database',
          detail: 'Recent location data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch recent locations', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch recent locations',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
