const http = require('http')
const https = require('https')
const { PassThrough } = require('stream')
const { URL } = require('url')

const ORIGINAL_HTTP_REQUEST = http.request
const ORIGINAL_HTTPS_REQUEST = https.request
const ORIGINAL_FETCH = global.fetch

const MOCK_EPOCH = Number.parseInt(process.env.MOCK_EPOCH ?? '1700000000', 10)
const MOCK_DATE = new Date(MOCK_EPOCH * 1000)

const MOCK_HOSTS = new Set([
  'api.stripe.com',
  'mandrillapp.com',
  'api.twilio.com',
  'us1.api.mailchimp.com',
  'us2.api.mailchimp.com',
  'maps.googleapis.com',
  'buy.itunes.apple.com',
  'sandbox.itunes.apple.com',
])

const jsonResponse = (body, status = 200, headers = {}) => {
  const stream = new PassThrough()
  stream.statusCode = status
  stream.headers = { 'content-type': 'application/json', ...headers }
  process.nextTick(() => {
    stream.end(JSON.stringify(body))
  })
  return stream
}

const textResponse = (body, status = 200, headers = {}) => {
  const stream = new PassThrough()
  stream.statusCode = status
  stream.headers = { 'content-type': 'text/plain', ...headers }
  process.nextTick(() => {
    stream.end(body)
  })
  return stream
}

const buildTwilioMessage = (messageSid) => ({
  sid: messageSid,
  status: 'delivered',
  to: '+10000000000',
  from: '+10000000001',
})

const buildStripeList = (data = []) => ({
  object: 'list',
  data,
  has_more: false,
})

const buildStripeCard = () => ({
  id: 'card_mock',
  object: 'card',
  brand: 'visa',
  last4: '4242',
  exp_month: 1,
  exp_year: 2030,
  country: 'US',
})

const buildStripeBankAccount = () => ({
  id: 'ba_codex_a',
  object: 'bank_account',
  account_holder_name: null,
  account_holder_type: 'individual',
  account_type: null,
  bank_name: 'Mock Bank',
  country: 'US',
  currency: 'usd',
  last4: '6789',
  fingerprint: null,
  routing_number: null,
  status: 'new',
  default_for_currency: true,
  available_payout_methods: ['standard'],
})

const buildStripeAccount = () => ({
  id: 'acct_mock',
  object: 'account',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: {
    currently_due: [],
    eventually_due: [],
    past_due: [],
    disabled_reason: null,
  },
  capabilities: {
    card_payments: 'active',
    transfers: 'active',
  },
  external_accounts: buildStripeList([buildStripeBankAccount()]),
})

const buildStripeCustomer = () => ({
  id: 'cus_mock',
  object: 'customer',
  email: 'test@example.com',
})

const buildStripePaymentMethod = () => ({
  id: 'pm_mock',
  object: 'payment_method',
  type: 'card',
  customer: 'cus_mock',
  card: buildStripeCard(),
})

const buildStripePaymentIntent = () => ({
  id: 'pi_mock',
  object: 'payment_intent',
  status: 'succeeded',
  amount: 1000,
  application_fee_amount: 100,
  client_secret: 'pi_secret_mock',
  latest_charge: 'ch_mock',
  payment_method: 'pm_mock',
})

const buildStripeSetupIntent = () => ({
  id: 'seti_mock',
  object: 'setup_intent',
  status: 'requires_confirmation',
  client_secret: 'seti_secret_mock',
  payment_method: 'pm_mock',
})

const buildStripeSubscription = () => ({
  id: 'sub_mock',
  object: 'subscription',
  status: 'active',
  current_period_start: MOCK_EPOCH,
  current_period_end: MOCK_EPOCH + 30 * 24 * 60 * 60,
  items: buildStripeList([]),
})

const buildStripeBalance = () => ({
  object: 'balance',
  available: [{ amount: 0, currency: 'usd' }],
  pending: [],
})

const buildStripeRefund = () => ({
  id: 're_mock',
  object: 'refund',
  status: 'succeeded',
})

