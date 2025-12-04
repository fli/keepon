import { z } from 'zod'

export const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const isoDateTimeString = z.string().datetime({ offset: true })

export const notificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  alert: z.string(),
  created: isoDateTimeString.optional(),
  viewed: z.boolean().optional(),
  modelName: z.enum(['plan', 'payment', 'sessionPack', 'client']).nullable().optional(),
  modelId: z.string().nullable().optional(),
  expirationInterval: z.number().nullable().optional(),
  notificationType: z.enum(['general', 'transaction', 'reminder']).nullable().optional(),
  clientId: z.string().nullable().optional(),
  messageType: z.enum(['failure', 'success', 'default']).nullable().optional(),
  category: z.enum(['general', 'transaction', 'reminder']).nullable().optional(),
})

export const notificationListSchema = z.array(notificationSchema)

export type Notification = z.infer<typeof notificationSchema>

export type RawNotificationRow = {
  id: string | null
  userId: string | null
  alert: string | null
  created: Date | string | null
  viewed: boolean | null
  modelName: string | null
  modelId: string | null
  expirationInterval: number | string | null
  notificationType: string | null
  clientId: string | null
  messageType: string | null
  category: string | null
}

const createEnumNormalizer = <TValues extends readonly string[]>(allowedValues: TValues) => {
  const allowedSet = new Set<string>(allowedValues)
  return (value: string | null): TValues[number] | null => {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return null
    }
    return allowedSet.has(trimmed) ? (trimmed as TValues[number]) : null
  }
}

const normalizeModelName = createEnumNormalizer(['plan', 'payment', 'sessionPack', 'client'] as const)
const normalizeNotificationType = createEnumNormalizer(['general', 'transaction', 'reminder'] as const)
const normalizeMessageType = createEnumNormalizer(['failure', 'success', 'default'] as const)

const toIsoDateTime = (value: Date | string | null): string | undefined => {
  if (value === null) {
    return undefined
  }

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error('Invalid timestamp value in notification row')
  }

  return date.toISOString()
}

const normalizeExpirationInterval = (value: number | string | null): number | null => {
  if (value === null) {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const numeric = Number(trimmed)
  if (Number.isNaN(numeric)) {
    return null
  }

  return numeric
}

export const adaptRowToNotification = (row: RawNotificationRow): z.input<typeof notificationSchema> => {
  if (!row.id || !row.userId || !row.alert) {
    throw new Error('Notification row missing required fields')
  }

  const created = toIsoDateTime(row.created)
  const expirationInterval = normalizeExpirationInterval(row.expirationInterval)

  return {
    id: row.id,
    userId: row.userId,
    alert: row.alert,
    created,
    viewed: row.viewed ?? undefined,
    modelName: normalizeModelName(row.modelName),
    modelId: row.modelId ?? null,
    expirationInterval,
    notificationType: normalizeNotificationType(row.notificationType),
    clientId: row.clientId ?? null,
    messageType: normalizeMessageType(row.messageType),
    category: normalizeNotificationType(row.category),
  }
}

export const parseNotificationRows = (rows: RawNotificationRow[]) =>
  notificationListSchema.parse(rows.map((row) => adaptRowToNotification(row)))
