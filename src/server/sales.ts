import { addDays } from 'date-fns'
import { z } from 'zod'
import { APP_NAME, NO_REPLY_EMAIL } from '@/app/api/_lib/constants'
import { db } from '@/lib/db'

const tailwind600: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  emerald: '#059669',
  fuchsia: '#c026d3',
  green: '#16a34a',
  indigo: '#4f46e5',
  lightBlue: '#0284c7',
  lime: '#65a30d',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  red: '#dc2626',
  rose: '#e11d48',
  sky: '#0284c7',
  teal: '#0d9488',
  violet: '#7c3aed',
  yellow: '#ca8a04',
}

const resolveBrandColor = (value?: string | null) => (value && tailwind600[value]) ?? tailwind600.blue

const escapeHtml = (value: string) =>
  value
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const buildPaymentRequestEmail = (options: {
  serviceProviderName: string
  brandColor?: string | null
  businessLogoUrl?: string | null
  link: URL
}) => {
  const serviceProvider = options.serviceProviderName.trim() || `${APP_NAME} Team`
  const buttonColor = resolveBrandColor(options.brandColor)
  const logo = options.businessLogoUrl
    ? `<img src="${options.businessLogoUrl}" alt="${escapeHtml(
        serviceProvider
      )}" style="max-width:160px;height:auto;border-radius:12px;" />`
    : ''

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                ${logo}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;text-align:center;padding-bottom:12px;">
                Payment Request
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:16px;text-align:center;">
                ${escapeHtml(serviceProvider)} has sent you a payment request. Please visit your dashboard to review and complete the payment.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 0;">
                <a href="${options.link.toString()}" style="background:${buttonColor};color:#ffffff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">
                  Go to Dashboard
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#6b7280;padding-top:12px;text-align:center;">
                If the button does not work, copy and paste this link into your browser:<br />
                <a href="${options.link.toString()}" style="color:${buttonColor};">${escapeHtml(options.link.toString())}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

const saleDetailsSchema = z.object({
  saleId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientUserId: z.string().uuid(),
  clientEmail: z.string().email().nullable(),
  serviceProviderName: z.string(),
  brandColor: z.string().nullable(),
  businessLogoUrl: z.string().nullable(),
})

export class SaleNotFoundError extends Error {
  constructor() {
    super('Sale not found')
    this.name = 'SaleNotFoundError'
  }
}

export class ClientHasNoEmailError extends Error {
  constructor() {
    super('Client has no email')
    this.name = 'ClientHasNoEmailError'
  }
}

export class AccessTokenCreationError extends Error {
  constructor() {
    super('Failed to create client dashboard access token')
    this.name = 'AccessTokenCreationError'
  }
}

const createSaleSchema = z.object({
  clientId: z.string().min(1),
  clientSessionId: z.string().uuid().nullable().optional(),
  dueAfter: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  paymentRequestPassOnTransactionFee: z.boolean().optional(),
})

const saleIdSchema = z.object({
  id: z.string(),
})

const parseDueAfter = (value?: string | null) => {
  if (!value || value.trim().length === 0) {
    return new Date()
  }

  const match = /^P(?:(\d+)W)?(?:(\d+)D)?$/i.exec(value.trim())
  if (!match) {
    return new Date()
  }

  const weeks = match[1] ? Number.parseInt(match[1], 10) : 0
  const days = match[2] ? Number.parseInt(match[2], 10) : 0
  const totalDays = weeks * 7 + days
  if (!Number.isFinite(totalDays) || totalDays <= 0) {
    return new Date()
  }

  return new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000)
}

export async function createSaleForTrainer(
  trainerId: string,
  payload: z.infer<typeof createSaleSchema>
): Promise<z.infer<typeof saleIdSchema>> {
  const parsed = createSaleSchema.parse(payload)

  const created = await db.transaction().execute(async (trx) => {
    const sale = await trx
      .insertInto('sale')
      .values({
        trainer_id: trainerId,
        client_id: parsed.clientId,
        note: parsed.note ?? '',
        due_time: parseDueAfter(parsed.dueAfter),
        payment_request_pass_on_transaction_fee: parsed.paymentRequestPassOnTransactionFee ?? false,
      })
      .returning('id')
      .executeTakeFirst()

    if (!sale) {
      throw new Error('Failed to create sale')
    }

    await trx.insertInto('sale_payment_status').values({ sale_id: sale.id, payment_status: 'none' }).execute()

    if (parsed.clientSessionId) {
      const updated = await trx
        .updateTable('client_session')
        .set({ sale_id: sale.id })
        .where('id', '=', parsed.clientSessionId)
        .where('trainer_id', '=', trainerId)
        .returning('id')
        .executeTakeFirst()

      if (!updated) {
        throw new Error('Client session not found for trainer')
      }
    }

    return sale
  })

  return saleIdSchema.parse(created)
}

