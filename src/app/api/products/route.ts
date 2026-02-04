import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { sanitizeProductQuery, listProducts } from '@/server/products'
import type { Insertable } from 'kysely'
import type { Service } from '@/lib/db/generated'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const moneyRegex = /^(?:-\d)?\d*?(?:\.\d+)?$/

const nullableTrimmedToNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined
    if (value === null) return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()
  .optional()

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const invalidParametersResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail,
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

export async function GET(request: Request) {
  const paramsOrResponse = sanitizeProductQuery(request)
  if (paramsOrResponse instanceof NextResponse) {
    return paramsOrResponse
  }
  const params = paramsOrResponse

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching products',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const products = await listProducts(authorization.trainerId, params)

    return NextResponse.json(products)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data from database',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch products', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch products',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  let rawBody: unknown
  try {
    const text = await request.text()
    if (text.trim().length === 0) {
      return invalidJsonResponse()
    }
    rawBody = JSON.parse(text)
  } catch (error) {
    console.error('Failed to parse product body as JSON', error)
    return invalidJsonResponse()
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return invalidJsonResponse()
  }

  const body = rawBody as Record<string, unknown>

  const typeValue = body.type
  if (typeValue === undefined) {
    return invalidParametersResponse('type  not provided')
  }
  if (typeof typeValue !== 'string') {
    return invalidParametersResponse('type  should be string')
  }
  if (!['creditPack', 'item', 'service'].includes(typeValue)) {
    return invalidParametersResponse('type  should be "creditPack" or  should be "item" or  should be "service"')
  }

  const priceValue = body.price
  if (priceValue === undefined) {
    return invalidParametersResponse('price  not provided')
  }
  if (typeof priceValue !== 'string') {
    return invalidParametersResponse('price  should be string')
  }
  const trimmedPrice = priceValue.trim()
  if (!moneyRegex.test(trimmedPrice)) {
    return invalidParametersResponse('price  should be Money')
  }
  if (Number.parseFloat(trimmedPrice) < 0) {
    return invalidParametersResponse('price  should be greater than or equal to 0')
  }

  const currencyValue = body.currency
  if (currencyValue === undefined) {
    return invalidParametersResponse('currency  not provided')
  }
  if (typeof currencyValue !== 'string') {
    return invalidParametersResponse('currency  should be string')
  }

  const nameValue = body.name
  if (nameValue === undefined) {
    return invalidParametersResponse('name  not provided')
  }
  if (typeof nameValue !== 'string') {
    return invalidParametersResponse('name  should be string')
  }
  const trimmedName = nameValue.trim()
  if (!trimmedName) {
    return invalidParametersResponse('name  should be non empty')
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'description')) {
    return invalidParametersResponse('description  not provided or  not provided')
  }
  const descriptionValue = body.description
  let description: string | null
  if (descriptionValue === null) {
    description = null
  } else if (typeof descriptionValue === 'string') {
    const trimmed = descriptionValue.trim()
    description = trimmed.length > 0 ? trimmed : null
  } else {
    return invalidParametersResponse('description  should be string or  should be null')
  }

  let displayOrder: number | null | undefined = undefined
  if (Object.prototype.hasOwnProperty.call(body, 'displayOrder')) {
    const displayOrderValue = body.displayOrder
    if (displayOrderValue === null) {
      displayOrder = null
    } else if (typeof displayOrderValue === 'number' && Number.isInteger(displayOrderValue)) {
      displayOrder = displayOrderValue
    } else {
      return invalidParametersResponse('displayOrder  should be integer or  should be null')
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'bookableOnline') && typeof body.bookableOnline !== 'boolean') {
    return invalidParametersResponse('bookableOnline  should be boolean')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'showPriceOnline') &&
    typeof body.showPriceOnline !== 'boolean'
  ) {
    return invalidParametersResponse('showPriceOnline  should be boolean')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'bookingPaymentType') &&
    body.bookingPaymentType !== null &&
    typeof body.bookingPaymentType !== 'string'
  ) {
    return invalidParametersResponse('bookingPaymentType  should be string or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'location') &&
    body.location !== null &&
    typeof body.location !== 'string'
  ) {
    return invalidParametersResponse('location  should be string or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'address') &&
    body.address !== null &&
    typeof body.address !== 'string'
  ) {
    return invalidParametersResponse('address  should be string or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'googlePlaceId') &&
    body.googlePlaceId !== null &&
    typeof body.googlePlaceId !== 'string'
  ) {
    return invalidParametersResponse('googlePlaceId  should be string or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'bufferMinutesBefore') &&
    (typeof body.bufferMinutesBefore !== 'number' || !Number.isInteger(body.bufferMinutesBefore) || body.bufferMinutesBefore < 0)
  ) {
    return invalidParametersResponse('bufferMinutesBefore  should be integer')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'bufferMinutesAfter') &&
    (typeof body.bufferMinutesAfter !== 'number' || !Number.isInteger(body.bufferMinutesAfter) || body.bufferMinutesAfter < 0)
  ) {
    return invalidParametersResponse('bufferMinutesAfter  should be integer')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'timeSlotFrequencyMinutes') &&
    (typeof body.timeSlotFrequencyMinutes !== 'number' ||
      !Number.isInteger(body.timeSlotFrequencyMinutes) ||
      body.timeSlotFrequencyMinutes < 1)
  ) {
    return invalidParametersResponse('timeSlotFrequencyMinutes  should be integer')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'requestClientAddressOnline') &&
    body.requestClientAddressOnline !== null &&
    body.requestClientAddressOnline !== 'optional' &&
    body.requestClientAddressOnline !== 'required'
  ) {
    return invalidParametersResponse('requestClientAddressOnline  should be "optional" or  should be "required" or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'bookingQuestion') &&
    body.bookingQuestion !== null &&
    typeof body.bookingQuestion !== 'string'
  ) {
    return invalidParametersResponse('bookingQuestion  should be string or  should be null')
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'bookingQuestionState') &&
    body.bookingQuestionState !== null &&
    body.bookingQuestionState !== 'optional' &&
    body.bookingQuestionState !== 'required'
  ) {
    return invalidParametersResponse('bookingQuestionState  should be "optional" or  should be "required" or  should be null')
  }

  let totalCredits: number | null = null
  let durationMinutes: number | null = null
  if (typeValue === 'creditPack') {
    if (!Object.prototype.hasOwnProperty.call(body, 'totalCredits')) {
      return invalidParametersResponse('totalCredits  not provided')
    }
    const creditsValue = body.totalCredits
    if (typeof creditsValue !== 'number' || !Number.isInteger(creditsValue)) {
      return invalidParametersResponse('totalCredits  should be integer')
    }
    if (creditsValue < 0) {
      return invalidParametersResponse('totalCredits  should be greater than or equal to 0')
    }
    totalCredits = creditsValue
  }

  if (typeValue === 'service') {
    if (!Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
      return invalidParametersResponse('durationMinutes  not provided')
    }
    const durationValue = body.durationMinutes
    if (typeof durationValue !== 'number' || !Number.isInteger(durationValue)) {
      return invalidParametersResponse('durationMinutes  should be integer')
    }
    if (durationValue < 1) {
      return invalidParametersResponse('durationMinutes  should be greater than or equal to 1')
    }
    durationMinutes = durationValue
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const locationParse = nullableTrimmedToNull.safeParse(body.location)
    const addressParse = nullableTrimmedToNull.safeParse(body.address)
    const googlePlaceParse = nullableTrimmedToNull.safeParse(body.googlePlaceId)
    const bookingQuestionParse = nullableTrimmedToNull.safeParse(body.bookingQuestion)
    const geoParse = geoSchema.safeParse(body.geo)

    const data = {
      type: typeValue as 'creditPack' | 'item' | 'service',
      price: trimmedPrice,
      currency: currencyValue,
      name: trimmedName,
      description,
      displayOrder,
      totalCredits,
      durationMinutes,
      bookableOnline: body.bookableOnline,
      showPriceOnline: body.showPriceOnline,
      bookingPaymentType: body.bookingPaymentType,
      location: locationParse.success ? locationParse.data : undefined,
      address: addressParse.success ? addressParse.data : undefined,
      geo: geoParse.success ? (body.geo as any) : undefined,
      googlePlaceId: googlePlaceParse.success ? googlePlaceParse.data : undefined,
      bufferMinutesBefore: body.bufferMinutesBefore,
      bufferMinutesAfter: body.bufferMinutesAfter,
      timeSlotFrequencyMinutes: body.timeSlotFrequencyMinutes,
      requestClientAddressOnline: body.requestClientAddressOnline,
      bookingQuestion: bookingQuestionParse.success ? bookingQuestionParse.data : undefined,
      bookingQuestionState: body.bookingQuestionState,
    }

    const currencyRow = await db
      .selectFrom('trainer')
      .innerJoin(
        'supported_country_currency as supportedCountryCurrency',
        'supportedCountryCurrency.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
      .select(['currency.id as currencyId', 'currency.alpha_code as currency'])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!currencyRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Could not resolve trainer currency',
          type: '/missing-currency',
        }),
        { status: 500 }
      )
    }

    const resolveBookingPaymentType = (service: z.infer<typeof serviceProductSchema>) => {
      if (service.bookingPaymentType) {
        return service.bookingPaymentType
      }

      const showPrice = service.showPriceOnline === true || service.showPriceOnline === null

      return showPrice ? 'noPrepayment' : 'hidePrice'
    }

    const productId = await db.transaction().execute(async (trx) => {
      const productRow = await trx
        .insertInto('product')
        .values({
          trainer_id: authorization.trainerId,
          name: data.name,
          description: data.description ?? '',
          price: data.price,
          currency_id: currencyRow.currencyId,
          is_credit_pack: data.type === 'creditPack' ? true : null,
          is_item: data.type === 'item' ? true : null,
          is_service: data.type === 'service' ? true : null,
          is_membership: null,
          display_order: data.displayOrder ?? null,
        })
        .returning('id')
        .executeTakeFirst()

      if (!productRow) {
        throw new Error('Failed to insert product')
      }

      if (data.type === 'creditPack') {
        await trx
          .insertInto('credit_pack')
          .values({
            id: productRow.id,
            trainer_id: authorization.trainerId,
            total_credits: data.totalCredits ?? 0,
            is_credit_pack: true,
          })
          .execute()
      } else if (data.type === 'service') {
        const bookingPaymentType = resolveBookingPaymentType(data)

        const serviceValues: Record<string, unknown> = {
          id: productRow.id,
          trainer_id: authorization.trainerId,
          duration: sql`make_interval(mins := ${data.durationMinutes ?? 0})`,
          location: data.location ?? null,
          address: data.address ?? null,
          google_place_id: data.googlePlaceId ?? null,
          geo: data.geo ? sql`point(${data.geo.lat}, ${data.geo.lng})` : null,
          bookable_online: data.bookableOnline ?? false,
          booking_payment_type: bookingPaymentType,
          is_service: true,
        }

        if (data.bufferMinutesBefore !== undefined) {
          serviceValues.buffer_minutes_before = data.bufferMinutesBefore
        }

        if (data.bufferMinutesAfter !== undefined) {
          serviceValues.buffer_minutes_after = data.bufferMinutesAfter
        }

        if (data.timeSlotFrequencyMinutes !== undefined) {
          serviceValues.time_slot_frequency_minutes = data.timeSlotFrequencyMinutes
        }

        if (data.requestClientAddressOnline !== undefined) {
          serviceValues.request_client_address_online = data.requestClientAddressOnline
        }

        if (data.bookingQuestion !== undefined) {
          serviceValues.booking_question = data.bookingQuestion
        }

        if (data.bookingQuestionState !== undefined) {
          serviceValues.booking_question_state = data.bookingQuestionState
        }

        await trx
          .insertInto('service')
          .values(serviceValues as Insertable<Service>)
          .execute()
      }

      return productRow.id
    })

    const products = await listProducts(authorization.trainerId, {
      type: data.type,
    })

    const product = products.find((product) => product.id === productId)

    if (!product) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch product after creation',
          type: '/product-not-found',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json(product, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data after creation',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create product', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
