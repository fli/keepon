import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'

import { db, sql, type Json } from '@/lib/db'

import { buildErrorResponse } from '../_lib/accessToken'

const createTwilioNotAvailableResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 503,
      title: 'Twilio not available.',
      type: '/twilio-not-available',
    }),
    { status: 503 }
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
      title: 'Failed to record Twilio message status',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const sanitizeMessage = (message: unknown): Json => JSON.parse(JSON.stringify(message)) as Json

const isFormUrlEncoded = (contentType: string) =>
  contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')

const buildValidationUrl = (requestUrl: string) => {
  const url = new URL(requestUrl)
  const baseUrl = process.env.BASE_URL

  if (baseUrl) {
    const parsedBase = new URL(baseUrl)
    url.host = parsedBase.host
    url.protocol = parsedBase.protocol
  }

  return url.toString()
}

const secureCompare = (a: string, b: string) => {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)

  if (aBuffer.length !== bBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

const buildExpectedSignature = ({
  authToken,
  url,
  rawBody,
  contentType,
}: {
  authToken: string
  url: string
  rawBody: string
  contentType: string
}) => {
  if (isFormUrlEncoded(contentType)) {
    const params = new URLSearchParams(rawBody)
    const sortedEntries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    const data = url + sortedEntries.map(([key, value]) => key + value).join('')
    return crypto.createHmac('sha1', authToken).update(data).digest('base64')
  }

  return crypto.createHmac('sha1', authToken).update(url + rawBody).digest('base64')
}

const validateTwilioSignature = ({
  authToken,
  signature,
  url,
  rawBody,
  contentType,
}: {
  authToken: string
  signature: string
  url: string
  rawBody: string
  contentType: string
}) => {
  const expectedSignature = buildExpectedSignature({ authToken, url, rawBody, contentType })
  return secureCompare(signature, expectedSignature)
}

const parseMessageSid = (rawBody: string, contentType: string): string | null => {
  if (isFormUrlEncoded(contentType)) {
    return new URLSearchParams(rawBody).get('MessageSid')
  }

  if (rawBody.trim().length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(rawBody) as { MessageSid?: unknown }
    return typeof parsed.MessageSid === 'string' ? parsed.MessageSid : null
  } catch {
    return null
  }
}

const fetchTwilioMessage = async (accountSid: string, authToken: string, messageSid: string) => {
  const messageUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`

  const response = await fetch(messageUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Twilio API responded with status ${response.status}`)
  }

  return response.json()
}

export async function POST(request: Request) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    console.error('Twilio not configured', {
      hasAccountSid: Boolean(accountSid),
      hasAuthToken: Boolean(authToken),
    })
    return createTwilioNotAvailableResponse()
  }

  const twilioSignature = request.headers.get('x-twilio-signature')

  if (!twilioSignature) {
    return createInvalidSignatureResponse()
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch (error) {
    console.error('Failed to read Twilio status payload', error)
    return createInvalidBodyResponse('Failed to read request body.')
  }

  const contentType = request.headers.get('content-type') ?? ''
  const validationUrl = buildValidationUrl(request.url)

  if (!validateTwilioSignature({ authToken, signature: twilioSignature, url: validationUrl, rawBody, contentType })) {
    console.warn('Invalid Twilio signature', { validationUrl })
    return createInvalidSignatureResponse()
  }

  const messageSid = parseMessageSid(rawBody, contentType)

  if (!messageSid) {
    return createInvalidBodyResponse('MessageSid is required.')
  }

  try {
    const message = await fetchTwilioMessage(accountSid, authToken, messageSid)
    const sanitizedMessage = sanitizeMessage(message)

    await sql`
      INSERT INTO twilio.message (sid, object)
      VALUES (${messageSid}, ${sanitizedMessage})
      ON CONFLICT (sid) DO UPDATE SET object = EXCLUDED.object
    `.execute(db)
  } catch (error) {
    console.error('Failed to record Twilio message status', { messageSid, error })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
