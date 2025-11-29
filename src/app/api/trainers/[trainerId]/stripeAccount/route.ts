import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import { getStripeClient } from '../../../_lib/stripeClient'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  trainerId: z
    .string()
    .trim()
    .min(1, 'Trainer id is required'),
})

const trainerStripeRowSchema = z.object({
  stripeAccountId: z.string().nullable(),
  account: z.unknown().nullable(),
  balance: z.unknown().nullable(),
  persons: z.unknown(),
  firstCardPaymentProcessed: z
    .union([z.date(), z.string(), z.number(), z.null()])
    .nullable()
    .optional(),
  stripeAccountType: z.string().nullable(),
})

const stripeAccountSchema = z
  .object({
    id: z.string(),
    type: z.enum(['standard', 'custom', 'express']),
    charges_enabled: z.boolean(),
    payouts_enabled: z.boolean(),
    default_currency: z.string(),
    requirements: z
      .object({
        currently_due: z.array(z.string()).optional(),
        past_due: z.array(z.string()).optional(),
        pending_verification: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough()

const stripeAccountTypeSchema = z.enum(['standard', 'custom', 'express'])

const stripeBalanceSchema = z
  .object({
    available: z.array(
      z
        .object({
          amount: z.union([z.number(), z.string()]),
          currency: z.string(),
        })
        .passthrough()
    ),
    pending: z.array(
      z
        .object({
          amount: z.union([z.number(), z.string()]),
          currency: z.string(),
        })
        .passthrough()
    ),
  })
  .passthrough()

const stripePersonSchema = z
  .object({
    relationship: z
      .object({
        representative: z.boolean().optional(),
      })
      .partial()
      .optional(),
    verification: z
      .object({
        status: z.string().optional(),
        details: z.union([z.string(), z.null()]).optional(),
        details_code: z.union([z.string(), z.null()]).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough()

const verificationStatusSchema = z.enum([
  'verified',
  'unverified',
  'pending',
  'error',
])

const emptyResponse = {
  id: null,
  type: null,
  firstCardPaymentProcessed: null,
  balance: {
    pending: [],
  },
  verification: {} as Record<string, unknown>,
  account: {} as Record<string, unknown>,
}

const parseTimestamp = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label} value encountered in database row`)
    }
    return value
  }

  const date = new Date(value as string | number)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value encountered in database row`)
  }
  return date
}

const parseStripeAmount = (value: string | number, label: string) => {
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(value.trim())

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} amount encountered in Stripe data`)
  }

  return numeric
}

const normalizeDetailsCode = (code: string | null | undefined) => {
  switch (code) {
    case 'document_corrupt':
      return 'scan_corrupt'
    case 'document_not_readable':
      return 'scan_not_readable'
    case 'document_failed_greyscale':
      return 'scan_failed_greyscale'
    case 'document_not_uploaded':
      return 'scan_not_uploaded'
    case 'document_type_not_supported':
      return 'scan_id_type_not_supported'
    case 'document_failed_test_mode':
      return 'scan_failed_test_mode'
    default:
      return code ?? null
  }
}

const ensureArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []

type RouteContext = {
  params?: {
    trainerId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching trainer Stripe account',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to access this trainer resource.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    const rowResult = await sql<{
      stripeAccountId: string | null
      account: unknown
      balance: unknown
      persons: unknown
      firstCardPaymentProcessed: Date | string | number | null
      stripeAccountType: string | null
    }>`
      SELECT
        trainer.stripe_account_id AS "stripeAccountId",
        stripe_account.object AS account,
        stripe_balance.object AS balance,
        COALESCE(
          (
            SELECT json_agg(object)
              FROM "stripe".account
             WHERE "stripe".account.object ->> 'object' = 'person'
               AND "stripe".account.object ->> 'account' = trainer.stripe_account_id
          ),
          '[]'::json
        ) AS persons,
        vw_first_card_payments.first_card_payment_processed AS "firstCardPaymentProcessed",
        stripe_account.object ->> 'type' AS "stripeAccountType"
      FROM trainer
      LEFT JOIN vw_first_card_payments
        ON vw_first_card_payments.trainer_id = trainer.id
      LEFT JOIN "stripe".account AS stripe_account
        ON stripe_account.id = trainer.stripe_account_id
      LEFT JOIN stripe_balance
        ON stripe_balance.account_id = trainer.stripe_account_id
     WHERE trainer.id = ${trainerId}
    `.execute(db)

    if (rowResult.rows.length === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'The specified trainer does not exist.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const parsedRow = trainerStripeRowSchema.parse(rowResult.rows[0])

    const stripeAccountId = parsedRow.stripeAccountId
    const stripeAccountTypeRaw = parsedRow.stripeAccountType

    if (!stripeAccountId || !stripeAccountTypeRaw) {
      return NextResponse.json(emptyResponse)
    }

    const accountParseResult = stripeAccountSchema.safeParse(parsedRow.account)
    let account = accountParseResult.success
      ? accountParseResult.data
      : undefined

    const balanceParseResult = stripeBalanceSchema.safeParse(parsedRow.balance)
    let balance = balanceParseResult.success
      ? balanceParseResult.data
      : undefined

    const persons = ensureArray(parsedRow.persons).map(person =>
      stripePersonSchema.parse(person)
    )

    const accountTypeResult = stripeAccountTypeSchema.safeParse(
      account?.type ?? stripeAccountTypeRaw
    )

    if (!accountTypeResult.success) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Invalid Stripe account type',
          detail: 'The Stripe account type could not be determined.',
          type: '/invalid-stripe-account-type',
        }),
        { status: 500 }
      )
    }

    const accountType = accountTypeResult.data

    if (accountType === 'express') {
      console.error(
        'Encountered unsupported Stripe express account',
        stripeAccountId
      )
      return NextResponse.json(
        buildErrorResponse({
          status: 422,
          title: 'Unsupported Stripe account type',
          detail: 'Express Stripe accounts are not supported for this endpoint.',
          type: '/unsupported-stripe-account-type',
        }),
        { status: 422 }
      )
    }

    let representative = persons.find(
      person => person.relationship?.representative === true
    )

    const requiresAccountRefresh =
      !account ||
      typeof account.charges_enabled !== 'boolean' ||
      typeof account.payouts_enabled !== 'boolean' ||
      typeof account.default_currency !== 'string'

    const requiresBalanceRefresh =
      !balance ||
      !Array.isArray(balance.available) ||
      !Array.isArray(balance.pending)

    const requiresPersonsRefresh =
      accountType === 'custom' && !representative && persons.length === 0

    if (
      requiresAccountRefresh ||
      requiresBalanceRefresh ||
      requiresPersonsRefresh
    ) {
      const stripeClient = getStripeClient()

      if (!stripeClient) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Stripe configuration missing',
            detail:
              'STRIPE_SECRET_KEY is not configured, so Stripe account data cannot be refreshed.',
            type: '/missing-stripe-configuration',
          }),
          { status: 500 }
        )
      }

      if (requiresAccountRefresh) {
        const freshAccount = await stripeClient.accounts.retrieve(
          stripeAccountId
        )
        const { lastResponse: _ignore, ...rest } = freshAccount
        account = stripeAccountSchema.parse(rest)
      }

      if (requiresBalanceRefresh) {
        const freshBalance = await stripeClient.balance.retrieve(undefined, {
          stripeAccount: stripeAccountId,
        })
        const { lastResponse: _ignore, ...rest } = freshBalance
        balance = stripeBalanceSchema.parse(rest)
      }

      if (requiresPersonsRefresh && accountType === 'custom') {
        const freshPersons = await stripeClient.accounts.listPersons(
          stripeAccountId,
          {
            relationship: { representative: true },
          }
        )
        persons.splice(
          0,
          persons.length,
          ...freshPersons.data.map(person => stripePersonSchema.parse(person))
        )
      }
    }

    representative = persons.find(
      person => person.relationship?.representative === true
    )

    if (!account) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe account unavailable',
          detail:
            'Unable to load Stripe account details for the requested trainer.',
          type: '/stripe-account-unavailable',
        }),
        { status: 500 }
      )
    }

    if (!balance) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe balance unavailable',
          detail:
            'Unable to load Stripe balance information for the requested trainer.',
          type: '/stripe-balance-unavailable',
        }),
        { status: 500 }
      )
    }

    const defaultCurrency = account.default_currency

    const available = balance.available
      .filter(entry => entry.currency === defaultCurrency)
      .reduce(
        (total, entry) =>
          total + parseStripeAmount(entry.amount, 'available balance entry'),
        0
      )

    const pending = balance.pending
      .filter(entry => entry.currency === defaultCurrency)
      .reduce(
        (total, entry) =>
          total + parseStripeAmount(entry.amount, 'pending balance entry'),
        0
      )

    const firstCardPaymentProcessed = parseTimestamp(
      parsedRow.firstCardPaymentProcessed ?? null,
      'firstCardPaymentProcessed'
    )

    let verificationStatus: z.infer<typeof verificationStatusSchema> =
      'unverified'
    let verificationDetails: string | null = null
    let verificationDetailsCode: string | null = null

    if (accountType === 'standard') {
      const requirements = account.requirements ?? {}
      const currentlyDue = ensureArray(requirements.currently_due).length > 0
      const pastDue = ensureArray(requirements.past_due).length > 0
      const pendingVerification =
        ensureArray(requirements.pending_verification).length > 0

      if (currentlyDue || pastDue) {
        verificationStatus = 'unverified'
      } else if (pendingVerification) {
        verificationStatus = 'pending'
      } else {
        verificationStatus = 'verified'
      }
    } else {
      const personVerification = representative?.verification

      if (personVerification?.status) {
        const parsedStatus = verificationStatusSchema.safeParse(
          personVerification.status
        )
        verificationStatus = parsedStatus.success
          ? parsedStatus.data
          : 'error'
      } else {
        verificationStatus = 'unverified'
      }

      verificationDetails =
        typeof personVerification?.details === 'string'
          ? personVerification.details
          : null

      verificationDetails = verificationDetails?.trim()
        ? verificationDetails
        : null

      verificationDetailsCode = normalizeDetailsCode(
        typeof personVerification?.details_code === 'string'
          ? personVerification.details_code
          : null
      )
    }

    const responseBody = {
      id: account.id,
      type: accountType,
      account: {
        charges_enabled: account.charges_enabled,
        transfers_enabled: account.payouts_enabled,
      },
      balance: {
        pending: [
          {
            amount: available + pending,
          },
        ],
      },
      firstCardPaymentProcessed: firstCardPaymentProcessed
        ? firstCardPaymentProcessed.toISOString()
        : null,
      verification: {
        status: verificationStatus,
        details: verificationDetails,
        details_code: verificationDetailsCode,
      },
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse Stripe account data',
          detail:
            'Stripe account data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while fetching trainer account', {
        code: error.code,
        message: error.message,
        stack: error.stack,
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

    console.error(
      'Failed to fetch trainer Stripe account data',
      trainerId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch Stripe account data',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
