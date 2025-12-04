import { db, sql } from '@/lib/db'
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres'
import { z } from 'zod'
// Single-query dashboard fetch using Kysely + json helpers to keep everything in one round trip

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

const dashboardRowSchema = z.object({
  trainerFirstName: z.string().nullable(),
  trainerSmsCredits: z.union([z.number(), z.string(), z.null()]),
  trainerDefaultCurrency: z.string().nullable(),
  trainerTimezone: z.string().nullable(),
  trainerCreatedAt: z.union([z.date(), z.string(), z.null()]),
  trialStartTime: z.union([z.date(), z.string(), z.null()]),
  trialEndTime: z.union([z.date(), z.string(), z.null()]),
  stripePaymentsBlocked: z.union([z.boolean(), z.null()]),
  missions: missionListSchema.nullable(),
  paymentsPaid7: z.union([z.number(), z.string(), z.null()]),
  paymentsPaidToday: z.union([z.number(), z.string(), z.null()]),
  pendingOverdueCount: z.union([z.number(), z.string(), z.null()]),
  pendingOverdueTotal: z.union([z.number(), z.string(), z.null()]),
  pending7Total: z.union([z.number(), z.string(), z.null()]),
  pendingTodayTotal: z.union([z.number(), z.string(), z.null()]),
  activePlans: z.union([z.number(), z.string(), z.null()]),
  activePacks: z.union([z.number(), z.string(), z.null()]),
  balanceObject: stripeBalanceSchema.nullable(),
  unreadNotifications: z.union([z.number(), z.string(), z.null()]),
  nextSession: z
    .object({
      id: z.string(),
      title: z.string().nullable(),
      startTime: z.union([z.date(), z.string()]),
      durationMinutes: z.union([z.number(), z.null()]),
      location: z.string().nullable(),
      address: z.string().nullable(),
      timezone: z.string().nullable(),
    })
    .nullable(),
  onlineBookableCount: z.union([z.number(), z.string(), z.null()]),
  serviceCount: z.union([z.number(), z.string(), z.null()]),
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

export type DashboardSummary = {
  trainer: {
    firstName: string | null
    smsCredits: number | null
    trialEndsAt: string | null
    trialDaysRemaining: number | null
    defaultCurrency: string
    paymentsSetupRequired: boolean
  }
  missions: z.infer<typeof missionListSchema>
  payments: {
    currency: string
    last7Days: { projected: number; paid: number }
    today: { projected: number; paid: number }
    overdue: { count: number; total: number }
  }
  funds: {
    currency: string
    pending: number
    available: number
  }
  subscriptions: {
    activePlans: number
    activePacks: number
  }
  nextAppointment: {
    id: string
    title: string
    startTime: string
    durationMinutes: number
    location: string | null
    address: string | null
    timezone: string | null
  } | null
  onlineBookings: {
    bookableCount: number
    serviceCount: number
  }
  notifications: {
    hasUnread: boolean
  }
}

export async function getDashboardSummary(
  trainerId: string,
  userId: string
): Promise<DashboardSummary> {
  const revenueCte = db
    .selectFrom('payment as p')
    .select([
      sql`p.amount::numeric`.as('amount'),
      sql`p.created_at`.as('ts'),
    ])
    .where('p.trainer_id', '=', trainerId)
    .where('p.refunded_time', 'is', null)
    .where(({ eb, ref }) =>
      eb
        .or([
          eb(ref('p.is_manual'), '=', true),
          eb(ref('p.is_stripe'), '=', true),
          eb(ref('p.is_credit_pack'), '=', true),
          eb(ref('p.is_subscription'), '=', true),
        ])
    )
    .unionAll(
      db
        .selectFrom('payment_plan_payment as ppp')
        .innerJoin('payment_plan as pp', 'pp.id', 'ppp.payment_plan_id')
        .select([
          sql`ppp.amount::numeric`.as('amount'),
          sql`ppp.date`.as('ts'),
        ])
        .where('pp.trainer_id', '=', trainerId)
        .where('ppp.status', '=', 'paid')
    )
    .unionAll(
      db
        .selectFrom('finance_item as fi')
        .select([
          sql`fi.amount::numeric`.as('amount'),
          sql`fi.start_date`.as('ts'),
        ])
        .where('fi.trainer_id', '=', trainerId)
        .where('fi.amount', '>', '0')
    )

  const pendingCte = db
    .selectFrom('payment_plan_payment as ppp')
    .innerJoin('payment_plan as pp', 'pp.id', 'ppp.payment_plan_id')
    .where('pp.trainer_id', '=', trainerId)
    .where('ppp.status', 'not in', [
      'paid',
      'cancelled',
      'refunded',
      'paused',
    ])
    .select(() => [
      sql`COALESCE(SUM(CASE WHEN ppp.date < NOW() THEN 1 ELSE 0 END), 0)::numeric`.as(
        'overdueCount'
      ),
      sql`COALESCE(SUM(CASE WHEN ppp.date < NOW() THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric`.as(
        'overdueTotal'
      ),
      sql`COALESCE(SUM(CASE WHEN ppp.date >= NOW() AND ppp.date < NOW() + INTERVAL '7 days' THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric`.as(
        'pending7Total'
      ),
      sql`COALESCE(SUM(CASE WHEN ppp.date >= date_trunc('day', NOW()) AND ppp.date < date_trunc('day', NOW()) + INTERVAL '1 day' THEN ppp.amount_outstanding ELSE 0 END), 0)::numeric`.as(
        'pendingTodayTotal'
      ),
    ])

  const creditUsageCte = db
    .selectFrom('payment_credit_pack as pcp')
    .select([
      'pcp.sale_credit_pack_id',
      sql`COALESCE(SUM(pcp.credits_used), 0)::int`.as('credits_used'),
    ])
    .groupBy('pcp.sale_credit_pack_id')

  const row = await db
    .with('revenue', () => revenueCte)
    .with('pending', () => pendingCte)
    .with('credit_usage', () => creditUsageCte)
    .selectFrom('vw_legacy_trainer as t')
    .innerJoin('trainer as tr', 'tr.id', 't.id')
    .select([
      't.first_name as trainerFirstName',
      't.sms_credit_balance as trainerSmsCredits',
      't.default_currency as trainerDefaultCurrency',
      't.timezone as trainerTimezone',
      't.created_at as trainerCreatedAt',
      'tr.stripe_payments_blocked as stripePaymentsBlocked',
    ])
    .select((eb) => [
      eb
        .selectFrom('trial')
        .select('start_time')
        .where('trainer_id', '=', trainerId)
        .orderBy('end_time', 'desc')
        .limit(1)
        .as('trialStartTime'),
      eb
        .selectFrom('trial')
        .select('end_time')
        .where('trainer_id', '=', trainerId)
        .orderBy('end_time', 'desc')
        .limit(1)
        .as('trialEndTime'),
      jsonArrayFrom(
        eb
          .selectFrom('mission')
          .innerJoin('mission_type', 'mission_type.id', 'mission.id')
          .leftJoin('reward', 'reward.id', 'mission.reward_id')
          .where('mission.trainer_id', '=', trainerId)
          .select(sub => [
            sql`mission.id::text`.as('id'),
            sql`mission.display_order`.as('displayOrder'),
            sql`mission.reward_id::text`.as('rewardId'),
            sql`reward.claimed_at IS NOT NULL`.as('rewardClaimed'),
            sql`mission.completed_at IS NOT NULL`.as('completed'),
            sub.ref('mission_type.title').as('title'),
            sub.ref('mission_type.description').as('description'),
            sub.ref('mission_type.action_url').as('actionUrl'),
          ])
          .orderBy('mission.display_order')
      ).as('missions'),
      eb
        .selectFrom('revenue as r')
        .select(() =>
          sql`COALESCE(SUM(CASE WHEN r.ts >= NOW() - INTERVAL '7 days' THEN r.amount ELSE 0 END), 0)::numeric`.as(
            'paymentsPaid7'
          )
        )
        .as('paymentsPaid7'),
      eb
        .selectFrom('revenue as r')
        .select(() =>
          sql`COALESCE(SUM(CASE WHEN r.ts >= date_trunc('day', NOW()) THEN r.amount ELSE 0 END), 0)::numeric`.as(
            'paymentsPaidToday'
          )
        )
        .as('paymentsPaidToday'),
      eb
        .selectFrom('pending')
        .select('overdueCount')
        .as('pendingOverdueCount'),
      eb.selectFrom('pending').select('overdueTotal').as('pendingOverdueTotal'),
      eb.selectFrom('pending').select('pending7Total').as('pending7Total'),
      eb.selectFrom('pending').select('pendingTodayTotal').as('pendingTodayTotal'),
      eb
        .selectFrom('vw_legacy_plan')
        .select(({ fn }) => fn.countAll().as('count'))
        .where('trainerId', '=', trainerId)
        .where(({ eb, ref }) => eb(ref('status'), 'not in', ['cancelled', 'ended']))
        .as('activePlans'),
      eb
        .selectFrom('sale_product as sp')
        .innerJoin('sale_credit_pack as scp', 'scp.id', 'sp.id')
        .leftJoin('credit_usage as cu', 'cu.sale_credit_pack_id', 'scp.id')
        .where('sp.trainer_id', '=', trainerId)
        .where('sp.is_credit_pack', '=', true)
        .where(sql<boolean>`scp.total_credits > COALESCE(cu.credits_used, 0)`)
        .select(({ fn }) => fn.countAll().as('count'))
        .as('activePacks'),
      eb
        .selectFrom('stripe_balance as sb')
        .select('sb.object')
        .whereRef('sb.account_id', '=', 'tr.stripe_account_id')
        .orderBy('sb.updated_at', 'desc')
        .limit(1)
        .as('balanceObject'),
      eb
        .selectFrom('vw_legacy_app_notification')
        .select(({ fn }) => fn.countAll().as('count'))
        .where('user_id', '=', userId)
        .where('viewed', '=', false)
        .as('unreadNotifications'),
      jsonObjectFrom(
        eb
          .selectFrom('session as s')
          .leftJoin('session_series as series', 'series.id', 's.session_series_id')
          .select([
            's.id',
            sql`COALESCE(series.name, s.location, 'Appointment')`.as('title'),
            sql`(EXTRACT(EPOCH FROM s.duration) / 60)::int`.as('durationMinutes'),
            's.start as startTime',
            's.location',
            's.address',
            's.timezone',
          ])
          .where('s.trainer_id', '=', trainerId)
          .where('s.start', '>', sql<Date>`NOW()`)
          .orderBy('s.start', 'asc')
          .limit(1)
      ).as('nextSession'),
      eb
        .selectFrom('session')
          .select(({ fn }) => fn.countAll().as('count'))
          .where('trainer_id', '=', trainerId)
          .where('bookable_online', '=', true)
          .where('start', '>', sql<Date>`NOW()`)
          .as('onlineBookableCount'),
      eb
        .selectFrom('product as p')
        .select(({ fn }) => fn.countAll().as('count'))
        .where('p.trainer_id', '=', trainerId)
        .where('p.is_service', '=', true)
        .as('serviceCount'),
    ])
    .where('t.id', '=', trainerId)
    .executeTakeFirst()

  if (!row) {
    throw new Error('Trainer not found')
  }

  const parsed = dashboardRowSchema.parse(row)

  const toDate = (value: string | number | Date | null | undefined) =>
    value instanceof Date ? value : value ? new Date(value) : null

  const trialEndsAt = toDate(parsed.trialEndTime)
  const now = new Date()
  const trialDaysRemaining =
    trialEndsAt && trialEndsAt > now
      ? Math.max(
          0,
          Math.ceil(
            (trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          )
        )
      : 0

  const currency = parsed.trainerDefaultCurrency ?? 'USD'

  const missions = missionListSchema.parse(parsed.missions ?? [])

  let balanceAvailable = 0
  let balancePending = 0

  if (parsed.balanceObject) {
    balanceAvailable = parsed.balanceObject.available
      .filter(entry => (currency ? entry.currency === currency : true))
      .reduce((total, entry) => total + centsToMajorUnits(entry.amount), 0)

    balancePending = parsed.balanceObject.pending
      .filter(entry => (currency ? entry.currency === currency : true))
      .reduce((total, entry) => total + centsToMajorUnits(entry.amount), 0)
  }

  const nextSession = parsed.nextSession && parsed.nextSession.id
    ? {
        id: parsed.nextSession.id,
        title: parsed.nextSession.title ?? 'Appointment',
        startTime: (toDate(parsed.nextSession.startTime) ?? new Date()).toISOString(),
        durationMinutes: parsed.nextSession.durationMinutes ?? 0,
        location: parsed.nextSession.location,
        address: parsed.nextSession.address,
        timezone: parsed.nextSession.timezone,
      }
    : null

  const paid7 = money(parsed.paymentsPaid7)
  const paidToday = money(parsed.paymentsPaidToday)
  const pending7Total = money(parsed.pending7Total)
  const pendingTodayTotal = money(parsed.pendingTodayTotal)
  const overdueCount = Number(parsed.pendingOverdueCount ?? 0)
  const overdueTotal = money(parsed.pendingOverdueTotal)
  const hasUnreadNotifications =
    Number(parsed.unreadNotifications ?? 0) > 0
  const paymentsSetupRequired = Boolean(parsed.stripePaymentsBlocked ?? false)
  const serviceCount = Number(parsed.serviceCount ?? 0)

  return {
    trainer: {
      firstName: parsed.trainerFirstName ?? null,
      smsCredits:
        parsed.trainerSmsCredits === null
          ? null
      : money(parsed.trainerSmsCredits),
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
      trialDaysRemaining: trialDaysRemaining || null,
      defaultCurrency: currency,
      paymentsSetupRequired,
    },
    missions,
    payments: {
      currency,
      last7Days: {
        paid: paid7,
        projected: paid7 + pending7Total,
      },
      today: {
        paid: paidToday,
        projected: paidToday + pendingTodayTotal,
      },
      overdue: {
        count: overdueCount,
        total: overdueTotal,
      },
    },
    funds: {
      currency,
      pending: balancePending,
      available: balanceAvailable,
    },
    subscriptions: {
      activePlans: Number(parsed.activePlans ?? 0),
      activePacks: Number(parsed.activePacks ?? 0),
    },
    nextAppointment: nextSession,
    onlineBookings: {
      bookableCount: Number(parsed.onlineBookableCount ?? 0),
      serviceCount,
    },
    notifications: {
      hasUnread: hasUnreadNotifications,
    },
  }
}
