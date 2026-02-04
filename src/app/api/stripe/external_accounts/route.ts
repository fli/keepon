import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { getStripeClient, STRIPE_API_VERSION } from '../../_lib/stripeClient'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]
const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

class StripeConfigurationMissingError extends Error {
  constructor() {
    super('Stripe configuration missing')
    this.name = 'StripeConfigurationMissingError'
  }
}

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createTokenMustBeBankAccountResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Provided bank account token is not for a bank account.',
      type: '/token-must-be-bank-account',
    }),
    { status: 400 }
  )

export async function POST(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating Stripe external account',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let parsedBody: z.infer<typeof createExternalAccountBodySchema>

  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const rawBody = parsed.data
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return createLegacyInvalidJsonResponse()
  }
  const result = createExternalAccountBodySchema.safeParse(rawBody)

  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || 'Request body did not match the expected schema.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  parsedBody = result.data

  try {
    const trainerRow = await db
      .selectFrom('trainer')
      .select(['stripe_account_id'])
      .where('id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!trainerRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'No trainer record was found for the authenticated access token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    const stripeAccountId = trainerRow.stripe_account_id

    if (!stripeAccountId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Stripe payments not enabled',
          detail: 'Stripe payments are not enabled for this trainer.',
          type: '/stripe-account-pending-creation',
        }),
        { status: 409 }
      )
    }

    const stripeClient = getStripeClient()

    if (!stripeClient) {
      throw new StripeConfigurationMissingError()
    }

    try {
      const stripeParams: Stripe.AccountCreateExternalAccountParams = {
        external_account: parsedBody.external_account as Stripe.AccountCreateExternalAccountParams['external_account'],
        default_for_currency: true,
      }

      const externalAccountResponse = await stripeClient.accounts.createExternalAccount(stripeAccountId, stripeParams)

      if (externalAccountResponse.object !== 'bank_account') {
        return createTokenMustBeBankAccountResponse()
      }

      const { lastResponse: _ignored, ...bankAccount } = externalAccountResponse as Stripe.BankAccount & {
        lastResponse?: unknown
      }

      const parsedAccount = stripeBankAccountSchema.safeParse(bankAccount)

      if (!parsedAccount.success) {
        return createTokenMustBeBankAccountResponse()
      }

      await db
        .insertInto('stripe.bank_account')
        .values({
          id: parsedAccount.data.id,
          api_version: stripeApiVersionDate,
          object: JSON.stringify(parsedAccount.data),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            api_version: eb.ref('excluded.api_version'),
            object: eb.ref('excluded.object'),
          }))
        )
        .execute()

      return NextResponse.json(toResponseBankAccount(parsedAccount.data))
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while creating external account', {
          trainerId: authorization.trainerId,
          statusCode: error.statusCode,
          message: error.message,
          code: error.code,
          type: error.type,
        })

        return NextResponse.json(
          {
            ...buildErrorResponse({
              status: 409,
              title: error.message,
              type: '/stripe-error',
            }),
            stripeError: error,
          },
          { status: 409 }
        )
      }

      throw error
    }
  } catch (error) {
    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail: 'STRIPE_SECRET_KEY is not configured, so Stripe external accounts cannot be created.',
          type: '/missing-stripe-configuration',
        }),
        { status: 500 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data',
          detail: 'Trainer data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create Stripe external account', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create Stripe external account',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

const storedBankAccountRowSchema = z.object({
  id: z.string(),
  apiVersion: z.union([z.string(), z.number(), z.date()]),
  object: z.unknown(),
})

const createExternalAccountBodySchema = z.object({
  external_account: z.union([
    z.string().min(1, { message: 'external_account is required' }),
    z
      .object({
        object: z.literal('bank_account'),
        country: z.string({ message: 'country is required' }),
        currency: z.string({ message: 'currency is required' }),
        account_number: z.string({ message: 'account_number is required' }),
        account_holder_name: z.string().optional(),
        account_holder_type: z.enum(['individual', 'company']).optional(),
        routing_number: z.string().optional(),
      })
      .passthrough(),
  ]),
  default_for_currency: z.boolean().refine((value) => value, {
    message: 'default_for_currency must be true',
  }),
})

const stripeBankAccountSchema = z
  .object({
    id: z.string(),
    object: z.literal('bank_account'),
    country: z.string(),
    currency: z.string(),
    last4: z.string(),
    status: z.enum(['new', 'validated', 'verified', 'verification_failed', 'errored']),
    fingerprint: z.union([z.string(), z.null()]),
    routing_number: z.union([z.string(), z.null()]),
    account_holder_name: z.union([z.string(), z.null()]).optional(),
    account_holder_type: z.union([z.literal('individual'), z.literal('company'), z.null()]).optional(),
    account_type: z.union([z.string(), z.null()]).optional(),
    bank_name: z.union([z.string(), z.null()]).optional(),
    default_for_currency: z.union([z.boolean(), z.null()]).optional(),
    available_payout_methods: z
      .array(z.enum(['instant', 'standard']))
      .nullable()
      .optional(),
  })
  .passthrough()

const normalizeApiVersion = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid Stripe API version value')
  }
  return date.toISOString().slice(0, 10)
}

