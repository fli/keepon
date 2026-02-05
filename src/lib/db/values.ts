import type { IPostgresInterval } from 'postgres-interval'
import type { Interval } from '@/lib/db'
import type { Point } from '@/lib/db/generated'

type IntervalInsert = Interval['__insert__']

export const intervalFromMinutes = (minutes: number): IntervalInsert => ({ minutes }) as IPostgresInterval

export const intervalFromDays = (days: number): IntervalInsert => ({ days }) as IPostgresInterval

export const toPoint = (lat: number, lng: number): Point => ({ x: lat, y: lng })
