export const reminderOptions = [
  { name: 'At time of event', value: 'PT0H0M0S' },
  { name: '5 minutes before', value: 'PT5M' },
  { name: '10 minutes before', value: 'PT10M' },
  { name: '15 minutes before', value: 'PT15M' },
  { name: '30 minutes before', value: 'PT30M' },
  { name: '1 hour before', value: 'PT1H' },
  { name: '2 hours before', value: 'PT2H' },
  { name: '1 day before', value: 'P1D' },
  { name: '2 days before', value: 'P2D' },
  { name: '1 week before', value: 'P1W' },
] as const

export type ClientReminderType = 'email' | 'sms' | 'emailAndSms'
export type ServiceProviderReminderType = 'email' | 'notification' | 'emailAndNotification'

export const clientReminderTypeValues = ['email', 'sms', 'emailAndSms'] as const satisfies readonly ClientReminderType[]

export const serviceProviderReminderTypeValues = [
  'email',
  'notification',
  'emailAndNotification',
] as const satisfies readonly ServiceProviderReminderType[]

export type ClientReminder = {
  type: ClientReminderType
  timeBeforeStart: string
}

export type ServiceProviderReminder = {
  type: ServiceProviderReminderType
  timeBeforeStart: string
}

export const clientReminderTypes: readonly {
  label: string
  value: ClientReminderType
}[] = [
  { label: 'Email', value: 'email' },
  { label: 'Text', value: 'sms' },
  { label: 'Email & text', value: 'emailAndSms' },
]

export const serviceProviderReminderTypes: readonly {
  label: string
  value: ServiceProviderReminderType
}[] = [
  { label: 'Email', value: 'email' },
  { label: 'Notification', value: 'notification' },
  { label: 'Email & notification', value: 'emailAndNotification' },
]

export const isIsoDuration = (value: string) => /^P/i.test(value.trim())
