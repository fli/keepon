import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import BigNumber from 'bignumber.js'
import sharp, { type Sharp } from 'sharp'
import Stripe from 'stripe'
import { z } from 'zod'

import { db, sql } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadBufferToPublicBucket } from '../../_lib/storage'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif'])

type UploadField = {
  formKey: string
  column: 'business_logo_url' | 'cover_image_url'
  square?: boolean
}

const uploadFields: readonly UploadField[] = [
  { formKey: 'businessLogo', column: 'business_logo_url', square: true },
  { formKey: 'businessIcon', column: 'business_logo_url', square: true },
  { formKey: 'coverImage', column: 'cover_image_url' },
]

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body must be multipart/form-data with image file fields.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInvalidFileTypeResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid file type',
      detail: detail ?? 'Only JPG, PNG, or GIF images are supported.',
      type: '/invalid-file-type',
    }),
    { status: 400 }
  )

const createMissingBucketResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Public bucket is not configured',
      detail: 'Set PUBLIC_BUCKET_NAME in the environment.',
      type: '/public-bucket-misconfigured',
    }),
    { status: 500 }
  )

const createForbiddenResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 403,
      title: 'Forbidden',
      detail: detail ?? 'You are not permitted to update this trainer.',
      type: '/forbidden',
    }),
    { status: 403 }
  )

const createNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Trainer not found',
      detail: 'No trainer exists for the authenticated token.',
      type: '/trainer-not-found',
    }),
    { status: 404 }
  )

const createUnexpectedErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Unexpected error uploading file',
      type: '/upload-failed',
    }),
    { status: 500 }
  )

type OutputFormat = 'jpg' | 'png'

const transformImage = async (
  buffer: Buffer,
  options: { square?: boolean; format: OutputFormat }
): Promise<{ buffer: Buffer; contentType: string; ext: OutputFormat }> => {
  const sharpFactory = sharp as unknown as (input: Buffer) => Sharp
  let pipeline = sharpFactory(buffer).rotate()

  if (options.square) {
    pipeline = pipeline.resize({
      width: 512,
      height: 512,
      fit: sharp.fit.cover,
      position: sharp.strategy.entropy,
      withoutEnlargement: true,
    })
  }

  if (options.format === 'png') {
    pipeline = pipeline.png({ palette: true, progressive: true })

    return {
      buffer: await pipeline.toBuffer(),
      contentType: 'image/png',
      ext: 'png',
    }
  }

  pipeline = pipeline.jpeg({
    progressive: true,
    chromaSubsampling: '4:4:4',
    trellisQuantisation: true,
    optimiseScans: true,
    optimiseCoding: true,
  })

  return {
    buffer: await pipeline.toBuffer(),
    contentType: 'image/jpeg',
    ext: 'jpg',
  }
}

const toIsoString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

const trainerResponseSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    memberId: z.string(),
    createdAt: z.string(),
    firstName: z.string(),
    timezone: z.string(),
    locale: z.string(),
    country: z.string(),
    defaultCurrency: z.string(),
    subscription: z.unknown(),
    brandColor: z.string(),
    stripeAccountId: z.string(),
    stripeAccountType: z.enum(['standard', 'custom']).nullable(),
    lastName: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    deviceId: z.string().nullable().optional(),
    stripeAccountStatus: z.string().optional(),
    firstCardPaymentProcessed: z.string().nullable().optional(),
    businessName: z.string().nullable().optional(),
    businessLogoUrl: z.string().nullable().optional(),
    coverImageUrl: z.string().nullable().optional(),
    calendarUrl: z.string().optional(),
    termsAccepted: z.boolean().optional(),
    cardPayments: z.enum(['active', 'inactive', 'pending']).optional(),
    transfers: z.enum(['active', 'inactive', 'pending']).optional(),
    bankAccount: z
      .object({
        bankName: z.string().nullable(),
        last4: z.string().nullable(),
        routingNumber: z.string().nullable(),
        status: z.enum(['new', 'errored']),
      })
      .nullable()
      .optional(),
    balance: z
      .object({
        pending: z.object({ amount: z.string(), currency: z.string() }),
        available: z.object({ amount: z.string(), currency: z.string() }),
      })
      .optional(),
    requirements: z
      .object({
        currentDeadline: z.union([z.string(), z.null()]).optional(),
        currentlyDue: z.array(z.string()).nullable().optional(),
        disabledReason: z.union([z.string(), z.null()]).optional(),
        eventuallyDue: z.array(z.string()).nullable().optional(),
        pastDue: z.array(z.string()).nullable().optional(),
        pendingVerification: z.array(z.string()).nullable().optional(),
        bankAccountIsDue: z.boolean().optional(),
        connectOnboardingCanCollect: z
          .enum(['nothing', 'onlyCurrentlyDue', 'onlyEventuallyDue', 'currentlyAndEventuallyDue'])
          .optional(),
      })
      .optional(),
    industry: z.string().nullable().optional(),
    defaultServiceProviderAppointmentReminder1: z.unknown().nullable().optional(),
    defaultServiceProviderAppointmentReminder2: z.unknown().nullable().optional(),
    defaultClientAppointmentReminder1: z.unknown().nullable().optional(),
    defaultClientAppointmentReminder2: z.unknown().nullable().optional(),
    smsCreditBalance: z.number().nullable().optional(),
    smsCreditTopUpAt: z.union([z.string(), z.null()]).optional(),
    smsCreditTopUpCount: z.number().nullable().optional(),
    defaultCanClientsCancelAppointment: z.boolean().optional(),
    defaultCancellationAdvanceNoticeDuration: z.string().optional(),
    smsCreditCheckoutId: z.string().optional(),
  })
  .passthrough()

type TrainerResponse = z.infer<typeof trainerResponseSchema>

const accountRequirements = (
  account: Stripe.Account | null
): TrainerResponse['requirements'] => {
  const requirements = account?.requirements

  const currentlyDue = (requirements?.currently_due ?? []).filter((item) => item !== 'external_account')
  const eventuallyDue = (requirements?.eventually_due ?? []).filter((item) => item !== 'external_account')
  const pendingVerification = requirements?.pending_verification ?? null
  const isCurrentlyDue = currentlyDue.length > 0
  const isEventuallyDue = eventuallyDue.length > 0
  const bankAccountIsDue =
    (requirements?.currently_due ?? []).includes('external_account') ||
    (requirements?.eventually_due ?? []).includes('external_account')

  const connectOnboardingCanCollect =
    !requirements || !account
      ? 'currentlyAndEventuallyDue'
      : (isCurrentlyDue && isEventuallyDue) || !account
        ? 'currentlyAndEventuallyDue'
        : !isCurrentlyDue && !isEventuallyDue
          ? 'nothing'
          : isCurrentlyDue && !isEventuallyDue
            ? 'onlyCurrentlyDue'
            : 'onlyEventuallyDue'

  const currentDeadline =
    typeof requirements?.current_deadline === 'number'
      ? new Date(requirements.current_deadline * 1000).toISOString()
      : (requirements?.current_deadline as string | null | undefined) ?? null

  return {
    currentDeadline,
    currentlyDue,
    disabledReason: requirements?.disabled_reason ?? null,
    eventuallyDue,
    pastDue: requirements?.past_due ?? null,
    pendingVerification,
    bankAccountIsDue,
    connectOnboardingCanCollect,
  }
}

const computeBalance = (balance: Stripe.Balance | null, currency: string): TrainerResponse['balance'] => {
  const targetCurrency = currency.toLowerCase()

  if (!balance) {
    return {
      available: { amount: '0.00', currency },
      pending: { amount: '0.00', currency },
    }
  }

  const sum = (entries: Stripe.Balance.Available[]) =>
    entries
      .filter((entry) => (entry.currency ?? '').toLowerCase() === targetCurrency)
      .reduce((acc, entry) => acc.plus(new BigNumber(entry.amount ?? 0)), new BigNumber(0))

  return {
    available: { amount: sum(balance.available ?? []).shiftedBy(-2).toString(), currency },
    pending: { amount: sum(balance.pending ?? []).shiftedBy(-2).toString(), currency },
  }
}

