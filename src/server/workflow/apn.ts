import apn from '@parse/node-apn'

export type ApnPayload = {
  aps: {
    [key: string]: unknown
    alert?: { title?: string; body?: string } | string
    badge?: number
    sound?: string | { critical?: number; name?: string; volume?: number }
    'thread-id'?: string
    category?: string
    'content-available'?: number
    'mutable-content'?: number
    'target-content-id'?: string
  }
}

const apnsKey = process.env.APNS_KEY
const apnsKeyId = process.env.APNS_KEY_ID
const apnsTeamId = process.env.APNS_TEAM_ID
const iosBundleId = process.env.IOS_BUNDLE_ID
const apnsProduction = process.env.APNS_PRODUCTION !== 'false'

let provider: apn.Provider | null = null

if (apnsKey && apnsKeyId && apnsTeamId && iosBundleId) {
  provider = new apn.Provider({
    production: apnsProduction,
    token: {
      key: apnsKey,
      keyId: apnsKeyId,
      teamId: apnsTeamId,
    },
  })
}

export const canSendApn = () => Boolean(provider && iosBundleId)

export const sendApnNotification = async (payload: ApnPayload, toDevices: string | string[]) => {
  if (!provider || !iosBundleId) {
    return null
  }

  const notification = new apn.Notification({ topic: iosBundleId, ...payload })
  notification.pushType = 'alert'
  return provider.send(notification, toDevices)
}

export const shutdownApn = () => {
  if (provider) {
    void provider.shutdown()
  }
}