const buildStripeCheckoutSession = () => ({
  id: 'cs_mock',
  object: 'checkout.session',
  url: 'https://checkout.stripe.com/pay/mock',
})

const buildStripeBillingPortalSession = () => ({
  id: 'bps_mock',
  object: 'billing_portal.session',
  url: 'https://billing.stripe.com/session/mock',
})

const buildStripeAccountLink = () => ({
  id: 'al_mock',
  object: 'account_link',
  url: 'https://connect.stripe.com/mock',
  expires_at: MOCK_EPOCH + 3600,
})

const buildStripeToken = () => ({
  id: 'tok_mock',
  object: 'token',
  type: 'bank_account',
  bank_account: buildStripeBankAccount(),
})

const buildStripeExternalAccount = () => buildStripeBankAccount()

const buildStripeCharge = () => ({
  id: 'ch_mock',
  object: 'charge',
  status: 'succeeded',
})

const mockStripeResponse = (url, method) => {
  const path = url.pathname || ''
  if (path.startsWith('/v1/billing_portal/sessions')) return buildStripeBillingPortalSession()
  if (path.startsWith('/v1/checkout/sessions')) return buildStripeCheckoutSession()
  if (path.startsWith('/v1/account_links')) return buildStripeAccountLink()
  if (path.startsWith('/v1/setup_intents')) return buildStripeSetupIntent()
  if (path.startsWith('/v1/payment_intents')) return buildStripePaymentIntent()
  if (path.startsWith('/v1/payment_methods')) {
    const segments = path.split('/').filter(Boolean)
    if (path.endsWith('/detach')) {
      return { ...buildStripePaymentMethod(), customer: null }
    }
    if (segments.length >= 3 && segments[2] !== 'payment_methods') {
      return buildStripePaymentMethod()
    }
    return buildStripeList([])
  }
  if (path.startsWith('/v1/customers')) return buildStripeCustomer()
  if (path.startsWith('/v1/subscriptions')) {
    const segments = path.split('/').filter(Boolean)
    if (segments.length <= 2) return buildStripeList([])
    return buildStripeSubscription()
  }
  if (path.startsWith('/v1/balance')) return buildStripeBalance()
  if (path.startsWith('/v1/refunds')) return buildStripeRefund()
  if (path.startsWith('/v1/charges')) return buildStripeCharge()
  if (path.startsWith('/v1/tokens')) return buildStripeToken()
  if (path.startsWith('/v1/accounts')) {
    if (path.includes('/external_accounts')) {
      return method === 'GET' ? buildStripeList([buildStripeBankAccount()]) : buildStripeExternalAccount()
    }
    if (path.includes('/persons')) {
      return buildStripeList([])
    }
    return buildStripeAccount()
  }
  return { id: 'mock_id', object: 'mock', status: 'succeeded' }
}

const buildAppleReceiptPayload = () => {
  const nowIso = MOCK_DATE.toISOString()
  const nowMs = MOCK_EPOCH * 1000
  const nowMsString = String(nowMs)
  const inApp = {
    expires_date: nowIso,
    expires_date_ms: nowMsString,
    expires_date_pst: nowIso,
    is_in_intro_offer_period: 'false',
    is_trial_period: 'false',
    original_purchase_date: nowIso,
    original_purchase_date_ms: nowMsString,
    original_purchase_date_pst: nowIso,
    original_transaction_id: '1000000000000000',
    product_id: 'com.example.product',
    purchase_date: nowIso,
    purchase_date_ms: nowMsString,
    purchase_date_pst: nowIso,
    quantity: '1',
    subscription_group_identifier: '123456',
    transaction_id: '1000000000000001',
    web_order_line_item_id: '1000000000000002',
  }
  return {
    environment: 'Sandbox',
    receipt: {
      adam_id: 1,
      app_item_id: 1,
      application_version: '1',
      bundle_id: 'com.example.app',
      download_id: 1,
      expiration_date: nowIso,
      expiration_date_ms: nowMsString,
      expiration_date_pst: nowIso,
      in_app: [inApp],
      original_application_version: '1',
      original_purchase_date: nowIso,
      original_purchase_date_ms: nowMsString,
      original_purchase_date_pst: nowIso,
      receipt_creation_date: nowIso,
      receipt_creation_date_ms: nowMsString,
      receipt_creation_date_pst: nowIso,
      receipt_type: 'ProductionSandbox',
      request_date: nowIso,
      request_date_ms: nowMsString,
      request_date_pst: nowIso,
      version_external_identifier: 1,
    },
    status: 0,
    latest_receipt: 'mock-receipt',
    latest_receipt_info: [inApp],
    pending_renewal_info: [
      {
        auto_renew_status: '1',
        original_transaction_id: '1000000000000000',
        product_id: 'com.example.product',
      },
    ],
  }
}

