import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../../../_lib/accessToken'

const ISO_DURATION_PATTERN = /^-?P/

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format')

const availabilityIntervalSchema = z.tuple([timeStringSchema, timeStringSchema])

const availabilitySchema = z.object({
  acceptingBookings: z.boolean(),
  availableIntervals: z.array(availabilityIntervalSchema),
})

const availabilityOverridesSchema = z.record(
  z.string(),
  z.object({
    acceptingBookings: z.boolean().nullable(),
    availableIntervals: z.array(availabilityIntervalSchema).nullable(),
  })
)

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()

const serviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.string().nullable(),
  durationMinutes: z.number(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema,
  googlePlaceId: z.string().nullable(),
  description: z.string().nullable(),
  bookingPaymentType: z.union([z.literal('hidePrice'), z.literal('noPrepayment'), z.literal('fullPrepayment')]),
  coverImageUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  image0Url: z.string().nullable(),
  image1Url: z.string().nullable(),
  image2Url: z.string().nullable(),
  image3Url: z.string().nullable(),
  image4Url: z.string().nullable(),
  image5Url: z.string().nullable(),
  bufferMinutesBefore: z.number(),
  bufferMinutesAfter: z.number(),
  timeSlotFrequencyMinutes: z.number(),
  displayOrder: z.number().nullable(),
  requestClientAddressOnline: z.union([z.literal('optional'), z.literal('required'), z.null()]).nullable(),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: z.union([z.literal('optional'), z.literal('required'), z.null()]).nullable(),
})

const providerSchema = z.object({
  currency: z.string(),
  country: z.string(),
  timezone: z.string(),
  onlineBookingsEnabled: z.boolean(),
  providerName: z.string(),
  pageUrl: z.string(),
  pageUrlSlug: z.string(),
  contactEmail: z.string(),
  contactNumber: z.string().nullable(),
  durationUntilBookingWindowOpens: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  durationUntilBookingWindowCloses: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  bookingNote: z.string().nullable(),
  availability: z.object({
    defaults: z.object({
      monday: availabilitySchema,
      tuesday: availabilitySchema,
      wednesday: availabilitySchema,
      thursday: availabilitySchema,
      friday: availabilitySchema,
      saturday: availabilitySchema,
      sunday: availabilitySchema,
    }),
    overrides: availabilityOverridesSchema,
  }),
  services: z.array(serviceSchema),
  unavailability: z.array(z.tuple([z.union([z.string(), z.date()]), z.union([z.string(), z.date()])])),
  brandColor: z.string(),
  brandDarkMode: z.boolean(),
  businessLogoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  cancellationPolicy: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.union([z.literal('standard'), z.literal('custom'), z.null()]).nullable(),
})

type Provider = z.infer<typeof providerSchema>

type ProviderRow = Omit<Provider, 'pageUrl' | 'unavailability'> & {
  unavailability: [string | Date, string | Date][]
}

type HandlerContext = { params: Promise<Record<string, string>> }

const paramsSchema = z.object({
  pageUrlSlug: z.string().trim().min(1, 'Page URL slug must not be empty'),
})

const removeTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value)

const buildBookingsPageUrl = (slug: string) => {
  const trimmedSlug = slug.trim()
  if (!trimmedSlug) {
    throw new Error('Online bookings page slug is empty')
  }

  const explicitBase =
    process.env.BOOKINGS_BASE_URL ?? process.env.BOOKINGS_URL ?? process.env.NEXT_PUBLIC_BOOKINGS_URL ?? null

  if (explicitBase) {
    const explicit = new URL(explicitBase)
    return `${removeTrailingSlash(explicit.toString())}/${trimmedSlug}`
  }

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  const bookingsBase = new URL('book', baseUrl)
  return `${removeTrailingSlash(bookingsBase.toString())}/${trimmedSlug}`
}

const normalizeDateValue = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  return null
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

  const { pageUrlSlug } = parsedParams.data

  try {
    const row = await db
      .selectFrom('vw_online_bookings_provider')
      .selectAll()
      .where('pageUrlSlug', '=', pageUrlSlug)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Service provider page not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const normalizedUnavailability = Array.isArray(row.unavailability)
      ? row.unavailability
          .map((interval) => {
            if (!Array.isArray(interval) || interval.length < 2) {
              return null
            }
            const [start, end] = interval

            const normalizedStart = normalizeDateValue(start)
            const normalizedEnd = normalizeDateValue(end)

            if (!normalizedStart || !normalizedEnd) {
              return null
            }

            return [normalizedStart, normalizedEnd] as [string, string]
          })
          .filter(Boolean)
      : []

    if (!row.pageUrlSlug) {
      throw new Error('Provider is missing page URL slug')
    }

    const response: Provider = providerSchema.parse({
      ...row,
      pageUrl: buildBookingsPageUrl(row.pageUrlSlug),
      unavailability: normalizedUnavailability,
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse provider data from database',
          detail: 'Provider data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch online bookings provider by slug', pageUrlSlug, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch online bookings provider',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