export async function requestPaymentForSale(trainerId: string, saleId: string) {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

  await db.transaction().execute(async (trx) => {
    const now = new Date()
    const saleRow = await trx
      .updateTable('sale')
      .set({ payment_request_time: now, updated_at: now })
      .where('id', '=', saleId)
      .where('trainer_id', '=', trainerId)
      .returning(['id', 'client_id'])
      .executeTakeFirst()

    if (!saleRow) {
      throw new SaleNotFoundError()
    }

    await trx
      .updateTable('sale_payment_status')
      .set({ payment_status: 'requested' })
      .where('sale_id', '=', saleId)
      .execute()

    const detailsRow = await trx
      .selectFrom('sale as sale')
      .innerJoin('client', 'client.id', 'sale.client_id')
      .innerJoin('trainer', 'trainer.id', 'sale.trainer_id')
      .select((eb) => [
        eb.ref('sale.id').as('saleId'),
        eb.ref('client.id').as('clientId'),
        eb.ref('client.user_id').as('clientUserId'),
        eb.ref('client.email').as('clientEmail'),
        eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
        eb.ref('trainer.business_name').as('businessName'),
        eb.ref('trainer.first_name').as('firstName'),
        eb.ref('trainer.last_name').as('lastName'),
        eb.ref('trainer.brand_color').as('brandColor'),
        eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
      ])
      .where('sale.id', '=', saleId)
      .where('sale.trainer_id', '=', trainerId)
      .executeTakeFirst()

    if (!detailsRow) {
      throw new SaleNotFoundError()
    }

    const serviceProviderName =
      detailsRow.onlineBookingsBusinessName ??
      detailsRow.businessName ??
      `${detailsRow.firstName}${detailsRow.lastName ? ` ${detailsRow.lastName}` : ''}`

    const details = saleDetailsSchema.parse({
      saleId: detailsRow.saleId,
      clientId: detailsRow.clientId,
      clientUserId: detailsRow.clientUserId,
      clientEmail: detailsRow.clientEmail,
      serviceProviderName,
      brandColor: detailsRow.brandColor,
      businessLogoUrl: detailsRow.businessLogoUrl,
    })

    if (!details.clientEmail) {
      throw new ClientHasNoEmailError()
    }

    const tokenRow = await trx
      .insertInto('access_token')
      .values({
        user_id: details.clientUserId,
        user_type: 'client',
        type: 'client_dashboard',
        expires_at: addDays(now, 7),
      })
      .returning('id')
      .executeTakeFirst()

    if (!tokenRow) {
      throw new AccessTokenCreationError()
    }

    const link = new URL(baseUrl)
    link.hash = `/client/${details.clientId}/${tokenRow.id}?email=${encodeURIComponent(details.clientEmail)}`
    link.searchParams.set('next', `/client-dashboard/sales/${details.saleId}`)

    const html = buildPaymentRequestEmail({
      serviceProviderName: details.serviceProviderName,
      brandColor: details.brandColor,
      businessLogoUrl: details.businessLogoUrl,
      link,
    })

    const senderName = details.serviceProviderName.trim() || `${APP_NAME} Team`
    const subject = `Payment Request from ${senderName}`

    await trx
      .insertInto('mail')
      .values({
        trainer_id: trainerId,
        client_id: details.clientId,
        from_email: NO_REPLY_EMAIL,
        from_name: `${senderName} via ${APP_NAME}`,
        to_email: details.clientEmail,
        to_name: null,
        subject,
        html,
        reply_to: null,
      })
      .execute()
  })

  return { status: 'requested' as const }
}
