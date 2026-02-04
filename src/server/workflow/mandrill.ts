export type MandrillSendResult = {
  email: string
  status: 'sent' | 'queued' | 'scheduled' | 'rejected' | 'invalid'
  _id: string
  reject_reason?:
    | 'hard-bounce'
    | 'soft-bounce'
    | 'spam'
    | 'unsub'
    | 'custom'
    | 'invalid-sender'
    | 'invalid'
    | 'test-mode-limit'
    | 'unsigned'
    | 'rule'
    | null
}

export type MandrillMessage = {
  html: string
  subject: string
  from_email: string
  from_name?: string
  to: { email: string; name?: string; type?: 'to' | 'cc' | 'bcc' }[]
  headers?: Record<string, string>
  metadata?: Record<string, string>
  important?: boolean
  text?: string
}

const mandrillFetch = async (path: string, body: unknown) => {
  const response = await fetch(new URL(path, 'https://mandrillapp.com/api/1.0/').toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Mandrill request failed with status ${response.status}`)
  }

  return response.json()
}

export const sendMandrillMessage = async (message: MandrillMessage): Promise<MandrillSendResult> => {
  const mandrillApiKey = process.env.MANDRILL_API_KEY
  if (!mandrillApiKey) {
    throw new Error('MANDRILL_API_KEY is not configured')
  }

  const result = (await mandrillFetch('messages/send.json', {
    key: mandrillApiKey,
    message,
    async: true,
  })) as MandrillSendResult[]

  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('Mandrill returned no results')
  }

  return result[0]
}