const buildBankAccount = (account: Stripe.BankAccount | null): TrainerResponse['bankAccount'] => {
  if (!account) return null

  return {
    bankName: account.bank_name ?? null,
    last4: account.last4 ?? null,
    routingNumber: account.routing_number ?? null,
    status: account.status === 'errored' ? 'errored' : 'new',
  }
}

type TrainerQueryRow = {
  createdAt: string
  id: string
  email: string
  firstName: string
  lastName: string | null
  phone: string | null
  deviceId: string | null
  stripeAccountStatus: string | null
  memberId: string
  firstCardPaymentProcessed: string | null
  timezone: string
  locale: string
  country: string
  defaultCurrency: string
  subscription: unknown
  termsAccepted: boolean
  businessName: string | null
  brandColor: string
  businessLogoUrl: string | null
  coverImageUrl: string | null
  industry: string | null
  defaultServiceProviderAppointmentReminder1: unknown
  defaultServiceProviderAppointmentReminder2: unknown
  defaultClientAppointmentReminder1: unknown
  defaultClientAppointmentReminder2: unknown
  smsCreditBalance: number | null
  smsCreditTopUpAt: string | null
  smsCreditTopUpCount: number | null
  calendarUrl: string
  defaultCanClientsCancelAppointment: boolean
  smsCreditCheckoutId: string
  defaultCancellationAdvanceNoticeDuration: string
  stripeAccount: unknown
  stripeBankAccount: unknown
  stripeBalance: unknown
  stripeAccountId: string | null
}

const trainerRowSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  deviceId: z.string().nullable(),
  stripeAccountStatus: z.string().nullable(),
  memberId: z.string(),
  firstCardPaymentProcessed: z.string().nullable(),
  timezone: z.string(),
  locale: z.string(),
  country: z.string(),
  defaultCurrency: z.string(),
  subscription: z.unknown(),
  termsAccepted: z.boolean(),
  businessName: z.string().nullable(),
  brandColor: z.string(),
  businessLogoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  industry: z.string().nullable(),
  defaultServiceProviderAppointmentReminder1: z.unknown().nullable(),
  defaultServiceProviderAppointmentReminder2: z.unknown().nullable(),
  defaultClientAppointmentReminder1: z.unknown().nullable(),
  defaultClientAppointmentReminder2: z.unknown().nullable(),
  smsCreditBalance: z.number().nullable(),
  smsCreditTopUpAt: z.string().nullable(),
  smsCreditTopUpCount: z.number().nullable(),
  calendarUrl: z.string(),
  defaultCanClientsCancelAppointment: z.boolean(),
  smsCreditCheckoutId: z.string(),
  defaultCancellationAdvanceNoticeDuration: z.string(),
  stripeAccount: z.unknown().nullable(),
  stripeBankAccount: z.unknown().nullable(),
  stripeBalance: z.unknown().nullable(),
  stripeAccountId: z.string().nullable(),
})

