import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateClientRequest,
  buildErrorResponse,
} from '../_lib/accessToken'

export const runtime = 'nodejs'

const serviceProviderSchema = z.object({
  firstName: z.string(),
  brandColor: z.string(),
  country: z.string(),
  currency: z.string(),
  lastName: z.string().nullable().optional(),
  businessName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  businessLogoUrl: z.string().nullable().optional(),
})

type ServiceProvider = z.infer<typeof serviceProviderSchema>

export async function GET(request: Request) {
  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching service provider',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = await db
      .selectFrom('client')
      .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
      .innerJoin(
        'vw_legacy_trainer',
        'vw_legacy_trainer.id',
        'trainer.id'
      )
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select(({ ref, fn }) => [
        ref('trainer.first_name').as('firstName'),
        ref('trainer.last_name').as('lastName'),
        fn
          .coalesce(
            ref('trainer.business_name'),
            ref('trainer.online_bookings_business_name')
          )
          .as('businessName'),
        ref('trainer.online_bookings_contact_email').as('contactEmail'),
        ref('trainer.online_bookings_contact_number').as('contactNumber'),
        ref('trainer.brand_color').as('brandColor'),
        ref('trainer.business_logo_url').as('businessLogoUrl'),
        ref('country.alpha_2_code').as('country'),
        ref('vw_legacy_trainer.default_currency').as('currency'),
      ])
      .where('client.id', '=', authorization.clientId)
      .limit(1)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Service provider not found',
          detail:
            'No service provider is associated with the authenticated client.',
          type: '/service-provider-not-found',
        }),
        { status: 404 }
      )
    }

    let serviceProvider: ServiceProvider
    try {
      serviceProvider = serviceProviderSchema.parse({
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? null,
        businessName: row.businessName ?? null,
        contactEmail: row.contactEmail ?? null,
        contactNumber: row.contactNumber ?? null,
        brandColor: row.brandColor ?? undefined,
        businessLogoUrl: row.businessLogoUrl ?? null,
        country: row.country ?? undefined,
        currency: row.currency ?? undefined,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to parse service provider data from database',
            detail:
              'Service provider data did not match the expected response schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }
      throw error
    }

    return NextResponse.json(serviceProvider)
  } catch (error) {
    console.error('Failed to fetch service provider', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch service provider',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
