import type Stripe from 'stripe'
import BigNumber from 'bignumber.js'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { APP_EMAIL, APP_NAME, KEEPON_LOGO_COLOR_URL } from '@/app/api/_lib/constants'
import { getStripeClient, STRIPE_API_VERSION } from '@/app/api/_lib/stripeClient'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { ctaEmail } from '@/server/workflow/templates/ctaEmail'
import { currencyFormat, joinIgnoreEmpty } from '@/server/workflow/utils'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

const baseEventType = (type: string) => type.replace(/\.[a-z_]+$/, '')

const getLatestEventCreated = async (resourceType: string) => {
  const latestRow = await db
    .selectFrom('stripe.event')
    .select((eb) =>
      eb
        .fn('max', [
          eb.cast<number>(
            eb.fn('jsonb_extract_path_text', [eb.cast<unknown>(eb.ref('object'), 'jsonb'), eb.val('created')]),
            'bigint'
          ),
        ])
        .as('latestCreated')
    )
    .where((eb) =>
      eb(
        eb.fn('regexp_replace', [
          eb.fn('jsonb_extract_path_text', [eb.cast<unknown>(eb.ref('object'), 'jsonb'), eb.val('type')]),
          eb.val('\\.[a-z_]+$'),
          eb.val(''),
        ]),
        '=',
        resourceType
      )
    )
    .executeTakeFirst()

  const latestCreated = latestRow?.latestCreated
  return typeof latestCreated === 'number' ? latestCreated : latestCreated ? Number(latestCreated) : null
}

type EmailQueueItem = {
  trainerId?: string | null
  clientId?: string | null
  fromEmail: string
  fromName?: string | null
  toEmail: string
  toName?: string | null
  subject: string
  html: string
  replyTo?: string | null
}

const enqueueEmails = async (emails: EmailQueueItem[]) => {
  if (emails.length === 0) {
    return
  }

  await db
    .insertInto('mail')
    .values(
      emails.map((email) => ({
        trainer_id: email.trainerId ?? null,
        client_id: email.clientId ?? null,
        from_email: email.fromEmail,
        from_name: email.fromName ?? null,
        to_email: email.toEmail,
        to_name: email.toName ?? null,
        subject: email.subject,
        html: email.html,
        reply_to: email.replyTo ?? null,
      }))
    )
    .execute()
}