const fetchTrainer = async (trainerId: string): Promise<TrainerResponse | null> => {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  const calendarBaseUrl = `${new URL('cal', baseUrl).toString().replace(/\/$/, '')}/`

  const rowResult = await sql<TrainerQueryRow>`
    SELECT
      to_char(timezone('UTC', vw_legacy_trainer.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      vw_legacy_trainer.id,
      vw_legacy_trainer.email,
      vw_legacy_trainer.first_name AS "firstName",
      vw_legacy_trainer.last_name AS "lastName",
      vw_legacy_trainer.phone,
      vw_legacy_trainer.device_id AS "deviceId",
      vw_legacy_trainer.stripe_account_status AS "stripeAccountStatus",
      vw_legacy_trainer.member_id AS "memberId",
      to_char(timezone('UTC', vw_legacy_trainer.first_card_payment_processed), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "firstCardPaymentProcessed",
      vw_legacy_trainer.timezone,
      vw_legacy_trainer.locale,
      vw_legacy_trainer.country,
      vw_legacy_trainer.default_currency AS "defaultCurrency",
      vw_legacy_trainer.subscription,
      vw_legacy_trainer.terms_accepted AS "termsAccepted",
      vw_legacy_trainer.business_name AS "businessName",
      trainer.brand_color AS "brandColor",
      trainer.business_logo_url AS "businessLogoUrl",
      trainer.cover_image_url AS "coverImageUrl",
      trainer.industry,
      vw_legacy_trainer.default_service_provider_appointment_reminder_1 AS "defaultServiceProviderAppointmentReminder1",
      vw_legacy_trainer.default_service_provider_appointment_reminder_2 AS "defaultServiceProviderAppointmentReminder2",
      vw_legacy_trainer.default_client_appointment_reminder_1 AS "defaultClientAppointmentReminder1",
      vw_legacy_trainer.default_client_appointment_reminder_2 AS "defaultClientAppointmentReminder2",
      vw_legacy_trainer.sms_credit_balance AS "smsCreditBalance",
      vw_legacy_trainer.sms_credit_top_up_at AS "smsCreditTopUpAt",
      vw_legacy_trainer.sms_credit_top_up_count AS "smsCreditTopUpCount",
      ${calendarBaseUrl} || trainer.icalendar_url_slug AS "calendarUrl",
      trainer.default_can_clients_cancel_appointment AS "defaultCanClientsCancelAppointment",
      trainer.sms_credit_checkout_id AS "smsCreditCheckoutId",
      trainer.default_cancellation_advance_notice_duration::text AS "defaultCancellationAdvanceNoticeDuration",
      stripe.account.object AS "stripeAccount",
      (
        SELECT object
          FROM stripe.bank_account
         WHERE object->>'account' = trainer.stripe_account_id
           AND object->>'default_for_currency' = 'true'
         LIMIT 1
      ) AS "stripeBankAccount",
      stripe_balance.object AS "stripeBalance",
      trainer.stripe_account_id AS "stripeAccountId"
    FROM vw_legacy_trainer
    JOIN trainer ON trainer.id = vw_legacy_trainer.id
    LEFT JOIN stripe.account ON trainer.stripe_account_id = stripe.account.id
    LEFT JOIN stripe_balance ON stripe_balance.account_id = trainer.stripe_account_id
    WHERE trainer.id = ${trainerId}
    LIMIT 1
  `.execute(db)

  const row = rowResult.rows[0]
  if (!row) return null

  const parsedRow = trainerRowSchema.parse(row)

  const stripeAccount = (parsedRow.stripeAccount ?? null) as Stripe.Account | null
  const stripeBalance = (parsedRow.stripeBalance ?? null) as Stripe.Balance | null
  const stripeBankAccount = (parsedRow.stripeBankAccount ?? null) as Stripe.BankAccount | null

  const pendingVerification =
    (stripeAccount?.requirements?.pending_verification ?? []).length > 0
  const cardPayments = stripeAccount?.charges_enabled
    ? 'active'
    : pendingVerification
      ? 'pending'
      : 'inactive'
  const transfers = stripeAccount?.payouts_enabled
    ? 'active'
    : pendingVerification
      ? 'pending'
      : 'inactive'

  const stripeAccountId = stripeAccount?.id ?? parsedRow.stripeAccountId ?? ''
  const stripeAccountType: TrainerResponse['stripeAccountType'] =
    stripeAccount?.type === 'standard' ? 'standard' : 'custom'

  const subscription = parsedRow.subscription ?? { status: 'limited' }

  const trainer: TrainerResponse = {
    id: parsedRow.id,
    email: parsedRow.email,
    memberId: parsedRow.memberId,
    createdAt: toIsoString(parsedRow.createdAt) ?? parsedRow.createdAt,
    firstName: parsedRow.firstName,
    lastName: parsedRow.lastName,
    phone: parsedRow.phone,
    timezone: parsedRow.timezone,
    locale: parsedRow.locale,
    country: parsedRow.country,
    defaultCurrency: parsedRow.defaultCurrency,
    subscription,
    brandColor: parsedRow.brandColor,
    stripeAccountId,
    stripeAccountType,
    deviceId: parsedRow.deviceId ?? undefined,
    stripeAccountStatus: parsedRow.stripeAccountStatus ?? undefined,
    firstCardPaymentProcessed: toIsoString(parsedRow.firstCardPaymentProcessed) ?? null,
    businessName: parsedRow.businessName,
    businessLogoUrl: parsedRow.businessLogoUrl,
    coverImageUrl: parsedRow.coverImageUrl,
    calendarUrl: parsedRow.calendarUrl,
    termsAccepted: parsedRow.termsAccepted,
    cardPayments,
    transfers,
    bankAccount: buildBankAccount(stripeBankAccount),
    balance: computeBalance(stripeBalance, parsedRow.defaultCurrency),
    requirements: accountRequirements(stripeAccount),
    industry: parsedRow.industry,
    defaultServiceProviderAppointmentReminder1: parsedRow.defaultServiceProviderAppointmentReminder1,
    defaultServiceProviderAppointmentReminder2: parsedRow.defaultServiceProviderAppointmentReminder2,
    defaultClientAppointmentReminder1: parsedRow.defaultClientAppointmentReminder1,
    defaultClientAppointmentReminder2: parsedRow.defaultClientAppointmentReminder2,
    smsCreditBalance: parsedRow.smsCreditBalance,
    smsCreditTopUpAt: toIsoString(parsedRow.smsCreditTopUpAt),
    smsCreditTopUpCount: parsedRow.smsCreditTopUpCount,
    defaultCanClientsCancelAppointment: parsedRow.defaultCanClientsCancelAppointment,
    defaultCancellationAdvanceNoticeDuration: parsedRow.defaultCancellationAdvanceNoticeDuration,
    smsCreditCheckoutId: parsedRow.smsCreditCheckoutId,
  }

  return trainerResponseSchema.parse(trainer)
}

