import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { getStripeClient, STRIPE_API_VERSION } from '../../_lib/stripeClient'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

class StripeConfigurationMissingError extends Error {
  constructor() {
    super('Stripe configuration missing')
    this.name = 'StripeConfigurationMissingError'
  }
}

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof createExternalAccountBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
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
  } catch (error) {
    console.error('Failed to parse Stripe external account request body', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid JSON payload',
        detail: 'Request body must be valid JSON.',
        type: '/invalid-json',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating Stripe external account',
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
        return NextResponse.json(
          buildErrorResponse({
            status: 400,
            title: 'External account must be a bank account',
            detail: 'Only bank accounts are supported for payouts.',
            type: '/invalid-external-account',
          }),
          { status: 400 }
        )
      }

      const { lastResponse: _ignored, ...bankAccount } = externalAccountResponse as Stripe.BankAccount & {
        lastResponse?: unknown
      }

      const parsedAccount = stripeBankAccountSchema.safeParse(bankAccount)

      if (!parsedAccount.success) {
        const detail = parsedAccount.error.issues.map((issue) => issue.message).join('; ')

        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to validate Stripe external account response',
            detail: detail || 'Stripe external account response did not match the expected schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      await db
        .insertInto('stripe.bank_account')
        .values({
          id: parsedAccount.data.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
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
          buildErrorResponse({
            status: error.statusCode ?? 502,
            title: 'Stripe API error',
            detail: error.message,
            type: '/stripe-api-error',
          }),
          { status: error.statusCode ?? 502 }
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
  default_for_currency: z.boolean().refine((value) => value === true, {
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
    fingerprint: z.union([z.string(), z.null()]).optional(),
    routing_number: z.union([z.string(), z.null()]).optional(),
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
    throw new Error('Invalid Stripe API version value')
  }
  return date.toISOString().slice(0, 10)
}

const toResponseBankAccount = (account: z.infer<typeof stripeBankAccountSchema>) => ({
  id: account.id,
  country: account.country,
  currency: account.currency,
  last4: account.last4,
  status: account.status,
  fingerprint: account.fingerprint ?? null,
  routing_number: account.routing_number ?? null,
  account_holder_name: account.account_holder_name ?? null,
  account_holder_type: account.account_holder_type ?? null,
  account_type: account.account_type ?? null,
  bank_name: account.bank_name ?? null,
  default_for_currency: account.default_for_currency ?? null,
  available_payout_methods: account.available_payout_methods ?? null,
})

const fetchAllBankAccounts = async (stripeClient: Stripe, stripeAccountId: string) => {
  const accounts: Array<z.infer<typeof stripeBankAccountSchema>> = []
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

    const storedBankAccountsResult = await sql<{
      id: string | null
      apiVersion: Date | string | number | null
      object: unknown
    }>`
      SELECT bank_account.id,
             bank_account.api_version AS "apiVersion",
             bank_account.object
        FROM stripe.bank_account AS bank_account
       WHERE bank_account.object ->> 'account' = ${stripeAccountId}
    `.execute(db)

    const storedBankAccounts = storedBankAccountsResult.rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id as string,
        apiVersion: row.apiVersion ?? '',
        object: row.object,
      }))

    const parsedStoredAccounts: Array<{
      apiVersion: string
      object: z.infer<typeof stripeBankAccountSchema>
      id: string
    }> = []

    let requiresRefresh = storedBankAccounts.length === 0

    for (const row of storedBankAccounts) {
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
    const storedIds = new Set(storedBankAccounts.map((row) => row.id))
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
                api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
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
          status: error.statusCode ?? 502,
          title: 'Stripe API error',
          detail: error.message,
          type: '/stripe-api-error',
        }),
        { status: error.statusCode ?? 502 }
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
