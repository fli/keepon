import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { getStripeClient, STRIPE_API_VERSION } from '@/app/api/_lib/stripeClient'
import { db } from '@/lib/db'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

export const handleCreateStripeAccountTask = async ({ trainerId }: WorkflowTaskPayloadMap['createStripeAccount']) => {
  const stripeClient = getStripeClient()
  if (!stripeClient) {
    throw new Error('Stripe is not configured')
  }

  await db.transaction().execute(async (trx) => {
    const details = await trx
      .selectFrom('trainer')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select((eb) => [
        eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
        eb.ref('country.alpha_2_code').as('country'),
      ])
      .where('trainer.id', '=', trainerId)
      .executeTakeFirst()

    if (!details || details.stripeAccountId) {
      return
    }

    const account = await stripeClient.accounts.create({
      country: details.country,
      type: 'standard',
    })

    await trx
      .insertInto('stripe.account')
      .values({
        id: account.id,
        api_version: stripeApiVersionDate,
        object: JSON.stringify(account),
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          api_version: stripeApiVersionDate,
          object: JSON.stringify(account),
        })
      )
      .execute()

    await trx.updateTable('trainer').set({ stripe_account_id: account.id }).where('id', '=', trainerId).execute()
  })
}
