import { NextResponse } from 'next/server'
import { db, sql } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptSaleProductRow,
  fetchSaleProducts,
} from '../../saleProducts/shared'

export const runtime = 'nodejs'

const missionSchema = z.object({
  id: z.string(),
  displayOrder: z.number(),
  rewardId: z.string().nullable(),
  rewardClaimed: z.boolean(),
  completed: z.boolean(),
  title: z.string(),
  description: z.string(),
  actionUrl: z.string().nullable(),
})

const missionListSchema = z.array(missionSchema)

const balanceEntrySchema = z.object({
  amount: z.union([z.number(), z.string()]),
  currency: z.string(),
})

const stripeBalanceSchema = z.object({
  available: z.array(balanceEntrySchema),
  pending: z.array(balanceEntrySchema),
})

const trainerRowSchema = z.object({
  firstName: z.string().nullable(),
  createdAt: z.date().nullable(),
  smsCredits: z.union([z.number(), z.string(), z.null()]),
  defaultCurrency: z.string().nullable(),
  timezone: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
})

const trialRowSchema = z.object({
  startTime: z.date(),
  endTime: z.date(),
})

const paymentsAggSchema = z.object({
  paid7: z.union([z.number(), z.string(), z.null()]),
  paidToday: z.union([z.number(), z.string(), z.null()]),
})

const pendingAggSchema = z.object({
  overdueCount: z.union([z.number(), z.string(), z.null()]),
  overdueTotal: z.union([z.number(), z.string(), z.null()]),
  pending7Total: z.union([z.number(), z.string(), z.null()]),
  pendingTodayTotal: z.union([z.number(), z.string(), z.null()]),
})

const activeCountSchema = z.object({
  count: z.union([z.number(), z.string(), z.null()]),
})

const nextSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.date(),
  durationMinutes: z.number(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  timezone: z.string().nullable(),
})

const onlineBookableCountSchema = z.object({
  count: z.union([z.number(), z.string(), z.null()]),
})

const money = (value: unknown) => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN
  return Number.isFinite(numeric) ? numeric : 0
}

