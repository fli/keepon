-- migrate:up

CREATE OR REPLACE FUNCTION infinity_timestamptz()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'infinity'::timestamptz;
$$;

-- migrate:down