export const handleProcessStripeEventTask = async ({ id }: WorkflowTaskPayloadMap['processStripeEvent']) => {
  const row = await db
    .updateTable('stripe.event')
    .set({ processed_at: new Date() })
    .where('id', '=', id)
    .returning('object')
    .executeTakeFirst()

  if (!row?.object) {
    return
  }

  const event = row.object as unknown as Stripe.Event
  const stripeClient = getStripeClient()

  type StripeEventIdTableName =
    | 'stripe_payment_intent'
    | 'stripe_charge'
    | 'stripe.customer'
    | 'stripe.subscription'
    | 'stripe.payment_method'
    | 'stripe.payout'
    | 'stripe.checkout_session'
    | 'stripe.account'
    | 'stripe.bank_account'
    | 'stripe.invoice'
    | 'stripe_resource'

  const saveEventToTable = async (tableName: StripeEventIdTableName) => {
    const resourceType = baseEventType(event.type)
    const latestCreated = await getLatestEventCreated(resourceType)
    if (latestCreated !== null && event.created < latestCreated) {
      return
    }

    const resource = event.data.object as { id?: string }
    if (!resource?.id) {
      return
    }

    await db
      .insertInto(tableName)
      .values({
        id: resource.id,
        api_version: stripeApiVersionDate,
        object: JSON.stringify(resource),
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          api_version: stripeApiVersionDate,
          object: JSON.stringify(resource),
        })
      )
      .execute()
  }

  const saveConnectedEventToTable = async (tableName: 'stripe.payout') => {
    const resourceType = baseEventType(event.type)
    const latestCreated = await getLatestEventCreated(resourceType)
    if (latestCreated !== null && event.created < latestCreated) {
      return
    }

    const resource = event.data.object as { id?: string }
    if (!resource?.id || !event.account) {
      return
    }

    await db
      .insertInto(tableName)
      .values({
        id: resource.id,
        api_version: stripeApiVersionDate,
        object: JSON.stringify(resource),
        account: event.account,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          api_version: stripeApiVersionDate,
          object: JSON.stringify(resource),
        })
      )
      .execute()
  }

  const eventObject = event.data.object as { object?: string }

  switch (eventObject.object) {
    case 'payment_intent': {
      await saveEventToTable('stripe_payment_intent')
      break
    }
    case 'charge': {
      await saveEventToTable('stripe_charge')
      break
    }
    case 'customer': {
      await saveEventToTable('stripe.customer')
      break
    }
    case 'payout': {
      if (event.account) {
        await saveConnectedEventToTable('stripe.payout')
      }
      break
    }
    case 'subscription': {
      await saveEventToTable('stripe.subscription')
      break
    }
    case 'payment_method': {
      if (event.type === 'payment_method.detached') {
        const paymentMethod = event.data.object
        if (paymentMethod.id) {
          await db.deleteFrom('stripe.payment_method').where('id', '=', paymentMethod.id).execute()
        }
      }
      await saveEventToTable('stripe.payment_method')
      break
    }
    case 'balance': {
      if (event.account) {
        const resourceType = baseEventType(event.type)
        const latestCreated = await getLatestEventCreated(resourceType)
        if (latestCreated === null || event.created >= latestCreated) {
          await db
            .insertInto('stripe_balance')
            .values({
              account_id: event.account,
              api_version: stripeApiVersionDate,
              object: JSON.stringify(event.data.object),
            })
            .onConflict((oc) =>
              oc.column('account_id').doUpdateSet({
                api_version: stripeApiVersionDate,
                object: JSON.stringify(event.data.object),
              })
            )
            .execute()
        }
      }
      break
    }
    case 'checkout.session': {
      await saveEventToTable('stripe.checkout_session')
      break
    }
    case 'account': {
      await saveEventToTable('stripe.account')
      break
    }
    case 'bank_account': {
      await saveEventToTable('stripe.bank_account')
      break
    }
    case 'invoice': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.id) {
        await saveEventToTable('stripe.invoice')
      }
      break
    }
    default: {
      await saveEventToTable('stripe_resource')
    }
  }

  if ((event.type === 'payout.paid' || event.type === 'payout.created') && event.account) {
    const payout = event.data.object
    if ((event.data.object as { object?: string }).object === 'payout' && typeof payout.destination === 'string') {
      const trainerRow = await db
        .selectFrom('trainer')
        .select((eb) => [
          eb.ref('trainer.user_id').as('userId'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('trainer.timezone').as('timezone'),
          eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
        ])
        .where('trainer.stripe_account_id', '=', event.account)
        .executeTakeFirst()

      if (trainerRow) {
        let last4: string | null = null
        let bankName: string | null = null

        const bankRow = await db
          .selectFrom('stripe_resource')
          .select('object')
          .where('id', '=', payout.destination)
          .executeTakeFirst()

        if (bankRow?.object) {
          const bankObject =
            typeof bankRow.object === 'string'
              ? (JSON.parse(bankRow.object) as Record<string, unknown>)
              : (bankRow.object as Record<string, unknown>)
          const account = typeof bankObject.account === 'string' ? bankObject.account : null
          if (account && account === trainerRow.stripeAccountId) {
            last4 = typeof bankObject.last4 === 'string' ? bankObject.last4 : null
            bankName = typeof bankObject.bank_name === 'string' ? bankObject.bank_name : null
          }
        }

        const data = {
          userId: trainerRow.userId,
          locale: trainerRow.locale,
          timezone: trainerRow.timezone,
          last4,
          bankName,
        }
        const formattedAmount = currencyFormat(new BigNumber(payout.amount).shiftedBy(-2), {
          locale: data.locale,
          currency: payout.currency,
        })

        if ((data.last4 === null || data.bankName === null) && stripeClient) {
          try {
            const bankAccount = await stripeClient.accounts.retrieveExternalAccount(event.account, payout.destination)
            await db
              .insertInto('stripe_resource')
              .values({
                id: bankAccount.id,
                api_version: stripeApiVersionDate,
                object: JSON.stringify(bankAccount),
              })
              .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                  api_version: stripeApiVersionDate,
                  object: JSON.stringify(bankAccount),
                })
              )
              .execute()

            data.last4 = bankAccount.last4 ?? null
            data.bankName = bankAccount.object === 'bank_account' ? (bankAccount.bank_name ?? null) : null
          } catch (error) {
            console.error('Failed to refresh payout bank account data', { error, payoutId: payout.id })
          }
        }

        const accountText = data.last4 && data.bankName ? ` ${data.bankName} ···· ${data.last4}` : ''

        if (event.type === 'payout.paid') {
          await enqueueWorkflowTask(db, 'user.notify', {
            userId: data.userId,
            title: 'Your Keepon payout has arrived!',
            body: `${formattedAmount} has been transferred to your account${accountText}.`,
            messageType: 'success',
            notificationType: 'transaction',
          })
        } else if (event.type === 'payout.created') {
          const arrivalDate = new Date(payout.arrival_date * 1000)
          const formatter = new Intl.DateTimeFormat(data.locale, {
            dateStyle: 'short',
            timeZone: data.timezone,
          })
          const formattedDate = formatter.format(arrivalDate)
          const todayFormatted = formatter.format(new Date())
          const today = formattedDate === todayFormatted

          await enqueueWorkflowTask(db, 'user.notify', {
            userId: data.userId,
            title: 'Your Keepon payout has been sent!',
            body: `${formattedAmount} has been sent to your account${accountText}, it should arrive ${
              today ? 'today' : `on ${formattedDate}`
            }.`,
            messageType: 'success',
            notificationType: 'transaction',
          })
        }
      }
    }
  } else if (event.type === 'account.updated' && event.account && event.data.previous_attributes) {
    const account = event.data.object
    const previousAttributes = event.data.previous_attributes

    const previousChargesEnabled = previousAttributes.charges_enabled
    const previousPayoutsEnabled = previousAttributes.payouts_enabled
    const chargesEnabled = account.charges_enabled
    const payoutsEnabled = account.payouts_enabled
    const previousPending = previousAttributes.requirements?.pending_verification || []
    const previousPastDue = previousAttributes.requirements?.past_due || []
    const pastDue = account.requirements?.past_due || []

    const pending = account.requirements?.pending_verification || []
    const newPending = pending.filter((value) => !previousPending.includes(value))
    const removedPending = previousPending.filter((value) => !pending.includes(value))
    const chargesTransitionedTo = previousChargesEnabled === undefined ? null : chargesEnabled
    const payoutsTransitionedTo = previousPayoutsEnabled === undefined ? null : payoutsEnabled

    const details = await db
      .selectFrom('trainer')
      .select((eb) => [
        eb.ref('trainer.id').as('id'),
        eb.ref('trainer.email').as('email'),
        eb.ref('trainer.first_name').as('firstName'),
        eb.ref('trainer.last_name').as('lastName'),
        eb.ref('trainer.user_id').as('userId'),
      ])
      .where('trainer.stripe_account_id', '=', event.account)
      .executeTakeFirst()

    if (details) {
      const emails: EmailQueueItem[] = []
      const notifications: WorkflowTaskPayloadMap['user.notify'][] = []

      const commonMail = {
        fromEmail: APP_EMAIL,
        fromName: `${APP_NAME} Team`,
        toEmail: details.email,
        trainerId: details.id,
        toName: joinIgnoreEmpty(details.firstName, details.lastName),
      }

      if (newPending.some((value) => previousPastDue.includes(value))) {
        // pending verification email/notification is intentionally disabled (parity with full)
      }

      if ((chargesTransitionedTo || payoutsTransitionedTo) && chargesEnabled) {
        const mission = await db
          .updateTable('mission')
          .set({ completed_at: new Date() })
          .where('trainer_id', '=', details.id)
          .where('completed_at', 'is', null)
          .where('id', '=', 'completeStripeVerification')
          .returning('id')
          .executeTakeFirst()

        if (mission) {
          const legacyTrainer = await db
            .selectFrom('vw_legacy_trainer')
            .select((eb) => [eb.ref('subscription').as('subscription')])
            .where('id', '=', details.id)
            .executeTakeFirst()

          let reward: { id: string } | undefined
          if (legacyTrainer?.subscription) {
            const subscription =
              typeof legacyTrainer.subscription === 'string'
                ? (JSON.parse(legacyTrainer.subscription) as Record<string, unknown>)
                : (legacyTrainer.subscription as Record<string, unknown>)
            const status = typeof subscription.status === 'string' ? subscription.status : null
            if (status !== 'subscribed') {
              const rewardRow = await db
                .insertInto('reward')
                .values({ trainer_id: details.id, type: '2DayTrial' })
                .returning('id')
                .executeTakeFirst()

              if (rewardRow) {
                reward = { id: rewardRow.id }
              }
            }
          }

          if (reward) {
            await db
              .updateTable('mission')
              .set({ reward_id: reward.id })
              .where('trainer_id', '=', details.id)
              .where('id', '=', mission.id)
              .execute()
          }

          notifications.push({
            title: `Mission complete: You're all verified for payments! 🎉`,
            body: reward ? `Woo! Claim your reward for completing a mission! 🎁` : `Woo, you've completed a mission!`,
            userId: details.userId,
            messageType: 'success',
            notificationType: 'general',
          })
        }

        emails.push({
          ...commonMail,
          subject: `You're all set to take payments`,
          html: ctaEmail({
            receivingReason: `you're using ${APP_NAME}`,
            logo: { url: KEEPON_LOGO_COLOR_URL, alt: APP_NAME },
            bodyHeading: `You're verified for payments`,
            bodyHtml: `Your details have been successfully verified. You can now take card payments.`,
          }),
        })

        notifications.push({
          userId: details.userId,
          notificationType: 'general',
          title: `You're verified for payments! ✨`,
          body: `You can now take card payments.`,
          messageType: 'success',
        })
      } else if (
        chargesTransitionedTo === false ||
        payoutsTransitionedTo === false ||
        removedPending.some((value) => pastDue.includes(value))
      ) {
        emails.push({
          ...commonMail,
          subject: `Information required to enable payments and payouts`,
          html: ctaEmail({
            receivingReason: `you're using ${APP_NAME}`,
            logo: { url: KEEPON_LOGO_COLOR_URL, alt: APP_NAME },
            bodyHeading: `Information required to enable payments & payouts`,
            bodyHtml: `More information is required to enable you to take card payments and receive payouts. You can add the necessary information in the Keepon app. Sorry for messing with your flow!`,
          }),
        })

        notifications.push({
          userId: details.userId,
          notificationType: 'general',
          title: `Information required to enable payments & payouts! 🚨`,
          body: `Add the required information directly in the app and we'll get you going in no time`,
          messageType: 'failure',
        })
      }

      await Promise.all([
        enqueueEmails(emails),
        ...notifications.map((payload) => enqueueWorkflowTask(db, 'user.notify', payload)),
      ])
    }
  } else if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object
    if (typeof checkoutSession.customer === 'string') {
      const sessionRow = await db
        .selectFrom('sms_credit_checkout_session')
        .innerJoin('trainer', 'trainer.id', 'sms_credit_checkout_session.trainer_id')
        .select((eb) => [
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('sms_credit_checkout_session.credit_count').as('amount'),
        ])
        .where('trainer.stripe_customer_id', '=', checkoutSession.customer)
        .where('sms_credit_checkout_session.id', '=', checkoutSession.id)
        .executeTakeFirst()

      const credits = sessionRow
        ? await db
            .insertInto('sms_credit')
            .values({
              trainer_id: sessionRow.trainerId,
              amount: sessionRow.amount,
              source: 'purchase',
              sms_credit_checkout_session_id: checkoutSession.id,
            })
            .returning((eb) => [
              eb.ref('sms_credit.amount').as('amount'),
              eb.ref('sms_credit.trainer_id').as('trainerId'),
            ])
            .executeTakeFirst()
        : null

      if (credits) {
        const trainerDetails = await db
          .selectFrom('trainer')
          .select((eb) => [
            eb.ref('trainer.user_id').as('userId'),
            eb.ref('trainer.email').as('email'),
            eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
            eb.ref('trainer.business_name').as('businessName'),
            eb.ref('trainer.first_name').as('firstName'),
            eb.ref('trainer.last_name').as('lastName'),
          ])
          .where('trainer.id', '=', credits.trainerId)
          .executeTakeFirst()

        const details = trainerDetails
          ? {
              userId: trainerDetails.userId,
              email: trainerDetails.email,
              serviceProviderName:
                trainerDetails.onlineBookingsBusinessName ??
                trainerDetails.businessName ??
                `${trainerDetails.firstName}${trainerDetails.lastName ? ` ${trainerDetails.lastName}` : ''}`,
            }
          : null
        if (details) {
          await Promise.all([
            enqueueWorkflowTask(db, 'user.notify', {
              userId: details.userId,
              notificationType: 'general',
              title: `${credits.amount} SMS credits have been added!`,
              body: `Your recent purchase has been processed and your credits have been added to your account.`,
              messageType: 'success',
            }),
            enqueueEmails([
              {
                fromEmail: APP_EMAIL,
                fromName: `${APP_NAME} Team`,
                toEmail: details.email,
                toName: details.serviceProviderName,
                trainerId: credits.trainerId,
                subject: `You bought ${credits.amount} SMS credits`,
                html: ctaEmail({
                  receivingReason: `purchased SMS credits for your ${APP_NAME} account`,
                  bodyHeading: `Credits have been added to your account`,
                  bodyHtml: `Nice! ${credits.amount} credits have been added to your Keepon account. These credits don't expire so you don't have to worry about using them all up straight away.`,
                  logo: { url: KEEPON_LOGO_COLOR_URL, alt: APP_NAME },
                }),
              },
            ]),
          ])
        }
      }
    }
  } else if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object
    const invoiceAny = invoice as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null
      payment_intent?: string | Stripe.PaymentIntent | null
    }
    const subscriptionRef = invoice.parent?.subscription_details?.subscription ?? invoiceAny.subscription ?? null
    const subscriptionId =
      typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef ? subscriptionRef.id : null

    if (invoice.billing_reason === 'subscription_create' || invoice.billing_reason === 'subscription_cycle') {
      const lineItem = invoice.lines?.data?.[0]
      const priceRef = lineItem?.pricing?.price_details?.price ?? null
      const price =
        typeof priceRef === 'string' ? (stripeClient ? await stripeClient.prices.retrieve(priceRef) : null) : priceRef
      const interval = price?.recurring?.interval ?? null

      if ((interval === 'month' || interval === 'year') && subscriptionId) {
        const trainerRow = await db
          .selectFrom('trainer')
          .select((eb) => [eb.ref('trainer.id').as('trainerId')])
          .where('stripe_subscription_id', '=', subscriptionId)
          .executeTakeFirst()

        if (trainerRow?.trainerId) {
          await db
            .insertInto('sms_credit')
            .values({
              trainer_id: trainerRow.trainerId,
              amount: 30 * (interval === 'month' ? 1 : 12),
              source: 'subscription',
            })
            .execute()
        }
      }
    }

    if (
      invoice.billing_reason === 'subscription_create' &&
      subscriptionId &&
      invoiceAny.payment_intent &&
      stripeClient
    ) {
      const paymentIntentId =
        typeof invoiceAny.payment_intent === 'string' ? invoiceAny.payment_intent : invoiceAny.payment_intent.id

      const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId)
      if (paymentIntent.payment_method) {
        const subscription = await stripeClient.subscriptions.update(subscriptionId, {
          default_payment_method:
            typeof paymentIntent.payment_method === 'string'
              ? paymentIntent.payment_method
              : paymentIntent.payment_method.id,
        })

        await db
          .insertInto('stripe.subscription')
          .values({
            id: subscription.id,
            api_version: stripeApiVersionDate,
            object: JSON.stringify(subscription),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: stripeApiVersionDate,
              object: JSON.stringify(subscription),
            })
          )
          .execute()
      }
    }
  }
}
