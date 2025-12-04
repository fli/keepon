import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, type Json } from '@/lib/db'
import type { AnalyticsData } from '@/lib/db'
import type { Insertable } from 'kysely'
import { buildErrorResponse } from '../../_lib/accessToken'

export const runtime = 'nodejs'

const dateLikeSchema = z.union([z.string(), z.number(), z.date()])
const looseRecord = z.record(z.string(), z.unknown())

const identifyEventSchema = z.object({
  type: z.literal('identify'),
  anonymousId: z.string().optional(),
  userId: z.string().optional(),
  messageId: z.string().optional(),
  sentAt: dateLikeSchema.optional(),
  timestamp: dateLikeSchema.optional(),
  context: looseRecord.optional(),
  traits: z.record(z.string(), z.unknown()).optional(),
})

const trackEventSchema = z.object({
  type: z.literal('track'),
  event: z.string().min(1, 'event is required'),
  anonymousId: z.string().optional(),
  userId: z.string().optional(),
  messageId: z.string().optional(),
  sentAt: dateLikeSchema.optional(),
  timestamp: dateLikeSchema.optional(),
  context: looseRecord.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})

const screenEventSchema = z.object({
  type: z.literal('screen'),
  name: z.string().optional(),
  anonymousId: z.string().optional(),
  userId: z.string().optional(),
  messageId: z.string().optional(),
  sentAt: dateLikeSchema.optional(),
  timestamp: dateLikeSchema.optional(),
  context: looseRecord.optional(),
})

const requestSchema = z.object({
  batch: z
    .array(
      z.discriminatedUnion('type', [
        identifyEventSchema,
        trackEventSchema,
        screenEventSchema,
      ])
    )
    .min(1, 'batch must contain at least one event'),
  sentAt: dateLikeSchema.optional(),
  context: looseRecord.optional(),
})

type RequestBody = z.infer<typeof requestSchema>
type AnalyticsRow = Insertable<AnalyticsData>

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
      title: 'Failed to record analytics batch',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const parseDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  const date = new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

const toNullableString = (...values: Array<unknown>): string | null => {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length === 0) continue
      return trimmed
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return null
}

const toNullableNumber = (...values: Array<unknown>): number | null => {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseFloat(value)
          : Number.NaN

    if (Number.isFinite(numeric)) {
      return numeric
    }
  }
  return null
}

const toNullableBoolean = (...values: Array<unknown>): boolean | null => {
  for (const value of values) {
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', 't', '1', 'yes', 'y'].includes(normalized)) return true
      if (['false', 'f', '0', 'no', 'n'].includes(normalized)) return false
    }
    if (typeof value === 'number') {
      if (value === 1) return true
      if (value === 0) return false
    }
  }
  return null
}

const toJsonOrNull = (value: unknown): Json | null => {
  if (value === undefined || value === null) return null
  try {
    return JSON.parse(JSON.stringify(value)) as Json
  } catch {
    return null
  }
}

const computeTimestamp = (
  now: Date,
  requestSentAt: Date | null,
  eventSentAt: Date | null,
  eventTimestamp: Date | null
) => {
  const sentAt = requestSentAt ?? eventSentAt ?? now
  const timestamp = eventTimestamp ?? now
  return new Date(now.getTime() - sentAt.getTime() + timestamp.getTime())
}

