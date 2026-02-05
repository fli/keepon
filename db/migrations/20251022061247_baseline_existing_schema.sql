-- migrate:up

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'audit')
     AND EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'trainer'
     )
  THEN
    INSERT INTO schema_migrations (version)
    SELECT '20251022061248'
    WHERE NOT EXISTS (
      SELECT 1 FROM schema_migrations WHERE version = '20251022061248'
    );
  END IF;
END $$;

-- migrate:down

DELETE FROM schema_migrations WHERE version = '20251022061248';
