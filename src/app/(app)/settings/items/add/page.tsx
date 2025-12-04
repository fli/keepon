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

async function createItem(formData: FormData) {
  'use server'

  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  const name = getFormString(formData, 'name').trim()
  const description = getFormString(formData, 'description').trim()
  const price = normalizePrice(getFormString(formData, 'price'))

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
        is_item: true,
        is_credit_pack: null,
        is_service: null,
        is_membership: null,
        display_order: null,
      })
      .returning('id')
      .executeTakeFirst()

    if (!productRow) {
      throw new Error('Failed to create item')
    }
  })

  revalidatePath('/settings/items')
  redirect('/settings/items')
}

export default async function AddItemPage() {
  const session = await readSessionFromCookies()
  if (!session) {
    redirect('/auth')
  }

  return (
    <PageContainer className="flex flex-col items-center gap-6 py-8">
      <div className="flex w-full max-w-xl flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold">Add item</h1>
        <p className="text-sm text-muted-foreground">
          Create an item you can sell alongside services and credit packs.
        </p>
      </div>

      <form action={createItem} className="w-full max-w-xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required  />
        </div>

        <div className="space-y-2">
          <Label htmlFor="price">Price</Label>
          <Input id="price" name="price" inputMode="decimal" placeholder="45.00" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="Explain what this item includes (optional)"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Save item
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
