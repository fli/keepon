import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

export const runtime = 'nodejs'

const positionSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()

const geolocationSchema = z.object({
  country: z.string().nullable(),
  subdivision: z.string().nullable(),
  city: z.string().nullable(),
  position: positionSchema,
})

const sanitizeHeaderValue = (value: string | null) => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const parsePositionHeader = (rawValue: string | null) => {
  const sanitized = sanitizeHeaderValue(rawValue)
  if (!sanitized) {
    return null
  }

  const [rawLat, rawLng] = sanitized.split(',', 2)
  if (!rawLat || !rawLng) {
    return null
  }

  const lat = Number.parseFloat(rawLat)
  const lng = Number.parseFloat(rawLng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  return { lat, lng }
}

export async function GET(request: Request) {
  try {
    const headers = request.headers

    const responseBody = geolocationSchema.parse({
      country: sanitizeHeaderValue(headers.get('Geo-Country')),
      subdivision: sanitizeHeaderValue(headers.get('Geo-Subdivision')),
      city: sanitizeHeaderValue(headers.get('Geo-City')),
      position: parsePositionHeader(headers.get('Geo-Position')),
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
