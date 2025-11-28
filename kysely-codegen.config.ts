import type { Config } from 'kysely-codegen'

const config: Config = {
  // Load DATABASE_URL from the dedicated codegen environment file.
  envFile: '.env.codegen',
  // Introspect our Postgres instance and emit tables into the shared DB package.
  outFile: './packages/db/src/generated.ts',
  dialect: 'postgres',
  url: 'env(DATABASE_URL_CODEGEN)',
  // Keep shared/public schemas unprefixed while allowing non-default schemas like
  // mandrill/stripe to contribute their names to generated interfaces for uniqueness.
  defaultSchemas: ['public', 'audit', 'reporting', 'twilio'],
}

export default config