const centsToMajorUnits = (value: unknown) => money(value) / 100

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching dashboard summary',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { trainerId } = authorization

  try {
    // Trainer basics
    const trainerRow = await db
      .selectFrom('vw_legacy_trainer as t')
      .innerJoin('trainer', 'trainer.id', 't.id')
      .select(({ ref }) => [
        ref('t.first_name').as('firstName'),
        ref('t.created_at').as('createdAt'),
        ref('t.sms_credit_balance').as('smsCredits'),
        ref('t.default_currency').as('defaultCurrency'),
        ref('t.timezone').as('timezone'),
        ref('trainer.stripe_account_id').as('stripeAccountId'),
      ])
      .where('t.id', '=', trainerId)
      .executeTakeFirst()

    if (!trainerRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'No trainer record exists for this access token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    const parsedTrainer = trainerRowSchema.parse({
      firstName: trainerRow.firstName,
      createdAt: trainerRow.createdAt,
      smsCredits: trainerRow.smsCredits,
      defaultCurrency: trainerRow.defaultCurrency,
      timezone: trainerRow.timezone,
      stripeAccountId: trainerRow.stripeAccountId,
    })

    // Trial info (latest)
    const trialRow = await db
      .selectFrom('trial')
      .select(({ ref }) => [
        ref('start_time').as('startTime'),
        ref('end_time').as('endTime'),
      ])
      .where('trainer_id', '=', trainerId)
      .orderBy('end_time', 'desc')
      .limit(1)
      .executeTakeFirst()

    const parsedTrial = trialRow ? trialRowSchema.safeParse(trialRow) : null
    const now = new Date()
    const trialEndsAt =
      parsedTrial && parsedTrial.success ? parsedTrial.data.endTime : null
    const trialDaysRemaining =
      trialEndsAt && trialEndsAt > now
        ? Math.max(
            0,
            Math.ceil(
              (trialEndsAt.getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          )
        : 0

    // Missions
    const missionRows = await db
      .selectFrom('mission')
      .innerJoin('mission_type', 'mission_type.id', 'mission.id')
      .leftJoin('reward', 'reward.id', 'mission.reward_id')
      .select(({ ref }) => [
        ref('mission.id').as('id'),
        ref('mission.display_order').as('displayOrder'),
        ref('mission.reward_id').as('rewardId'),
        ref('mission.completed_at').as('completedAt'),
        ref('mission_type.title').as('title'),
        ref('mission_type.description').as('description'),
        ref('mission_type.action_url').as('actionUrl'),
        ref('reward.claimed_at').as('rewardClaimedAt'),
      ])
      .where('mission.trainer_id', '=', trainerId)
      .orderBy('mission.display_order')
      .execute()

    const missions = missionListSchema.parse(
      missionRows.map(row => ({
        id: String(row.id),
        displayOrder: Number(row.displayOrder),
        rewardId: row.rewardId ?? null,
        rewardClaimed: row.rewardClaimedAt !== null,
        completed: row.completedAt !== null,
        title: row.title ?? '',
        description: row.description ?? '',
        actionUrl: row.actionUrl ?? null,
      }))
    )

    // Revenue (paid)
    const paymentsAggResult = await sql<{
      paid7: number | string | null
      paidToday: number | string | null
    }>`
      WITH revenue AS (
        SELECT payment.amount::numeric AS amount, payment.created_at AS ts
          FROM payment
         WHERE payment.trainer_id = ${trainerId}
           AND payment.refunded_time IS NULL
           AND (payment.is_manual OR payment.is_stripe OR payment.is_credit_pack OR payment.is_subscription)
        UNION ALL
        SELECT ppp.amount::numeric AS amount, ppp.date AS ts
          FROM payment_plan_payment ppp
          JOIN payment_plan pp ON pp.id = ppp.payment_plan_id
         WHERE pp.trainer_id = ${trainerId}
           AND ppp.status = 'paid'
        UNION ALL
        SELECT fi.amount::numeric AS amount, fi.start_date AS ts
          FROM finance_item fi
         WHERE fi.trainer_id = ${trainerId}
           AND fi.amount > 0
      )
      SELECT
        COALESCE(SUM(CASE WHEN ts >= NOW() - INTERVAL '7 days' THEN amount ELSE 0 END), 0)::numeric AS "paid7",
        COALESCE(SUM(CASE WHEN ts >= date_trunc('day', NOW()) THEN amount ELSE 0 END), 0)::numeric AS "paidToday"
      FROM revenue
    `.execute(db)

    const paymentsAgg = paymentsAggSchema.parse(paymentsAggResult.rows[0])

    // Pending / overdue plan payments
    const pendingAggResult = await sql<{
      overdueCount: number | string | null
      overdueTotal: number | string | null
      pending7Total: number | string | null
      pendingTodayTotal: number | string | null
    }>`
      SELECT
        COALESCE(SUM(CASE WHEN ppp.date < NOW() THEN 1 ELSE 0 END), 0)::numeric AS "overdueCount",
        COALESCE(SUM(CASE WHEN ppp.date < NOW() THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric AS "overdueTotal",
        COALESCE(SUM(CASE WHEN ppp.date >= NOW() AND ppp.date < NOW() + INTERVAL '7 days' THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric AS "pending7Total",
        COALESCE(SUM(CASE WHEN ppp.date >= date_trunc('day', NOW()) AND ppp.date < date_trunc('day', NOW()) + INTERVAL '1 day' THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric AS "pendingTodayTotal"
      FROM payment_plan_payment ppp
      JOIN payment_plan pp ON pp.id = ppp.payment_plan_id
     WHERE pp.trainer_id = ${trainerId}
       AND ppp.status NOT IN ('paid','cancelled','refunded','paused')
    `.execute(db)

    const pendingAgg = pendingAggSchema.parse(pendingAggResult.rows[0])

    // Active subscriptions
    const activePlansRow = await db
      .selectFrom('vw_legacy_plan')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('trainerId', '=', trainerId)
      .where(({ eb, ref }) =>
        eb(ref('status'), 'not in', ['cancelled', 'ended'])
      )
      .executeTakeFirst()

    const activePlans = activeCountSchema.parse({
      count: activePlansRow?.count ?? 0,
    }).count

    // Active packs (credit packs with remaining credits)
    const creditPackRows = await fetchSaleProducts(trainerId, {
      type: 'creditPack',
    })

    const activePacks = creditPackRows
      .map(adaptSaleProductRow)
      .filter(
        row =>
          row.type === 'creditPack' &&
          row.totalCredits > (row.creditsUsed ?? 0)
      ).length

    // Stripe balance (available + pending)
    let balanceAvailable = 0
    let balancePending = 0

    if (parsedTrainer.stripeAccountId) {
      const balanceRow = await db
        .selectFrom('stripe_balance')
        .select('object')
        .where('account_id', '=', parsedTrainer.stripeAccountId)
        .orderBy('updated_at', 'desc')
        .limit(1)
        .executeTakeFirst()

      if (balanceRow?.object) {
        const parsedBalance = stripeBalanceSchema.safeParse(balanceRow.object)
        if (parsedBalance.success) {
          const currency = parsedTrainer.defaultCurrency ?? ''
          balanceAvailable = parsedBalance.data.available
            .filter(entry =>
              currency ? entry.currency === currency : true
            )
            .reduce(
              (total, entry) => total + centsToMajorUnits(entry.amount),
              0
            )
          balancePending = parsedBalance.data.pending
            .filter(entry =>
              currency ? entry.currency === currency : true
            )
            .reduce(
              (total, entry) => total + centsToMajorUnits(entry.amount),
              0
            )
        }
      }
    }

    // Next appointment (soonest future session)
    const nextSessionResult = await sql<{
      id: string
      title: string | null
      startTime: Date
      durationMinutes: number | null
      location: string | null
      address: string | null
      timezone: string | null
    }>`
      SELECT
        s.id,
        COALESCE(series.name, s.location, 'Appointment') AS "title",
        s.start AS "startTime",
        (EXTRACT(EPOCH FROM s.duration) / 60)::int AS "durationMinutes",
        s.location AS "location",
        s.address AS "address",
        s.timezone AS "timezone"
      FROM session s
      LEFT JOIN session_series series ON series.id = s.session_series_id
     WHERE s.trainer_id = ${trainerId}
       AND s.start > NOW()
     ORDER BY s.start ASC
     LIMIT 1
    `.execute(db)

    const nextSessionRow = nextSessionResult.rows[0]
    const nextSession = nextSessionRow
      ? nextSessionSchema.parse({
          id: nextSessionRow.id,
          title: nextSessionRow.title ?? 'Appointment',
          startTime: nextSessionRow.startTime,
          durationMinutes: nextSessionRow.durationMinutes ?? 0,
          location: nextSessionRow.location ?? null,
          address: nextSessionRow.address ?? null,
          timezone: nextSessionRow.timezone ?? null,
        })
      : null

    // Online bookable sessions count
    const onlineBookableRow = await db
      .selectFrom('session')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('trainer_id', '=', trainerId)
      .where('bookable_online', '=', true)
      .where('start', '>', sql<Date>`NOW()`)
      .executeTakeFirst()

    const onlineBookableCount = onlineBookableCountSchema.parse({
      count: onlineBookableRow?.count ?? 0,
    }).count

    const currency = parsedTrainer.defaultCurrency ?? 'USD'

    const responseBody = {
      trainer: {
        firstName: parsedTrainer.firstName ?? null,
        smsCredits:
          parsedTrainer.smsCredits === null
            ? null
            : money(parsedTrainer.smsCredits),
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
        trialDaysRemaining: trialDaysRemaining || null,
        defaultCurrency: currency,
      },
      missions,
      payments: {
        currency,
        last7Days: {
          paid: money(paymentsAgg.paid7),
          projected: money(paymentsAgg.paid7) + money(pendingAgg.pending7Total),
        },
        today: {
          paid: money(paymentsAgg.paidToday),
          projected:
            money(paymentsAgg.paidToday) + money(pendingAgg.pendingTodayTotal),
        },
        overdue: {
          count: Number(pendingAgg.overdueCount ?? 0),
          total: money(pendingAgg.overdueTotal),
        },
      },
      funds: {
        currency,
        pending: balancePending,
        available: balanceAvailable,
      },
      subscriptions: {
        activePlans: Number(activePlans ?? 0),
        activePacks: Number(activePacks ?? 0),
      },
      nextAppointment: nextSession
        ? {
          id: nextSession.id,
          title: nextSession.title,
          startTime: nextSession.startTime.toISOString(),
          durationMinutes: nextSession.durationMinutes,
          location: nextSession.location,
          address: nextSession.address,
          timezone: nextSession.timezone,
        }
        : null,
      onlineBookings: {
        bookableCount: Number(onlineBookableCount ?? 0),
      },
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues
        .map(issue => `${issue.path.join('.') || 'field'}: ${issue.message}`)
        .join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse dashboard data',
          detail: detail || 'Dashboard data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to build dashboard summary', {
      trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to build dashboard summary',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
