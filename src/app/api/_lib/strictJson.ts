import { NextResponse } from 'next/server'
import { buildErrorResponse } from './accessToken'

export const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

export const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

type ParseResult =
  | {
      ok: true
      data: unknown
      raw: string
    }
  | {
      ok: false
      response: NextResponse
    }

const isLikelyJsonContainer = (value: string) => {
  const first = value.trim()[0]
  return first === '{' || first === '['
}

export const parseStrictJsonBody = async (request: Request): Promise<ParseResult> => {
  const raw = await request.text()
  if (!raw || raw.trim().length === 0) {
    return { ok: true, data: {}, raw }
  }

  if (!isLikelyJsonContainer(raw)) {
    return { ok: false, response: createLegacyInvalidJsonResponse() }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') {
      return { ok: false, response: createLegacyInvalidJsonResponse() }
    }
    return { ok: true, data: parsed, raw }
  } catch {
    return { ok: false, response: createLegacyInvalidJsonResponse() }
  }
}
