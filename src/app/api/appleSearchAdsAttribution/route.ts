import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

const isoDateTimeString = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (value.length === 0) {
        return false
      }
      const timestamp = Date.parse(value)
      return Number.isFinite(timestamp)
    },
    {
      message: 'Value must be a valid ISO 8601 date-time string',
    }
  )

const optionalNullableString = z.union([z.string().trim(), z.null()]).optional()

const optionalNullableIsoDateTime = z.union([isoDateTimeString, z.null()]).optional()

const requestSchema = z.object({
  anonymousId: z.string({ message: 'anonymousId is required' }).trim().min(1, 'anonymousId must not be empty'),
  attribution: z.boolean().nullable().optional(),
  orgName: optionalNullableString,
  orgId: optionalNullableString,
  campaignId: optionalNullableString,
  campaignName: optionalNullableString,
  purchaseDate: optionalNullableIsoDateTime,
  conversionDate: optionalNullableIsoDateTime,
  conversionType: optionalNullableString,
  clickDate: optionalNullableIsoDateTime,
  adgroupId: optionalNullableString,
  adgroupName: optionalNullableString,
  countryOrRegion: optionalNullableString,
  keyword: optionalNullableString,
  keywordId: optionalNullableString,
  keywordMatchtype: optionalNullableString,
  creativesetId: optionalNullableString,
  creativesetName: optionalNullableString,
})

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

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to record Apple Search Ads attribution',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const toNullableString = (value: string | null | undefined) => value ?? null

const toNullableIsoDateString = (value: string | null | undefined) => value ?? null

type RequestBody = z.infer<typeof requestSchema>

export async function POST(request: Request) {
  let parsedBody: RequestBody

  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestSchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')

      return createInvalidBodyResponse(detail || undefined)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse Apple Search Ads attribution payload as JSON', error)
    return createInvalidJsonResponse()
  }

  try {
    await db
      .insertInto('apple_search_ads_attribution')
      .values({
        anonymous_id: parsedBody.anonymousId,
        attribution: parsedBody.attribution ?? null,
        org_name: toNullableString(parsedBody.orgName),
        org_id: toNullableString(parsedBody.orgId),
        campaign_id: toNullableString(parsedBody.campaignId),
        campaign_name: toNullableString(parsedBody.campaignName),
        purchase_date: toNullableIsoDateString(parsedBody.purchaseDate),
        conversion_date: toNullableIsoDateString(parsedBody.conversionDate),
        conversion_type: toNullableString(parsedBody.conversionType),
        click_date: toNullableIsoDateString(parsedBody.clickDate),
        adgroup_id: toNullableString(parsedBody.adgroupId),
        adgroup_name: toNullableString(parsedBody.adgroupName),
        country_or_region: toNullableString(parsedBody.countryOrRegion),
        keyword: toNullableString(parsedBody.keyword),
        keyword_id: toNullableString(parsedBody.keywordId),
        keyword_matchtype: toNullableString(parsedBody.keywordMatchtype),
        creativeset_id: toNullableString(parsedBody.creativesetId),
        creativeset_name: toNullableString(parsedBody.creativesetName),
      })
      .onConflict((oc) => oc.doNothing())
      .execute()
  } catch (error) {
    console.error('Failed to record Apple Search Ads attribution', {
      error,
      anonymousId: parsedBody.anonymousId,
    })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
