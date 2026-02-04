export const accessTokenTypes = ['api', 'client_dashboard', 'password_reset'] as const

export const bookingPaymentTypes = ['fullPrepayment', 'hidePrice', 'noPrepayment'] as const

export const bookingQuestionStates = ['optional', 'required'] as const

export const clientAppointmentReminderTypes = ['email', 'emailAndSms', 'sms'] as const
export const serviceProviderAppointmentReminderTypes = ['email', 'emailAndNotification', 'notification'] as const

export const brandColors = [
  'amber',
  'blue',
  'cyan',
  'emerald',
  'fuchsia',
  'green',
  'indigo',
  'lightBlue',
  'lime',
  'orange',
  'pink',
  'purple',
  'red',
  'rose',
  'sky',
  'teal',
  'violet',
  'yellow',
] as const

export const clientSessionStates = ['accepted', 'cancelled', 'confirmed', 'declined', 'invited', 'maybe'] as const

export const clientStatuses = ['current', 'lead', 'past'] as const

export const eventTypes = ['event', 'group_session', 'single_session'] as const

export const mailBounceTypes = ['hard', 'soft'] as const

export type MissionType = Readonly<{
  id: string
  title: string
  description: string
  actionUrl: string | null
}>

export const missionTypes: readonly MissionType[] = [
  {
    id: 'completeStripeVerification',
    title: 'Get verified for payments',
    description: 'Get paid out to your bank account',
    actionUrl: null,
  },
  {
    id: 'createActiveSubscription',
    title: 'Sell a subscription',
    description: 'More predictable revenue, less awkward conversations',
    actionUrl: null,
  },
  {
    id: 'createInitialData',
    title: 'Add some data',
    description: "We've added some test data to get you started",
    actionUrl: null,
  },
  {
    id: 'createOnlineBooking',
    title: 'Take an online booking',
    description: 'Too busy to book yourself in?',
    actionUrl: null,
  },
  {
    id: 'enableNotifications',
    title: 'Allow notifications',
    description: "We'll notify you about new payments and bookings",
    actionUrl: null,
  },
] as const

export const requestClientAddressOnlineTypes = ['optional', 'required'] as const

export type RewardType = Readonly<{
  type: string
  title: string
  description: string
}>

export const rewardTypes: readonly RewardType[] = [
  { type: '1DayTrial', title: '+1 day trial', description: '1 day has been added to your trial!' },
  {
    type: '2DayTrial',
    title: '+2 days trial',
    description: '2 days have been added to your trial!',
  },
  { type: '2TextCredits', title: '+2 text credits', description: "You've earned 2 text credits!" },
  { type: '3TextCredits', title: '+3 text credits', description: "You've earned 3 text credits!" },
] as const

export const smsCreditSources = ['adjustment', 'newAccount', 'purchase', 'reward', 'subscription'] as const

export type SubscriptionFrequency = Readonly<{
  frequency: string
  duration: string
}>

export const subscriptionFrequencies: readonly SubscriptionFrequency[] = [
  { frequency: 'daily', duration: '1 day' },
  { frequency: 'monthly', duration: '1 mon' },
  { frequency: 'weekly', duration: '7 days' },
  { frequency: 'yearly', duration: '1 year' },
] as const

export const userTypes = ['client', 'trainer'] as const
