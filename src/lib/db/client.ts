import type { PoolConfig } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool, types as pgTypes } from 'pg'
import type { DB } from './generated'

export type Database = DB

export type DbConfig = {
  /**
   * Optional override for the Postgres connection string.
   * Defaults to process.env.DATABASE_URL.
   */
  connectionString?: string
  /**
   * Optional pool configuration forwarded to pg.Pool.
   */
  pool?: PoolConfig
}

// Match legacy behavior: keep intervals as ISO8601 strings instead of pg-interval objects.
pgTypes.setTypeParser(1186, (value) => value)

const parseOptionalNumber = (value: string | undefined) => {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

const buildPoolConfig = (connectionStringFromConfig?: string, overrides?: PoolConfig): PoolConfig => {
  const connectionString = overrides?.connectionString ?? connectionStringFromConfig ?? process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to create a database connection. ' +
        'Set it in the environment or pass connectionString via DbConfig.'
    )
  }

  return {
    connectionString,
    max: overrides?.max ?? parseOptionalNumber(process.env.DB_POOL_MAX),
    min: overrides?.min ?? parseOptionalNumber(process.env.DB_POOL_MIN),
    idleTimeoutMillis: overrides?.idleTimeoutMillis ?? parseOptionalNumber(process.env.DB_POOL_IDLE_TIMEOUT),
    ssl: overrides?.ssl ?? (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined),
    options: overrides?.options ?? process.env.DB_OPTIONS ?? '-c intervalstyle=iso_8601',
  }
}

export const createDb = (config: DbConfig = {}) => {
  const pool = new Pool(buildPoolConfig(config.connectionString, config.pool))

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  })
}

const globalForDb = globalThis as unknown as {
  __keeponDb?: Kysely<DB>
}

export const db = (() => {
  if (globalForDb.__keeponDb) {
    return globalForDb.__keeponDb
  }

  const instance = createDb()

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__keeponDb = instance
  }

  return instance
})()

export type { Kysely }
