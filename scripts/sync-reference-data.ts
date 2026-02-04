import type { Insertable } from 'kysely'
import type { DB } from '../src/lib/db/index'
import { countries } from '../src/config/countries'
import { currencies } from '../src/config/currencies'
import {
  accessTokenTypes,
  bookingPaymentTypes,
  bookingQuestionStates,
  clientAppointmentReminderTypes,
  serviceProviderAppointmentReminderTypes,
  brandColors,
  clientSessionStates,
  clientStatuses,
  eventTypes,
  mailBounceTypes,
  missionTypes,
  requestClientAddressOnlineTypes,
  rewardTypes,
  smsCreditSources,
  subscriptionFrequencies,
  userTypes,
} from '../src/config/referenceData'
import { supportedCountryCurrency } from '../src/config/supportedCountryCurrency'
/* Idempotent sync of reference data (countries, currencies, enums).
 * Source data lives in ./src/config.
 * Run with: pnpm sync:reference-data
 */
import { createDb } from '../src/lib/db/index'

async function sync() {
  const db = createDb()

  try {
    await db.transaction().execute(async (trx) => {
      // Upsert currencies (uses numeric ISO code as PK).
      for (const row of currencies) {
        await trx
          .insertInto('currency')
          .values({ id: row.id, alpha_code: row.alphaCode, name: row.name })
          .onConflict((oc) => oc.column('alpha_code').doUpdateSet({ name: row.name }))
          .execute()
      }

      // Upsert countries (uses numeric ISO code as PK).
      for (const row of countries) {
        await trx
          .insertInto('country')
          .values({
            id: row.id,
            alpha_2_code: row.alpha2,
            alpha_3_code: row.alpha3,
            name: row.name,
          })
          .onConflict((oc) =>
            oc.column('alpha_2_code').doUpdateSet({
              alpha_3_code: row.alpha3,
              name: row.name,
            })
          )
          .execute()
      }

      // Upsert supported country currency mappings.
      for (const row of supportedCountryCurrency) {
        await trx
          .insertInto('supported_country_currency')
          .values({
            country_id: row.countryId,
            currency_id: row.currencyId,
          })
          .onConflict((oc) => oc.column('country_id').doUpdateSet({ currency_id: row.currencyId }))
          .execute()
      }

      const upsertSimple = async <TTable extends keyof DB, TColumn extends keyof DB[TTable] & string>(
        table: TTable,
        column: TColumn,
        values: readonly DB[TTable][TColumn][]
      ) => {
        for (const value of values) {
          await trx
            .insertInto(table)
            .values({ [column]: value } as Insertable<DB[TTable]>)
            .onConflict((oc) => oc.column(column).doNothing())
            .execute()
        }
      }

      await upsertSimple('access_token_type', 'type', accessTokenTypes)
      await upsertSimple('booking_payment_type', 'type', bookingPaymentTypes)
      await upsertSimple('booking_question_state', 'state', bookingQuestionStates)
      await upsertSimple('client_appointment_reminder_type', 'type', clientAppointmentReminderTypes)
      await upsertSimple('service_provider_appointment_reminder_type', 'type', serviceProviderAppointmentReminderTypes)
      await upsertSimple('brand_color', 'id', brandColors)
      await upsertSimple('client_session_state', 'state', clientSessionStates)
      await upsertSimple('client_status', 'status', clientStatuses)
      await upsertSimple('event_type', 'type', eventTypes)
      await upsertSimple('mail_bounce_type', 'type', mailBounceTypes)
      await upsertSimple('request_client_address_online_type', 'type', requestClientAddressOnlineTypes)
      await upsertSimple('sms_credit_source', 'source', smsCreditSources)
      await upsertSimple('user_type', 'type', userTypes)

      for (const row of missionTypes) {
        await trx
          .insertInto('mission_type')
          .values({
            id: row.id,
            title: row.title,
            description: row.description,
            action_url: row.actionUrl,
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              title: row.title,
              description: row.description,
              action_url: row.actionUrl,
            })
          )
          .execute()
      }

      for (const row of rewardTypes) {
        await trx
          .insertInto('reward_type')
          .values({
            type: row.type,
            title: row.title,
            description: row.description,
          })
          .onConflict((oc) =>
            oc.column('type').doUpdateSet({
              title: row.title,
              description: row.description,
            })
          )
          .execute()
      }

      for (const row of subscriptionFrequencies) {
        await trx
          .insertInto('subscription_frequency')
          .values({
            frequency: row.frequency,
            duration: row.duration,
          })
          .onConflict((oc) =>
            oc.column('frequency').doUpdateSet({
              duration: row.duration,
            })
          )
          .execute()
      }
    })
  } finally {
    await db.destroy()
  }
}

sync()
  .then(() => {
    console.log('Supported countries sync complete.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Failed to sync supported countries', error)
    process.exit(1)
  })
