import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, type Json } from '@/lib/db'
import { buildErrorResponse } from '../_lib/accessToken'

const mandrillWebhookSchema = z
  .object({
    id: z.number(),
    url: z.string().url(),
    auth_key: z.string(),
    events: z.array(z.string()),
  })
  .passthrough()

const mandrillEventsSchema = z.array(
  z
    .object({
      event: z.string(),
      _id: z.string(),
      ts: z.number(),
    })
    .passthrough()
)

type MandrillWebhook = z.infer<typeof mandrillWebhookSchema>
type MandrillEvent = z.infer<typeof mandrillEventsSchema>[number]

const webhookUrl = new URL(
  '/api/mandrillEvents',
  process.env.BASE_URL ?? 'http://localhost:3001'
).toString()

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

const createInvalidSignatureResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Your access token is invalid or expired.',
      type: '/invalid-access-token',
    }),
    { status: 401 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to record Mandrill event',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const sanitizeEventObject = (event: MandrillEvent): Json =>
  JSON.parse(JSON.stringify(event)) as Json

const fetchWebhooks = async (apiKey: string): Promise<MandrillWebhook[]> => {
  const response = await fetch(
    'https://mandrillapp.com/api/1.0/webhooks/list.json',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: apiKey }),
    }
  )

  if (!response.ok) {
    throw new Error(`Mandrill webhook list request failed: ${response.status}`)
  }

  const parsed = mandrillWebhookSchema.array().safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('Unexpected Mandrill webhook list response')
  }

  return parsed.data
}

const computeSignature = (
  webhook: MandrillWebhook,
  formEntries: [string, FormDataEntryValue][]
) => {
  const sortedEntries = [...formEntries].sort(([a], [b]) =>
    a.localeCompare(b)
  )

  const signedData =
    webhookUrl +
    sortedEntries
      .map(([key, value]) => {
        if (typeof value !== 'string') {
          throw new Error('Non-string form field encountered')
        }

        return key + value
      })
      .join('')

  const hmac = crypto.createHmac('sha1', webhook.auth_key)
  hmac.update(signedData)
  return hmac.digest('base64')
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}

export async function POST(request: Request) {
  const mandrillApiKey = process.env.MANDRILL_API_KEY
  if (!mandrillApiKey) {
    console.error('MANDRILL_API_KEY is not configured')
    return createInternalErrorResponse()
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (error) {
    console.error('Failed to parse Mandrill webhook payload as form data', error)
    return createInvalidBodyResponse('Payload must be form-encoded')
  }

  const signature = request.headers.get('x-mandrill-signature')
  if (!signature) {
    return createInvalidSignatureResponse()
  }

  let webhook: MandrillWebhook | undefined
  try {
    const webhooks = await fetchWebhooks(mandrillApiKey)
    webhook = webhooks.find(wh => wh.url === webhookUrl)
  } catch (error) {
    console.error('Failed to retrieve Mandrill webhooks', error)
    return createInternalErrorResponse()
  }

  if (!webhook) {
    console.error('Mandrill webhook not found for URL', { webhookUrl })
    return createInternalErrorResponse()
  }

  let computedSignature: string
  try {
    computedSignature = computeSignature(webhook, [...formData.entries()])
  } catch (error) {
    console.error('Failed to compute Mandrill webhook signature', error)
    return createInvalidBodyResponse('Invalid form payload')
  }

  if (computedSignature !== signature) {
    return createInvalidSignatureResponse()
  }

  const eventsPayload = formData.get('mandrill_events')
  if (typeof eventsPayload !== 'string') {
    return createInvalidBodyResponse('mandrill_events field is required')
  }

  let events: MandrillEvent[]
  try {
    const parsed = mandrillEventsSchema.safeParse(JSON.parse(eventsPayload))
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(issue => issue.message)
        .join('; ')
      return createInvalidBodyResponse(detail || undefined)
    }
    events = parsed.data
  } catch (error) {
    console.error('Failed to parse mandrill_events payload', error)
    return createInvalidBodyResponse('mandrill_events must be valid JSON')
  }

  if (events.length === 0) {
    return new Response(null, { status: 204 })
  }

  try {
    await db
      .insertInto('mandrill.event')
      .values(
        events.map(event => ({
          ts: BigInt(event.ts),
          _id: event._id,
          event: event.event,
          object: sanitizeEventObject(event),
        }))
      )
      .onConflict(oc => oc.columns(['ts', '_id', 'event']).doNothing())
      .execute()
  } catch (error) {
    console.error('Failed to record Mandrill events', { error, count: events.length })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
