import { redirect } from 'next/navigation'

import Link from 'next/link'

import { PageContainer } from '@/components/page-container'
import { Button } from '@/components/ui/button'

import { readSessionFromCookies } from '../../../session.server'
import { ServicesTable } from './services-table'
import { listProducts } from '@/server/products'
import { z } from 'zod'

const serviceProductSchema = z.object({
  id: z.string(),
  type: z.literal('service'),
  name: z.string(),
  price: z.string(),
  currency: z.string(),
  durationMinutes: z.number().int(),
  bookableOnline: z.boolean(),
  showPriceOnline: z.boolean().optional(),
  bookingPaymentType: z.string().optional(),
  bufferMinutesBefore: z.number().int().optional(),
  bufferMinutesAfter: z.number().int().optional(),
  timeSlotFrequencyMinutes: z.number().int().optional(),
  requestClientAddressOnline: z.string().nullable().optional(),
  bookingQuestion: z.string().nullable().optional(),
  bookingQuestionState: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  geo: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable()
    .optional(),
  googlePlaceId: z.string().nullable().optional(),
})

type ServiceProduct = z.infer<typeof serviceProductSchema>

export default async function ServicesPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  let error: string | null = null
  let services: ServiceProduct[] = []

  try {
    const data = await listProducts(session.trainerId, { type: 'service' })
    services = z.array(serviceProductSchema).parse(data)
  } catch (cause: unknown) {
    console.error('ServicesPage: failed to load services', cause)
    error = cause instanceof Error ? cause.message : 'Unable to load services right now. Please try again shortly.'
  }

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl leading-tight font-semibold">Services</h1>
          <Button size="sm" nativeButton={false} render={<Link href="/settings/services/add" />}>
            Add service
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <ServicesTable services={services} error={error} />
    </PageContainer>
  )
}
