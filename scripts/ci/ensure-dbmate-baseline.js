#!/usr/bin/env node
const { Client } = require('pg')

const connectionString = process.env.DATABASE_URL_PROD

if (!connectionString) {
  throw new Error('DATABASE_URL_PROD is required to ensure dbmate baseline')
}

const run = async () => {
  const client = new Client({ connectionString })
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version character varying NOT NULL,
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    );
  `)

  const auditCheck = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'audit' LIMIT 1`)
  const trainerCheck = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trainer' LIMIT 1`
  )

  if (auditCheck.rowCount > 0 && trainerCheck.rowCount > 0) {
    await client.query(
      `
      INSERT INTO public.schema_migrations (version)
      SELECT $1::varchar
      WHERE NOT EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE version = $1::varchar
      );
      `,
      ['20251022061248']
    )
  }

  await client.end()
}

run().catch((error) => {
  console.error('Failed to ensure dbmate baseline', error)
  process.exit(1)
})
