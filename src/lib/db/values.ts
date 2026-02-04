import type { IPostgresInterval } from 'postgres-interval'
import type { Interval } from '@/lib/db'
import type { Point } from '@/lib/db/generated'

export const intervalFromMinutes = (minutes: number): Interval => ({ minutes }) as IPostgresInterval

export const intervalFromDays = (days: number): Interval => ({ days }) as IPostgresInterval

export const toPoint = (lat: number, lng: number): Point => ({ x: lat, y: lng })
