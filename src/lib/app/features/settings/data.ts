export type SettingAction =
  | { type: 'route'; href: string }
  | { type: 'external'; url: string }
  | { type: 'mailto'; email: string; subject?: string }
  | { type: 'systemSettings' }
  | { type: 'logout' }
  | { type: 'comingSoon'; hint?: string }

export type SettingItem = {
  id: string
  title: string
  subtitle: string
  glyph: string
  accent: string
  badge?: 'web' | 'soon' | 'native'
  action: SettingAction
}

export type SettingSection = {
  title: string
  data: SettingItem[]
}

const baseSections: SettingSection[] = [
  {
    title: 'Templates',
    data: [
      {
        id: 'services',
        title: 'Services',
        subtitle: 'Define sessions clients can book or buy.',
        glyph: '🧾',
        accent: '#38bdf8',
        badge: 'web',
        action: { type: 'route', href: '/settings/services' },
      },
      {
        id: 'credit-packs',
        title: 'Credit packs',
        subtitle: 'Bundle sessions into packs.',
        glyph: '🎟️',
        accent: '#fb923c',
        action: { type: 'route', href: '/settings/credit-packs' },
      },
      {
        id: 'items',
        title: 'Items',
        subtitle: 'Sell add-ons and one-off items.',
        glyph: '🏷️',
        accent: '#a855f7',
        badge: 'web',
        action: { type: 'external', url: 'https://app.keepon.com/items' },
      },
    ],
  },
  {
    title: 'Bookings',
    data: [
      {
        id: 'online-bookings',
        title: 'Online bookings',
        subtitle: 'Publish services and share your booking link.',
        glyph: '🗓️',
        accent: '#22c55e',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/online-bookings',
        },
      },
      {
        id: 'cancellations',
        title: 'Cancellations',
        subtitle: 'Set your default cancellation policy.',
        glyph: '⚖️',
        accent: '#f43f5e',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/settings/cancellations',
        },
      },
      {
        id: 'branding',
        title: 'Branding',
        subtitle: 'Logo, colors, and your bookings page.',
        glyph: '🎨',
        accent: '#f59e0b',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/settings/branding',
        },
      },
    ],
  },
  {
    title: 'Communication',
    data: [
      {
        id: 'reminders',
        title: 'Reminders',
        subtitle: 'Configure reminder timing for sessions.',
        glyph: '🔔',
        accent: '#6366f1',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/settings/reminders',
        },
      },
      {
        id: 'text-credits',
        title: 'Text credits',
        subtitle: 'Check balance or top up SMS credits.',
        glyph: '💬',
        accent: '#0ea5e9',
        action: {
          type: 'mailto',
          email: 'support@keepon.com',
          subject: 'Text credits top up',
        },
      },
    ],
  },
  {
    title: 'Integrations',
    data: [
      {
        id: 'calendar-integrations',
        title: 'Calendar integrations',
        subtitle: 'Connect Google, Apple, and Outlook calendars.',
        glyph: '📅',
        accent: '#ef4444',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/settings/calendar',
        },
      },
      {
        id: 'stripe-verification',
        title: 'Stripe verification',
        subtitle: 'Verify payouts and bank details.',
        glyph: '🏦',
        accent: '#0ea5e9',
        badge: 'web',
        action: {
          type: 'external',
          url: 'https://app.keepon.com/settings/payments',
        },
      },
    ],
  },
  {
    title: 'Account & support',
    data: [
      {
        id: 'account',
        title: 'My account',
        subtitle: 'Profile, password, and subscription.',
        glyph: '👤',
        accent: '#2563eb',
        badge: 'web',
        action: { type: 'external', url: 'https://app.keepon.com/account' },
      },
      {
        id: 'support',
        title: 'Support',
        subtitle: 'Chat with the team for help.',
        glyph: '❓',
        accent: '#3b82f6',
        action: {
          type: 'mailto',
          email: 'support@keepon.com',
          subject: 'Keepon support',
        },
      },
      {
        id: 'feedback',
        title: 'Feedback',
        subtitle: 'Tell us what would make Keepon better.',
        glyph: '✉️',
        accent: '#fbbf24',
        action: {
          type: 'mailto',
          email: 'product@keepon.com',
          subject: 'Keepon feedback',
        },
      },
      {
        id: 'logout',
        title: 'Sign out',
        subtitle: 'Sign out of this device.',
        glyph: '⬅️',
        accent: '#ef4444',
        action: { type: 'logout' },
      },
    ],
  },
]

export function getSettingsSections(_options?: {
  includeLabs?: boolean
}): SettingSection[] {
  return baseSections
}