export async function POST(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while uploading trainer images',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createInvalidBodyResponse()
  }

  const idField = formData.get('id')
  if (typeof idField === 'string' && idField.trim().length > 0) {
    if (idField !== authorization.trainerId) {
      return createForbiddenResponse('Trainer id does not match authenticated trainer.')
    }
  }

  const { fileTypeFromBuffer } = await import('file-type')

  const uploads: Partial<Record<UploadField['column'], string>> = {}

  try {
    for (const field of uploadFields) {
      const file = formData.get(field.formKey)

      if (!file || !(file instanceof File) || file.size === 0) {
        continue
      }

      if (file.size > MAX_FILE_BYTES) {
        return createInvalidBodyResponse('Image file is larger than 5MB.')
      }

      let buffer: Buffer
      try {
        buffer = Buffer.from(await file.arrayBuffer())
      } catch (error) {
        console.error('Failed to read trainer upload buffer', {
          trainerId: authorization.trainerId,
          field: field.formKey,
          error,
        })
        return createInvalidBodyResponse('Unable to read uploaded image.')
      }

      const detected = await fileTypeFromBuffer(buffer)

      const ext = detected?.ext?.toLowerCase()
      if (!detected || !ext || !allowedExtensions.has(ext)) {
        return createInvalidFileTypeResponse()
      }

      const format: OutputFormat = ext === 'png' ? 'png' : 'jpg'
      const square = field.square === true

      const transformed = await transformImage(buffer, { square, format })

      const filename = `${field.formKey}-${authorization.trainerId}-${randomUUID()}.${transformed.ext}`

      const uploadedUrl = await uploadBufferToPublicBucket({
        buffer: transformed.buffer,
        filename,
        contentType: transformed.contentType,
      })

      uploads[field.column] = uploadedUrl
    }
  } catch (error) {
    if (error instanceof PublicBucketNotConfiguredError) {
      return createMissingBucketResponse()
    }

    console.error('Failed to upload trainer image', {
      trainerId: authorization.trainerId,
      error,
    })

    return createUnexpectedErrorResponse()
  }

  if (Object.keys(uploads).length > 0) {
    const updated = await db
      .updateTable('trainer')
      .set(uploads)
      .where('trainer.id', '=', authorization.trainerId)
      .returning('trainer.id')
      .executeTakeFirst()

    if (!updated) {
      return createNotFoundResponse()
    }
  }

  try {
    const trainer = await fetchTrainer(authorization.trainerId)

    if (!trainer) {
      return createNotFoundResponse()
    }

    return NextResponse.json(trainer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data from database',
          detail: 'Trainer data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer after upload', {
      trainerId: authorization.trainerId,
      error,
    })

    return createUnexpectedErrorResponse()
  }
}
