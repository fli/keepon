import BigNumber from 'bignumber.js'

export const capitalize = (value: string) => {
  if (!value) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export const formatCurrency = (amount: number | string | BigNumber, currency: string, locale?: string) => {
  const numeric = BigNumber.isBigNumber(amount) ? amount.toNumber() : Number(amount)
  if (!Number.isFinite(numeric)) {
    return String(amount)
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(numeric)
  } catch {
    return `${numeric.toFixed(2)} ${currency}`
  }
}

export const cardIsExpired = ({ expMonth, expYear }: { expMonth: number; expYear: number }) => {
  const now = new Date()
  const year = now.getUTCFullYear()
  if (expYear < year) {
    return true
  }
  if (expYear > year) {
    return false
  }
  const month = now.getUTCMonth() + 1
  return expMonth < month
}

type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'info'

const statusTones: Record<string, StatusTone> = {
  active: 'positive',
  paid: 'positive',
  succeeded: 'positive',
  refunded: 'info',
  pending: 'warning',
  paused: 'warning',
  rejected: 'negative',
  cancelled: 'neutral',
  ended: 'neutral',
}

export const toneForStatus = (status?: string | null): StatusTone => {
  if (!status) {
    return 'neutral'
  }
  const normalized = status.trim().toLowerCase()
  return statusTones[normalized] ?? 'neutral'
}

export const toneClassName = (tone: StatusTone) => {
  switch (tone) {
    case 'positive':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'warning':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'negative':
      return 'bg-rose-100 text-rose-800 border-rose-200'
    case 'info':
      return 'bg-sky-100 text-sky-800 border-sky-200'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

export const getErrorMessage = (error: unknown, fallback = 'Something went wrong') => {
  if (error instanceof Error) {
    return error.message || fallback
  }
  if (typeof error === 'string') {
    return error
  }
  return fallback
}
