export type StatusFilter = 'current' | 'lead' | 'past'

export const statusOptions: { id: StatusFilter; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'lead', label: 'Leads' },
  { id: 'past', label: 'Past' },
]

export const statusColors: Record<StatusFilter, string> = {
  current: '#2563eb',
  lead: '#f59e0b',
  past: '#94a3b8',
}

export const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  mobileNumber: '',
  otherNumber: '',
  company: '',
  status: 'current' as StatusFilter,
}

export function normalizeStatus(status?: string | null): StatusFilter {
  if (status === 'lead') return 'lead'
  if (status === 'past') return 'past'
  return 'current'
}

export function optionalValue(value?: string | null) {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function isStatusFilter(value?: string | null): value is StatusFilter {
  return value === 'current' || value === 'lead' || value === 'past'
}
