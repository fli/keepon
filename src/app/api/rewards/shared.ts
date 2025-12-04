import { z } from 'zod'

export const rewardTypeSchema = z.enum(['1DayTrial', '2DayTrial', '2TextCredits', '3TextCredits'])

export const rewardRowSchema = z.object({
  id: z.string(),
  type: rewardTypeSchema,
  title: z.string(),
  description: z.string(),
  claimedAt: z.date().nullable(),
})

export type RewardRow = z.infer<typeof rewardRowSchema>

export const rewardSchema = z.object({
  id: z.string(),
  type: rewardTypeSchema,
  title: z.string(),
  description: z.string(),
  claimed: z.boolean(),
})

export const rewardListSchema = z.array(rewardSchema)

export const adaptRewardRow = (row: RewardRow) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description,
  claimed: row.claimedAt !== null,
})