const toResponseBankAccount = (account: z.infer<typeof stripeBankAccountSchema>) => {
  const response: Record<string, unknown> = {
    id: account.id,
    country: account.country,
    currency: account.currency,
    last4: account.last4,
    status: account.status,
    fingerprint: account.fingerprint ?? null,
    routing_number: account.routing_number ?? null,
  }

  if (account.account_holder_name !== undefined) {
    response.account_holder_name = account.account_holder_name ?? null
  }

  if (account.account_holder_type !== undefined) {
    response.account_holder_type = account.account_holder_type ?? null
  }

  if (account.account_type !== undefined) {
    response.account_type = account.account_type ?? null
  }

  if (account.bank_name !== undefined) {
    response.bank_name = account.bank_name ?? null
  }

  if (account.default_for_currency !== undefined) {
    response.default_for_currency = account.default_for_currency ?? null
  }

  if (account.available_payout_methods !== undefined) {
    response.available_payout_methods = account.available_payout_methods ?? null
  }

  return response
}

const fetchAllBankAccounts = async (stripeClient: Stripe, stripeAccountId: string) => {
  const accounts: z.infer<typeof stripeBankAccountSchema>[] = []
  let startingAfter: string | undefined

  while (true) {
    const page = await stripeClient.accounts.listExternalAccounts(stripeAccountId, {
      object: 'bank_account',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    const bankAccounts = page.data
      .filter((account): account is Stripe.BankAccount => account.object === 'bank_account')
      .map((account) => {
        const { lastResponse: _ignored, ...rest } = account as Stripe.BankAccount & { lastResponse?: unknown }
        return stripeBankAccountSchema.parse(rest)
      })

    accounts.push(...bankAccounts)

    if (!page.has_more || page.data.length === 0) {
      break
    }

    startingAfter = page.data[page.data.length - 1]?.id

    if (!startingAfter) {
      break
    }
  }

  return accounts
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching Stripe external accounts',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const trainerRow = await db
      .selectFrom('trainer')
      .select(['stripe_account_id'])
      .where('id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!trainerRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'No trainer record was found for the authenticated access token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    const stripeAccountId = trainerRow.stripe_account_id

    if (!stripeAccountId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Stripe payments not enabled',
          detail: 'Stripe payments are not enabled for this trainer.',
          type: '/stripe-account-pending-creation',
        }),
        { status: 409 }
      )
    }

    const storedBankAccounts = await db
      .selectFrom('stripe.bank_account as bankAccount')
      .select((eb) => [
        eb.ref('bankAccount.id').as('id'),
        eb.ref('bankAccount.api_version').as('apiVersion'),
        eb.ref('bankAccount.object').as('object'),
      ])
      .where((eb) =>
        eb(eb.fn('json_extract_path_text', [eb.ref('bankAccount.object'), 'account']), '=', stripeAccountId)
      )
      .execute()

    const storedBankAccountsParsed = storedBankAccounts
      .filter((row): row is { id: string; apiVersion: string | null; object: unknown } => row.id !== null)
      .map((row) => ({
        id: row.id,
        apiVersion: row.apiVersion ?? '',
        object: row.object,
      }))

    const parsedStoredAccounts: {
      apiVersion: string
      object: z.infer<typeof stripeBankAccountSchema>
      id: string
    }[] = []

    let requiresRefresh = storedBankAccountsParsed.length === 0

    for (const row of storedBankAccountsParsed) {
      try {
        const parsedRow = storedBankAccountRowSchema.parse(row)
        const apiVersion = normalizeApiVersion(parsedRow.apiVersion)
        const parsedAccountResult = stripeBankAccountSchema.safeParse(parsedRow.object)

        if (!parsedAccountResult.success || apiVersion !== stripeApiVersionDate) {
          requiresRefresh = true
          break
        }

        parsedStoredAccounts.push({
          id: parsedRow.id,
          apiVersion,
          object: parsedAccountResult.data,
        })
      } catch {
        requiresRefresh = true
        break
      }
    }

    if (!requiresRefresh) {
      return NextResponse.json(parsedStoredAccounts.map(({ object }) => toResponseBankAccount(object)))
    }

    const stripeClient = getStripeClient()

    if (!stripeClient) {
      throw new StripeConfigurationMissingError()
    }

    const freshAccounts = await fetchAllBankAccounts(stripeClient, stripeAccountId)

    const freshIds = new Set(freshAccounts.map((account) => account.id))
    const storedIds = new Set(storedBankAccountsParsed.map((row) => row.id))
    const idsToDelete = Array.from(storedIds).filter((id) => !freshIds.has(id))

    if (idsToDelete.length > 0 || freshAccounts.length > 0) {
      await db.transaction().execute(async (trx) => {
        if (idsToDelete.length > 0) {
          await trx.deleteFrom('stripe.bank_account').where('id', 'in', idsToDelete).execute()
        }

        if (freshAccounts.length > 0) {
          await trx
            .insertInto('stripe.bank_account')
            .values(
              freshAccounts.map((account) => ({
                id: account.id,
                api_version: stripeApiVersionDate,
                object: JSON.stringify(account),
              }))
            )
            .onConflict((oc) =>
              oc.column('id').doUpdateSet((eb) => ({
                api_version: eb.ref('excluded.api_version'),
                object: eb.ref('excluded.object'),
              }))
            )
            .execute()
        }
      })
    }

    return NextResponse.json(freshAccounts.map(toResponseBankAccount))
  } catch (error) {
    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail: 'STRIPE_SECRET_KEY is not configured, so Stripe external accounts cannot be loaded.',
          type: '/missing-stripe-configuration',
        }),
        { status: 500 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse Stripe external account data',
          detail: 'Stripe external account data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while fetching external accounts', {
        statusCode: error.statusCode,
        message: error.message,
        code: error.code,
        type: error.type,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Something on our end went wrong.',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch Stripe external accounts', {
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch Stripe external accounts',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
