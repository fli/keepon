import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'

export const runtime = 'nodejs'

const requestSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Current password is required'),
  password: z
    .string()
    .min(5, 'Password must be at least 5 characters long'),
})

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
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
    const rawBody = (await request.json()) as unknown
    const validation = requestSchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues
        .map(issue => issue.message)
        .join('; ')

      return invalidBodyResponse(detail || undefined)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse change password request body', error)
    return invalidJsonResponse()
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while changing password',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const { currentPassword, password: newPassword } = parsedBody

    const result = await sql<{ id: string }>`
      SELECT change_password AS "id"
        FROM change_password(
          trainer_id => ${authorization.trainerId},
          current_password => ${currentPassword},
          new_password => ${newPassword}
        )
    `.execute(db)

    const row = result.rows[0]

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
