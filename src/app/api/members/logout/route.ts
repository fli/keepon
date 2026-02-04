import { NextResponse } from 'next/server'
import { logout } from '@/server/auth'
import { authenticateTrainerOrClientRequest, buildErrorResponse } from '../../_lib/accessToken'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const legacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const rawBody = await request.text()
    if (rawBody.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawBody)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return legacyInvalidJsonResponse()
        }
      } catch {
        return legacyInvalidJsonResponse()
      }
    }
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage: 'Failed to extend access token expiry while logging out trainer access token',
    clientExtensionFailureLogMessage: 'Failed to extend access token expiry while logging out client access token',
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
