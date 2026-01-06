import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

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

const normalizeCredits = (raw: string) => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Enter a whole number greater than 0 for credits')
  }
  return parsed
}

async function createCreditPack(formData: FormData) {
  'use server'

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const name = getFormString(formData, 'name').trim()
  const description = getFormString(formData, 'description').trim()
  const price = normalizePrice(getFormString(formData, 'price'))
  const totalCredits = normalizeCredits(getFormString(formData, 'totalCredits'))

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

  await db.transaction().execute(async (trx) => {
    const productRow = await trx
      .insertInto('product')
      .values({
        trainer_id: session.trainerId,
        name,
        description,
        price,
        currency_id: currencyRow.currencyId,
        is_credit_pack: true,
        is_item: null,
        is_service: null,
        is_membership: null,
        display_order: null,
      })
      .returning('id')
      .executeTakeFirst()

    if (!productRow) {
      throw new Error('Failed to create credit pack product')
    }

    await trx
      .insertInto('credit_pack')
      .values({
        id: productRow.id,
        trainer_id: session.trainerId,
        total_credits: totalCredits,
        is_credit_pack: true,
      })
      .execute()
  })

  revalidatePath('/settings/credit-packs')
  redirect('/settings/credit-packs')
}

export default async function AddCreditPackPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-8">
      <div className="flex w-full max-w-xl flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold">Add credit pack</h1>
        <p className="text-sm text-muted-foreground">Define a pack clients can purchase and apply toward sessions.</p>
      </div>

      <form action={createCreditPack} className="w-full max-w-xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="price">Price</Label>
          <Input id="price" name="price" inputMode="decimal" placeholder="120.00" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="totalCredits">Number of credits</Label>
          <Input id="totalCredits" name="totalCredits" inputMode="numeric" placeholder="12" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} placeholder="Tell clients how this pack works" />
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Save credit pack
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
