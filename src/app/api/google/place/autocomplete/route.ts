import { NextResponse } from 'next/server'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'

const baseUrl = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'

const placeAutocompleteMatchedSubstringSchema = z.object({
  length: z.number(),
  offset: z.number(),
})

const placeAutocompletePredictionSchema = z
  .object({
    description: z.string(),
    matched_substrings: z.array(placeAutocompleteMatchedSubstringSchema),
    structured_formatting: z
      .object({
        main_text: z.string(),
        main_text_matched_substrings: z.array(placeAutocompleteMatchedSubstringSchema),
        secondary_text: z.string(),
        secondary_text_matched_substrings: z.array(placeAutocompleteMatchedSubstringSchema).optional(),
      })
      .strict(),
    terms: z.array(
      z.object({
        offset: z.number(),
        value: z.string(),
      })
    ),
  })
  .extend({
    place_id: z.string().optional(),
    types: z.array(z.string()).optional(),
  })
  .strict()

const placesAutocompleteResponseSchema = z
  .object({
    predictions: z.array(placeAutocompletePredictionSchema),
    status: z.enum(['OK', 'ZERO_RESULTS', 'INVALID_REQUEST', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED', 'UNKNOWN_ERROR']),
  })
  .extend({
    error_message: z.string().optional(),
    info_messages: z.array(z.string()).optional(),
  })
  .strict()

const sanitizeHeaderValue = (value: string | null) => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching Google Places autocomplete suggestions',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const rawApiKey = process.env.GOOGLE_API_KEY
  const googleApiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : undefined

  if (!googleApiKey) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Google API key not configured',
        detail: 'The GOOGLE_API_KEY environment variable is missing or empty.',
        type: '/missing-configuration',
      }),
      { status: 500 }
    )
  }

  try {
    const requestUrl = new URL(request.url)
    const googleUrl = new URL(baseUrl)
    if (requestUrl.search) {
      // Preserve incoming search parameters (except enforce the API key below).
      googleUrl.search = requestUrl.search
    }
    googleUrl.searchParams.set('key', googleApiKey)

    const headers = new Headers()
    const acceptLanguage = sanitizeHeaderValue((await nextHeaders()).get('accept-language'))
    if (acceptLanguage) {
      headers.set('Accept-Language', acceptLanguage)
    }

    const response = await fetch(googleUrl.toString(), { headers })

    if (!response.ok) {
      console.error('Google Places autocomplete upstream error', {
        status: response.status,
        statusText: response.statusText,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Failed to fetch place suggestions',
          detail: `Google Places API responded with status ${response.status}.`,
          type: '/upstream-error',
        }),
        { status: 502 }
      )
    }

    const responseJson: unknown = await response.json()
    const parseResult = placesAutocompleteResponseSchema.safeParse(responseJson)

    if (!parseResult.success) {
      console.error('Failed to parse Google Places autocomplete response', parseResult.error)

      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Invalid place suggestions response',
          detail: 'The Google Places API response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 502 }
      )
    }

    return NextResponse.json(parseResult.data)
  } catch (error) {
    console.error('Google Places autocomplete request failed', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 502,
        title: 'Failed to fetch place suggestions',
        type: '/upstream-error',
      }),
      { status: 502 }
    )
  }
}
