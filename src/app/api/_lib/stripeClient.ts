import Stripe from 'stripe'

// Stripe v17 typings only accept the latest API version literal
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-11-17.clover'

let cachedStripeClient: Stripe | null | undefined

export const getStripeClient = () => {
  if (cachedStripeClient !== undefined) {
    return cachedStripeClient
  }

  const secret = process.env.STRIPE_SECRET_KEY

  if (!secret) {
    cachedStripeClient = null
    return cachedStripeClient
  }

  cachedStripeClient = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    telemetry: false,
  })

  return cachedStripeClient
}