export async function POST(request: Request) {
  let body: RequestBody

  try {
    const raw = (await request.json()) as unknown
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(issue => issue.message)
        .join('; ')
      return createInvalidBodyResponse(detail || undefined)
    }
    body = parsed.data
  } catch (error) {
    console.error('Failed to parse /lytics/batch payload as JSON', error)
    return createInvalidJsonResponse()
  }

  const now = new Date()
  const requestSentAt = parseDate(body.sentAt)
  const requestContext = body.context ?? {}

  const rows: AnalyticsRow[] = body.batch.map(event => {
    const eventContext = event.context ?? {}
    const eventSentAt = parseDate(event.sentAt)
    const eventTimestamp = parseDate(event.timestamp)
    const timestamp = computeTimestamp(
      now,
      requestSentAt,
      eventSentAt,
      eventTimestamp
    )

    const properties =
      event.type === 'track' ? toJsonOrNull(event.properties) : null
    const screenName =
      event.type === 'screen' ? toNullableString(event.name) : null
    const eventName =
      event.type === 'track' ? toNullableString(event.event) : null

    const row: AnalyticsRow = {
      anonymous_id: toNullableString(event.anonymousId),
      user_id: toNullableString(event.userId),
      properties,
      screen: screenName,
      event: eventName,
      type: event.type,
      received_at: now,
      timestamp,
      context_active: toNullableBoolean(
        requestContext.active,
        eventContext.active
      ),
      context_app_name: toNullableString(
        (requestContext.app as Record<string, unknown> | undefined)?.name,
        (eventContext.app as Record<string, unknown> | undefined)?.name
      ),
      context_app_version: toNullableString(
        (requestContext.app as Record<string, unknown> | undefined)?.version,
        (eventContext.app as Record<string, unknown> | undefined)?.version
      ),
      context_app_build: toNullableString(
        (requestContext.app as Record<string, unknown> | undefined)?.build,
        (eventContext.app as Record<string, unknown> | undefined)?.build
      ),
      context_app_namespace: toNullableString(
        (requestContext.app as Record<string, unknown> | undefined)?.namespace,
        (eventContext.app as Record<string, unknown> | undefined)?.namespace
      ),
      context_campaign_name: toNullableString(
        (requestContext.campaign as Record<string, unknown> | undefined)?.name,
        (eventContext.campaign as Record<string, unknown> | undefined)?.name
      ),
      context_campaign_source: toNullableString(
        (requestContext.campaign as Record<string, unknown> | undefined)
          ?.source,
        (eventContext.campaign as Record<string, unknown> | undefined)?.source
      ),
      context_campaign_medium: toNullableString(
        (requestContext.campaign as Record<string, unknown> | undefined)
          ?.medium,
        (eventContext.campaign as Record<string, unknown> | undefined)?.medium
      ),
      context_campaign_term: toNullableString(
        (requestContext.campaign as Record<string, unknown> | undefined)?.term,
        (eventContext.campaign as Record<string, unknown> | undefined)?.term
      ),
      context_campaign_content: toNullableString(
        (requestContext.campaign as Record<string, unknown> | undefined)
          ?.content,
        (eventContext.campaign as Record<string, unknown> | undefined)?.content
      ),
      context_device_id: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)?.id,
        (eventContext.device as Record<string, unknown> | undefined)?.id
      ),
      context_device_advertising_id: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)
          ?.advertisingId,
        (eventContext.device as Record<string, unknown> | undefined)
          ?.advertisingId
      ),
      context_device_ad_tracking_enabled: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)
          ?.adTrackingEnabled,
        (eventContext.device as Record<string, unknown> | undefined)
          ?.adTrackingEnabled
      ),
      context_device_manufacturer: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)
          ?.manufacturer,
        (eventContext.device as Record<string, unknown> | undefined)
          ?.manufacturer
      ),
      context_device_model: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)?.model,
        (eventContext.device as Record<string, unknown> | undefined)?.model
      ),
      context_device_name: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)?.name,
        (eventContext.device as Record<string, unknown> | undefined)?.name
      ),
      context_device_type: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)?.type,
        (eventContext.device as Record<string, unknown> | undefined)?.type
      ),
      context_device_version: toNullableString(
        (requestContext.device as Record<string, unknown> | undefined)?.version,
        (eventContext.device as Record<string, unknown> | undefined)?.version
      ),
      context_ip: toNullableString(requestContext.ip, eventContext.ip),
      context_library_name: toNullableString(
        (requestContext.library as Record<string, unknown> | undefined)?.name,
        (eventContext.library as Record<string, unknown> | undefined)?.name
      ),
      context_library_version: toNullableString(
        (requestContext.library as Record<string, unknown> | undefined)
          ?.version,
        (eventContext.library as Record<string, unknown> | undefined)?.version
      ),
      context_locale: toNullableString(
        requestContext.locale,
        eventContext.locale
      ),
      context_location_city: toNullableString(
        (requestContext.location as Record<string, unknown> | undefined)?.city,
        (eventContext.location as Record<string, unknown> | undefined)?.city
      ),
      context_location_country: toNullableString(
        (requestContext.location as Record<string, unknown> | undefined)
          ?.country,
        (eventContext.location as Record<string, unknown> | undefined)?.country
      ),
      context_location_latitude: toNullableNumber(
        (requestContext.location as Record<string, unknown> | undefined)
          ?.latitude,
        (eventContext.location as Record<string, unknown> | undefined)?.latitude
      ),
      context_location_longitude: toNullableNumber(
        (requestContext.location as Record<string, unknown> | undefined)
          ?.longitude,
        (eventContext.location as Record<string, unknown> | undefined)
          ?.longitude
      ),
      context_location_region: toNullableString(
        (requestContext.location as Record<string, unknown> | undefined)
          ?.region,
        (eventContext.location as Record<string, unknown> | undefined)?.region
      ),
      context_location_speed: toNullableNumber(
        (requestContext.location as Record<string, unknown> | undefined)?.speed,
        (eventContext.location as Record<string, unknown> | undefined)?.speed
      ),
      context_network_bluetooth: toNullableBoolean(
        (requestContext.network as Record<string, unknown> | undefined)
          ?.bluetooth,
        (eventContext.network as Record<string, unknown> | undefined)
          ?.bluetooth
      ),
      context_network_carrier: toNullableString(
        (requestContext.network as Record<string, unknown> | undefined)?.carrier,
        (eventContext.network as Record<string, unknown> | undefined)?.carrier
      ),
      context_network_cellular: toNullableBoolean(
        (requestContext.network as Record<string, unknown> | undefined)
          ?.cellular,
        (eventContext.network as Record<string, unknown> | undefined)?.cellular
      ),
      context_network_wifi: toNullableBoolean(
        (requestContext.network as Record<string, unknown> | undefined)?.wifi,
        (eventContext.network as Record<string, unknown> | undefined)?.wifi
      ),
      context_os_name: toNullableString(
        (requestContext.os as Record<string, unknown> | undefined)?.name,
        (eventContext.os as Record<string, unknown> | undefined)?.name
      ),
      context_os_version: toNullableString(
        (requestContext.os as Record<string, unknown> | undefined)?.version,
        (eventContext.os as Record<string, unknown> | undefined)?.version
      ),
      context_page_hash: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.hash,
        (eventContext.page as Record<string, unknown> | undefined)?.hash
      ),
      context_page_path: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.path,
        (eventContext.page as Record<string, unknown> | undefined)?.path
      ),
      context_page_referrer: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.referrer,
        (eventContext.page as Record<string, unknown> | undefined)?.referrer
      ),
      context_page_search: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.search,
        (eventContext.page as Record<string, unknown> | undefined)?.search
      ),
      context_page_title: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.title,
        (eventContext.page as Record<string, unknown> | undefined)?.title
      ),
      context_page_url: toNullableString(
        (requestContext.page as Record<string, unknown> | undefined)?.url,
        (eventContext.page as Record<string, unknown> | undefined)?.url
      ),
      context_referrer_id: toNullableString(
        (requestContext.referrer as Record<string, unknown> | undefined)?.id,
        (eventContext.referrer as Record<string, unknown> | undefined)?.id
      ),
      context_referrer_type: toNullableString(
        (requestContext.referrer as Record<string, unknown> | undefined)?.type,
        (eventContext.referrer as Record<string, unknown> | undefined)?.type
      ),
      context_referrer_name: toNullableString(
        (requestContext.referrer as Record<string, unknown> | undefined)?.name,
        (eventContext.referrer as Record<string, unknown> | undefined)?.name
      ),
      context_referrer_url: toNullableString(
        (requestContext.referrer as Record<string, unknown> | undefined)?.url,
        (eventContext.referrer as Record<string, unknown> | undefined)?.url
      ),
      context_referrer_link: toNullableString(
        (requestContext.referrer as Record<string, unknown> | undefined)?.link,
        (eventContext.referrer as Record<string, unknown> | undefined)?.link
      ),
      context_screen_density: toNullableNumber(
        (requestContext.screen as Record<string, unknown> | undefined)?.density,
        (eventContext.screen as Record<string, unknown> | undefined)?.density
      ),
      context_screen_height: toNullableNumber(
        (requestContext.screen as Record<string, unknown> | undefined)?.height,
        (eventContext.screen as Record<string, unknown> | undefined)?.height
      ),
      context_screen_width: toNullableNumber(
        (requestContext.screen as Record<string, unknown> | undefined)?.width,
        (eventContext.screen as Record<string, unknown> | undefined)?.width
      ),
      context_timezone: toNullableString(
        requestContext.timezone,
        eventContext.timezone
      ),
      context_group_id: toNullableString(
        requestContext.groupId,
        eventContext.groupId
      ),
      context_user_agent: toNullableString(
        requestContext.userAgent,
        eventContext.userAgent
      ),
    }

    const messageId = toNullableString(event.messageId)
    if (messageId) {
      row.id = messageId
    }

    return row
  })

  if (rows.length === 0) {
    return new Response(null, { status: 204 })
  }

  try {
    await db
      .insertInto('analytics_data')
      .values(rows)
      .onConflict(oc => oc.doNothing())
      .execute()
  } catch (error) {
    console.error('Failed to insert analytics batch', { error })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
