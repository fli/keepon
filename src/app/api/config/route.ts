import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

export const runtime = 'nodejs'

const configSchema = z.object({
  stripePublishableKey: z.string().trim().min(1, 'STRIPE_PUBLISHABLE_KEY must not be empty.'),
  googlePublishableKey: z.string().trim().min(1, 'GOOGLE_PUBLISHABLE_KEY must not be empty.'),
  appleClientId: z.string().trim().min(1, 'APPLE_CLIENT_ID must not be empty.'),
})

export async function GET() {
  try {
    const parseResult = configSchema.safeParse({
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      googlePublishableKey: process.env.GOOGLE_PUBLISHABLE_KEY,
      appleClientId: process.env.APPLE_CLIENT_ID,
    })

    if (!parseResult.success) {
      const detail = parseResult.error.issues
        .map(issue => issue.message)
        .join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Missing configuration values',
          detail:
            detail ||
            'Required public configuration values are missing or invalid.',
          type: '/missing-configuration',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json(parseResult.data)
  } catch (error) {
    console.error('Failed to load public configuration values', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to load configuration',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
