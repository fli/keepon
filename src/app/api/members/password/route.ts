import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const requestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  password: z.string().min(5, 'Password must be at least 5 characters long'),
})

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const incorrectPasswordResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your password was incorrect.',
      type: '/incorrect-password',
    }),
    { status: 400 }
  )

const changePasswordFailureResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to change password',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof requestSchema>

  try {
    const rawText = await request.text()
    const parsed = JSON.parse(rawText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalidJsonResponse()
    }
    const validation = requestSchema.safeParse(parsed)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')

      return invalidBodyResponse(detail || undefined)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse change password request body', error)
    return invalidJsonResponse()
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while changing password',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const { currentPassword, password: newPassword } = parsedBody

    const row = await db
      .selectNoFrom((eb) =>
        eb
          .fn<string>('change_password', [
            eb.val(authorization.trainerId),
            eb.val(currentPassword),
            eb.val(newPassword),
          ])
          .as('id')
      )
      .executeTakeFirst()

    if (!row?.id) {
      console.error('Change password function did not return an access token', {
        trainerId: authorization.trainerId,
      })
      return changePasswordFailureResponse()
    }

    return NextResponse.json({ id: row.id })
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthenticated') {
      return incorrectPasswordResponse()
    }

    console.error('Failed to change password', {
      trainerId: authorization.trainerId,
      error,
    })
    return changePasswordFailureResponse()
  }
}
