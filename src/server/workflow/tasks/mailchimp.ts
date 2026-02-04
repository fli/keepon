import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { getMailchimpConfig } from '@/server/workflow/mailchimp'
import { md5 } from '@/server/workflow/utils'

const parseMailchimpErrorDetail = (error: unknown) => {
  if (typeof error !== 'object' || !error) {
    return null
  }

  if ('response' in error) {
    const response = (error as { response?: unknown }).response
    if (typeof response === 'object' && response && 'text' in response) {
      const text = (response as { text?: unknown }).text
      if (typeof text === 'string') {
        try {
          const parsed = JSON.parse(text) as { detail?: unknown }
          if (typeof parsed.detail === 'string') {
            return parsed.detail
          }
        } catch {
          return null
        }
      }
    }
  }

  return null
}

export const handleMailchimpSubscribeTask = async ({ trainerId }: WorkflowTaskPayloadMap['mailchimp.subscribe']) => {
  const config = getMailchimpConfig()
  if (!config) {
    return
  }

  const details = await db
    .selectFrom('trainer')
    .select((eb) => [eb.ref('trainer.first_name').as('firstName'), eb.ref('trainer.last_name').as('lastName'), 'email'])
    .where('trainer.id', '=', trainerId)
    .executeTakeFirst()

  if (!details) {
    return
  }

  try {
    await config.client.lists.addListMember(config.audienceId, {
      email_address: details.email,
      merge_fields: {
        FNAME: details.firstName,
        LNAME: details.lastName || undefined,
      },
      status: 'subscribed',
    })
  } catch (error) {
    const detail = parseMailchimpErrorDetail(error)
    if (detail) {
      if (detail.includes('looks fake or invalid')) {
        console.debug('Mailchimp skipped fake email', { trainerId, email: details.email })
        return
      }
      if (detail.includes('is already a list member')) {
        console.debug('Mailchimp member already exists', { trainerId, email: details.email })
        return
      }
    }
    throw error
  }
}

export const handleMailchimpRefreshUserPropertiesTask = async ({
  trainerId,
  email,
}: WorkflowTaskPayloadMap['mailchimp.refresh_user_properties']) => {
  const config = getMailchimpConfig()
  if (!config) {
    return
  }

  const details = await db
    .selectFrom('trainer')
    .select((eb) => [eb.ref('trainer.first_name').as('firstName'), eb.ref('trainer.last_name').as('lastName'), 'email'])
    .where('trainer.id', '=', trainerId)
    .executeTakeFirst()

  if (!details) {
    return
  }

  try {
    await config.client.lists.updateListMember(config.audienceId, md5(email.toLowerCase()), {
      email_address: email,
      merge_fields: {
        FNAME: details.firstName,
        LNAME: details.lastName || undefined,
      },
    })
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error && (error as { status?: unknown }).status === 404) {
      console.debug('Mailchimp member not found for refresh', { trainerId, email })
      return
    }

    throw error
  }
}

export const handleUpdateMailchimpListMemberTagsTask = async ({
  trainerId,
  tags,
}: WorkflowTaskPayloadMap['updateMailchimpListMemberTags']) => {
  const config = getMailchimpConfig()
  if (!config) {
    return
  }

  const details = await db.selectFrom('trainer').select('email').where('trainer.id', '=', trainerId).executeTakeFirst()

  if (!details) {
    return
  }

  try {
    await config.client.lists.updateListMemberTags(config.audienceId, md5(details.email.toLowerCase()), { tags })
  } catch (error) {
    if (typeof error === 'object' && error && 'status' in error && (error as { status?: unknown }).status === 404) {
      console.debug('Mailchimp member not found for tag update', { trainerId, email: details.email })
      return
    }
    throw error
  }
}
