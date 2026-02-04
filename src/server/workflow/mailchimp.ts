import mailchimp from '@mailchimp/mailchimp_marketing'

let configured = false

export const getMailchimpConfig = () => {
  const apiKey = process.env.MAILCHIMP_API_KEY
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID
  const server = process.env.MAILCHIMP_SERVER_PREFIX ?? 'us3'

  if (!apiKey || !audienceId) {
    return null
  }

  if (!configured) {
    mailchimp.setConfig({ apiKey, server })
    configured = true
  }

  return { client: mailchimp, audienceId }
}
