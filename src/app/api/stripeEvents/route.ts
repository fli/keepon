import type Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'

import { db, type Json } from '@/lib/db'

import { buildErrorResponse } from '../_lib/accessToken'
import { getStripeClient } from '../_lib/stripeClient'

const sanitizeEvent = (event: Stripe.Event): Json => JSON.parse(JSON.stringify(event)) as Json

const createInvalidSignatureResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Your access token is invalid or expired.',
      type: '/invalid-access-token',
    }),
    { status: 401 }
  )

const createMissingConfigurationResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe configuration missing',
      detail:
        'STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_CONNECT_WEBHOOK_SECRET must be configured to receive Stripe webhooks.',
      type: '/missing-stripe-configuration',
    }),
    { status: 500 }
  )

const createInvalidBodyResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: 'Failed to read Stripe webhook payload.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to record Stripe event',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

export async function POST(request: Request) {
  const stripeSignature = request.headers.get('stripe-signature')

  if (!stripeSignature) {
    return createInvalidSignatureResponse()
  }

  const stripeClient = getStripeClient()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET

  if (!stripeClient || !webhookSecret || !connectWebhookSecret) {
    console.error('Stripe webhook configuration missing', {
      hasStripeClient: Boolean(stripeClient),
      hasWebhookSecret: Boolean(webhookSecret),
      hasConnectWebhookSecret: Boolean(connectWebhookSecret),
    })
    return createMissingConfigurationResponse()
  }

  let rawBody: Buffer
  try {
    rawBody = Buffer.from(await request.arrayBuffer())
  } catch (error) {
    console.error('Failed to read Stripe webhook payload', error)
    return createInvalidBodyResponse()
  }

  let event: Stripe.Event

  try {
    event = stripeClient.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret)
  } catch (primaryError) {
    try {
      event = stripeClient.webhooks.constructEvent(rawBody, stripeSignature, connectWebhookSecret)
    } catch (connectError) {
      console.warn('Stripe webhook signature verification failed', {
        primaryError,
        connectError,
      })
      return createInvalidSignatureResponse()
    }
  }

  try {
    await db
      .insertInto('stripe.event')
      .values({ id: event.id, object: sanitizeEvent(event) })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
  } catch (error) {
    console.error('Failed to persist Stripe event', {
      eventId: event.id,
      eventType: event.type,
      error,
    })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
