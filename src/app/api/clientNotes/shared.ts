import { z } from 'zod'

const isoDateTimeString = z.string().datetime({ offset: true })

export const clientNoteSchema = z.object({
  id: z.string(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  trainerId: z.string(),
  clientId: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
})

export const clientNoteListSchema = z.array(clientNoteSchema)

export type ClientNoteRow = {
  id: string
  trainer_id: string
  client_id: string
  title: string | null
  body: string | null
  created_at: Date | string
  updated_at: Date | string
}

const toIsoString = (value: Date | string, label: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value encountered in client note record`)
  }
  return date.toISOString()
}

export const adaptClientNoteRow = (row: ClientNoteRow) => ({
  id: row.id,
  createdAt: toIsoString(row.created_at, 'created_at'),
  updatedAt: toIsoString(row.updated_at, 'updated_at'),
  trainerId: row.trainer_id,
  clientId: row.client_id,
  title: row.title,
  body: row.body,
})
