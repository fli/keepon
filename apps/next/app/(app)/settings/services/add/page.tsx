import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@keepon/db'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageContainer } from '@/components/page-container'

import { readSessionFromCookies } from '../../../../session.server'

const getFormString = (formData: FormData, key: string, fallback = '') => {
  const value = formData.get(key)
  return typeof value === 'string' ? value : fallback
}

const normalizePrice = (raw: string) => {
  const parsed = Number.parseFloat(raw.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Enter a valid price greater than 0')
  }
  return parsed.toFixed(2)
}

const normalizeMinutes = (raw: string) => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Enter a whole number of minutes greater than 0')
  }
  return parsed
}

async function createService(formData: FormData) {
  'use server'

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const name = getFormString(formData, 'name').trim()
  const description = getFormString(formData, 'description').trim()
  const price = normalizePrice(getFormString(formData, 'price'))
  const durationMinutes = normalizeMinutes(getFormString(formData, 'durationMinutes'))
  const location = getFormString(formData, 'location').trim() || null
  const address = getFormString(formData, 'address').trim() || null
  const bookableOnline = formData.get('bookableOnline') === 'on'

  if (!name) {
    throw new Error('Name is required')
  }

  const currencyRow = await db
    .selectFrom('trainer')
    .innerJoin(
      'supported_country_currency as supportedCountryCurrency',
      'supportedCountryCurrency.country_id',
      'trainer.country_id'
    )
    .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
    .select(['currency.id as currencyId'])
    .where('trainer.id', '=', session.trainerId)
    .executeTakeFirst()

  if (!currencyRow) {
    throw new Error('Could not resolve your default currency')
  }

  await db.transaction().execute(async trx => {
    const productRow = await trx
      .insertInto('product')
      .values({
        trainer_id: session.trainerId,
        name,
        description,
        price,
        currency_id: currencyRow.currencyId,
        is_service: true,
        is_credit_pack: null,
        is_item: null,
        is_membership: null,
        display_order: null,
      })
      .returning('id')
      .executeTakeFirst()

    if (!productRow) {
      throw new Error('Failed to create service product')
    }

    await trx
      .insertInto('service')
      .values({
        id: productRow.id,
        trainer_id: session.trainerId,
        duration: `${durationMinutes} minutes`,
        location,
        address,
        google_place_id: null,
        geo: null,
        bookable_online: bookableOnline,
        booking_payment_type: 'noPrepayment',
        buffer_minutes_before: 0,
        buffer_minutes_after: 0,
        time_slot_frequency_minutes: 15,
        cover_image_url: null,
        icon_url: null,
        image_0_url: null,
        image_1_url: null,
        image_2_url: null,
        image_3_url: null,
        image_4_url: null,
        image_5_url: null,
        request_client_address_online: null,
        booking_question: null,
        booking_question_state: null,
      })
      .execute()
  })

  revalidatePath('/settings/services')
  redirect('/settings/services')
}

export default async function AddServicePage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-8">
      <div className="flex w-full max-w-xl flex-col gap-2">
        <h1 className="text-3xl font-semibold leading-tight">Add service</h1>
        <p className="text-sm text-muted-foreground">
          Create a new service clients can book or that you can sell in checkout flows.
        </p>
      </div>

      <form action={createService} className="w-full max-w-xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoFocus />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="price">Price</Label>
          <Input id="price" name="price" inputMode="decimal" placeholder="75.00" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="durationMinutes">Duration (minutes)</Label>
          <Input
            id="durationMinutes"
              name="durationMinutes"
              inputMode="numeric"
              placeholder="60"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="location">Location (optional)</Label>
          <Input id="location" name="location" placeholder="Studio, Online, etc." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Address (optional)</Label>
          <Input id="address" name="address" placeholder="123 Main St" />
        </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="What should clients know about this service?"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            id="bookableOnline"
            name="bookableOnline"
            type="checkbox"
            className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
            defaultChecked
          />
          <Label htmlFor="bookableOnline" className="text-sm font-medium">
            Bookable online
          </Label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Save service
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
