import { headers } from 'next/headers'
import { NextResponse, connection } from 'next/server'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

const positionSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()
  .optional()

const geolocationSchema = z.object({
  country: z.string().nullable().optional(),
  subdivision: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  position: positionSchema,
})

const sanitizeHeaderValue = (value: string | null) => {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const parsePositionHeader = (rawValue: string | null) => {
  const sanitized = sanitizeHeaderValue(rawValue)
  if (!sanitized) {
    return undefined
  }

  const [rawLat, rawLng] = sanitized.split(',', 2)
  if (!rawLat || !rawLng) {
    return undefined
  }

  const lat = Number.parseFloat(rawLat)
  const lng = Number.parseFloat(rawLng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined
  }

  return { lat, lng }
}

export async function GET(_request: Request) {
  try {
    try {
      await connection()
    } catch {
      // Ignore connection rejection during prerender.
    }
    let headersList: Headers | null = null
    try {
      headersList = await headers()
    } catch {
      // If prerendered, fall back to the request headers.
    }

    const headerSource = headersList ?? new Headers()

    const responseBody = geolocationSchema.parse({
      country: sanitizeHeaderValue(headerSource.get('Geo-Country')),
      subdivision: sanitizeHeaderValue(headerSource.get('Geo-Subdivision')),
      city: sanitizeHeaderValue(headerSource.get('Geo-City')),
      position: parsePositionHeader(headerSource.get('Geo-Position')),
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse geolocation headers',
          detail: 'Received geolocation headers did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to resolve geolocation headers', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to resolve geolocation headers',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