const handleMockRequest = (urlString, options = {}) => {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return null
  }

  if (!MOCK_HOSTS.has(url.hostname)) return null

  if (url.hostname === 'mandrillapp.com') {
    return jsonResponse([
      {
        id: 1,
        url: process.env.BASE_URL || 'http://localhost:3001/api/mandrillEvents',
        auth_key: 'mock-auth-key',
        events: [],
      },
    ])
  }

  if (url.hostname === 'api.twilio.com') {
    const parts = url.pathname.split('/')
    const messageSid = parts[parts.length - 1]?.replace(/\.json$/, '') || 'SMXXXXXXXXXXXXXXXX'
    return jsonResponse(buildTwilioMessage(messageSid))
  }

  if (url.hostname === 'api.stripe.com') {
    return jsonResponse(mockStripeResponse(url, options.method ?? 'GET'))
  }

  if (url.hostname === 'maps.googleapis.com') {
    return jsonResponse({
      predictions: [],
      status: 'OK',
    })
  }

  if (url.hostname === 'buy.itunes.apple.com' || url.hostname === 'sandbox.itunes.apple.com') {
    return jsonResponse(buildAppleReceiptPayload())
  }

  if (url.hostname.endsWith('.api.mailchimp.com')) {
    return jsonResponse({
      id: 'mock_mailchimp',
      status: 'subscribed',
    })
  }

  return jsonResponse({ ok: true })
}

const wrapRequest = (originalRequest) => {
  return function patchedRequest(options, callback) {
    const urlString = typeof options === 'string' ? options : (() => {
      const protocol = options.protocol || 'https:'
      const host = options.hostname || options.host || 'localhost'
      const port = options.port ? `:${options.port}` : ''
      const path = options.path || '/'
      return `${protocol}//${host}${port}${path}`
    })()

    const method = typeof options === 'string' ? 'GET' : options.method || 'GET'
    const mocked = handleMockRequest(urlString, { method })
    if (mocked) {
      const req = new PassThrough()
      req.setHeader = () => {}
      req.getHeader = () => undefined
      req.removeHeader = () => {}
      req.setTimeout = () => {}
      req.setNoDelay = () => {}
      req.setSocketKeepAlive = () => {}
      req.abort = () => {}
      process.nextTick(() => {
        if (callback) callback(mocked)
        req.emit('response', mocked)
        req.emit('finish')
      })
      return req
    }

    return originalRequest.call(this, options, callback)
  }
}

http.request = wrapRequest(ORIGINAL_HTTP_REQUEST)
https.request = wrapRequest(ORIGINAL_HTTPS_REQUEST)

if (typeof ORIGINAL_FETCH === 'function') {
  global.fetch = async (input, init) => {
    const urlString = typeof input === 'string' ? input : input?.url
    const mocked = urlString
      ? handleMockRequest(urlString, { method: init?.method ?? 'GET', body: init?.body })
      : null
    if (mocked) {
      const chunks = []
      return new Promise((resolve) => {
        mocked.on('data', (chunk) => chunks.push(chunk))
        mocked.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            ok: mocked.statusCode >= 200 && mocked.statusCode < 300,
            status: mocked.statusCode,
            headers: mocked.headers,
            json: async () => JSON.parse(body || '{}'),
            text: async () => body,
          })
        })
      })
    }
    return ORIGINAL_FETCH(input, init)
  }
}
