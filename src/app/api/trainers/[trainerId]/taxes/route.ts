import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const taxSchema = z.object({
  id: z.string(),
  trainerId: z.string(),
  label: z.string().nullable(),
  percent: z.number().nullable(),
  enabled: z.boolean(),
})

const taxListSchema = z.array(taxSchema)

type RawTaxRow = {
  id: string | null
  trainerId: string | null
  label: string | null
  percent: string | number | null
  enabled: boolean | string | number | null
}

const parsePercent = (value: string | number | null): number | null => {
  if (value === null) {
    return null
  }

  const numeric = typeof value === 'number' ? value : Number.parseFloat(value.trim())

  if (!Number.isFinite(numeric)) {
    throw new Error('Invalid percent value encountered in tax record')
  }

  return numeric
}

const normalizeTaxRow = (row: RawTaxRow): z.input<typeof taxSchema> => {
  if (!row.id || !row.trainerId) {
    throw new Error('Tax row missing required identifiers')
  }

  let enabled: boolean | null = null
  if (row.enabled === true || row.enabled === false) {
    enabled = row.enabled
  } else if (typeof row.enabled === 'string') {
    const normalized = row.enabled.trim().toLowerCase()
    if (normalized === 't' || normalized === 'true' || normalized === '1') {
      enabled = true
    } else if (normalized === 'f' || normalized === 'false' || normalized === '0') {
      enabled = false
    }
  } else if (typeof row.enabled === 'number') {
    enabled = row.enabled === 1
  }

  if (enabled === null) {
    throw new Error('Tax row missing enabled flag')
  }

  return {
    id: row.id,
    trainerId: row.trainerId,
    label: row.label ?? null,
    percent: parsePercent(row.percent),
    enabled,
  }
}

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/taxes'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsParse = paramsSchema.safeParse(await context.params)
  if (!paramsParse.success) {
    const detail = paramsParse.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId } = paramsParse.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching taxes',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to access taxes for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    const result = await sql<RawTaxRow>`
      SELECT
        id,
        trainer_id AS "trainerId",
        label,
        percent,
        enabled
      FROM tax
      WHERE trainer_id = ${authorization.trainerId}
      ORDER BY id
    `.execute(db)

    const rows = result.rows

    if (rows.length !== 3) {
      console.error('Unexpected number of tax records returned', {
        trainerId,
        count: rows.length,
      })
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch taxes',
          detail: 'Unexpected number of tax records returned.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    const normalizedRows = rows.map(normalizeTaxRow)
    const taxes = taxListSchema.parse(normalizedRows)

    return NextResponse.json(taxes)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse tax data from database',
          detail: 'Tax data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch taxes', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch taxes',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
