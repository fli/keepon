import { NextResponse } from 'next/server'
import {
  authenticateTrainerOrClientRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { logout } from '@/server/auth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while logging out trainer access token',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while logging out client access token',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    await logout(authorization.accessToken)

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to log out member', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to log out',
        detail: 'An unexpected error occurred while logging out.',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
