-- migrate:up


-- Dumped from database version 11.22
-- Dumped by pg_dump version 17.6 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: SCHEMA audit; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA audit IS 'Out-of-table audit/history logging tables and trigger functions';


--
-- Name: mandrill; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA mandrill;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: reporting; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA reporting;


--
-- Name: stripe; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA stripe;


--
-- Name: twilio; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA twilio;


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: hstore; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS hstore WITH SCHEMA public;


--
-- Name: EXTENSION hstore; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION hstore IS 'data type for storing sets of (key, value) pairs';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: bcrypt_hash; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.bcrypt_hash AS text
	CONSTRAINT bcrypt_hash_check CHECK ((VALUE ~ '^\$2[ayb]\$.{56}$'::text));


--
-- Name: email; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.email AS public.citext
	CONSTRAINT email_check CHECK ((VALUE OPERATOR(public.~) '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'::public.citext));


--
-- Name: hex_color; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.hex_color AS text
	CONSTRAINT hex_color_check CHECK ((VALUE ~ '^#[a-fA-F0-9]{6}$'::text));


--
-- Name: locale; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.locale AS text
	CONSTRAINT locale_check CHECK ((VALUE ~ '^((?:(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((?:([A-Za-z]{2,3}(-(?:[A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?)|[A-Za-z]{4}|[A-Za-z]{5,8})(-(?:[A-Za-z]{4}))?(-(?:[A-Za-z]{2}|[0-9]{3}))?(-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(-(?:[0-9A-WY-Za-wy-z](-[A-Za-z0-9]{2,8})+))*(-(?:x(-[A-Za-z0-9]{1,8})+))?)|(?:x(-[A-Za-z0-9]{1,8})+))$'::text));


--
-- Name: time_subtype_diff(time without time zone, time without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.time_subtype_diff(x time without time zone, y time without time zone) RETURNS double precision
    LANGUAGE sql IMMUTABLE STRICT
    AS $$SELECT EXTRACT(EPOCH FROM (x - y))$$;


--
-- Name: timerange; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.timerange AS RANGE (
    subtype = time without time zone,
    subtype_diff = public.time_subtype_diff
);


--
-- Name: is_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_timezone(tz text) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    date TIMESTAMPTZ;
BEGIN
    date := now() AT TIME ZONE tz;
    RETURN TRUE;
EXCEPTION WHEN invalid_parameter_value THEN
    RETURN FALSE;
END;
$$;


--
-- Name: timezone; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.timezone AS text
	CONSTRAINT timezone_check CHECK (public.is_timezone(VALUE));


--
-- Name: url; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.url AS text
	CONSTRAINT url_check CHECK ((VALUE ~ '^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$'::text));


--
-- Name: audit_table(regclass); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.audit_table(target_table regclass) RETURNS void
    LANGUAGE sql
    AS $_$
SELECT audit.audit_table($1, BOOLEAN 't', BOOLEAN 't');
$_$;


--
-- Name: FUNCTION audit_table(target_table regclass); Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON FUNCTION audit.audit_table(target_table regclass) IS '
Add auditing support to the given table. Row-level changes will be logged with full client query text. No cols are ignored.
';


--
-- Name: audit_table(regclass, boolean, boolean); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.audit_table(target_table regclass, audit_rows boolean, audit_query_text boolean) RETURNS void
    LANGUAGE sql
    AS $_$
SELECT audit.audit_table($1, $2, $3, ARRAY[]::text[]);
$_$;


--
-- Name: audit_table(regclass, boolean, boolean, text[]); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.audit_table(target_table regclass, audit_rows boolean, audit_query_text boolean, ignored_cols text[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  stm_targets text = 'INSERT OR UPDATE OR DELETE OR TRUNCATE';
  _q_txt text;
  _ignored_cols_snip text = '';
BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_trigger_row ON ' || target_table;
    EXECUTE 'DROP TRIGGER IF EXISTS audit_trigger_stm ON ' || target_table;

    IF audit_rows THEN
        IF array_length(ignored_cols,1) > 0 THEN
            _ignored_cols_snip = ', ' || quote_literal(ignored_cols);
        END IF;
        _q_txt = 'CREATE TRIGGER audit_trigger_row AFTER INSERT OR UPDATE OR DELETE ON ' ||
                 target_table ||
                 ' FOR EACH ROW EXECUTE PROCEDURE audit.if_modified_func(' ||
                 quote_literal(audit_query_text) || _ignored_cols_snip || ');';
        RAISE NOTICE '%',_q_txt;
        EXECUTE _q_txt;
        stm_targets = 'TRUNCATE';
    ELSE
    END IF;

    _q_txt = 'CREATE TRIGGER audit_trigger_stm AFTER ' || stm_targets || ' ON ' ||
             target_table ||
             ' FOR EACH STATEMENT EXECUTE PROCEDURE audit.if_modified_func('||
             quote_literal(audit_query_text) || ');';
    RAISE NOTICE '%',_q_txt;
    EXECUTE _q_txt;

END;
$$;


--
-- Name: FUNCTION audit_table(target_table regclass, audit_rows boolean, audit_query_text boolean, ignored_cols text[]); Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON FUNCTION audit.audit_table(target_table regclass, audit_rows boolean, audit_query_text boolean, ignored_cols text[]) IS '
Add auditing support to a table.

Arguments:
   target_table:     Table name, schema qualified if not on search_path
   audit_rows:       Record each row change, or only audit at a statement level
   audit_query_text: Record the text of the client query that triggered the audit event?
   ignored_cols:     Columns to exclude from update diffs, ignore updates that change only ignored cols.
';


--
-- Name: if_modified_func(); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.if_modified_func() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
    audit_row audit.logged_actions;
    include_values boolean;
    log_diffs boolean;
    h_old hstore;
    h_new hstore;
    excluded_cols text[] = ARRAY[]::text[];
BEGIN
    IF TG_WHEN <> 'AFTER' THEN
        RAISE EXCEPTION 'audit.if_modified_func() may only run as an AFTER trigger';
    END IF;

    audit_row = ROW(
        nextval('audit.logged_actions_event_id_seq'), -- event_id
        TG_TABLE_SCHEMA::text,                        -- schema_name
        TG_TABLE_NAME::text,                          -- table_name
        TG_RELID,                                     -- relation OID for much quicker searches
        session_user::text,                           -- session_user_name
        current_timestamp,                            -- action_tstamp_tx
        statement_timestamp(),                        -- action_tstamp_stm
        clock_timestamp(),                            -- action_tstamp_clk
        txid_current(),                               -- transaction ID
        current_setting('application_name'),          -- client application
        inet_client_addr(),                           -- client_addr
        inet_client_port(),                           -- client_port
        current_query(),                              -- top-level query or queries (if multistatement) from client
        substring(TG_OP,1,1),                         -- action
        NULL, NULL,                                   -- row_data, changed_fields
        'f'                                           -- statement_only
        );

    IF NOT TG_ARGV[0]::boolean IS DISTINCT FROM 'f'::boolean THEN
        audit_row.client_query = NULL;
    END IF;

    IF TG_ARGV[1] IS NOT NULL THEN
        excluded_cols = TG_ARGV[1]::text[];
    END IF;

    IF (TG_OP = 'UPDATE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
        audit_row.changed_fields =  (hstore(NEW.*) - audit_row.row_data) - excluded_cols;
        IF audit_row.changed_fields = hstore('') THEN
            -- All changed fields are ignored. Skip this update.
            RETURN NULL;
        END IF;
    ELSIF (TG_OP = 'DELETE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
    ELSIF (TG_OP = 'INSERT' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(NEW.*) - excluded_cols;
    ELSIF (TG_LEVEL = 'STATEMENT' AND TG_OP IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
        audit_row.statement_only = 't';
    ELSE
        RAISE EXCEPTION '[audit.if_modified_func] - Trigger func added as trigger for unhandled case: %, %',TG_OP, TG_LEVEL;
        RETURN NULL;
    END IF;
    INSERT INTO audit.logged_actions VALUES (audit_row.*);
    RETURN NULL;
END;
$$;


--
-- Name: FUNCTION if_modified_func(); Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON FUNCTION audit.if_modified_func() IS '
Track changes to a table at the statement and/or row level.

Optional parameters to trigger in CREATE TRIGGER call:

param 0: boolean, whether to log the query text. Default ''t''.

param 1: text[], columns to ignore in updates. Default [].

         Updates to ignored cols are omitted from changed_fields.

         Updates with only ignored cols changed are not inserted
         into the audit log.

         Almost all the processing work is still done for updates
         that ignored. If you need to save the load, you need to use
         WHEN clause on the trigger instead.

         No warning or error is issued if ignored_cols contains columns
         that do not exist in the target table. This lets you specify
         a standard set of ignored columns.

There is no parameter to disable logging of values. Add this trigger as
a ''FOR EACH STATEMENT'' rather than ''FOR EACH ROW'' trigger if you do not
want to log row values.

Note that the user name logged is the login role for the session. The audit trigger
cannot obtain the active role because it is reset by the SECURITY DEFINER invocation
of the audit trigger its self.
';


--
-- Name: add_sms_credits_on_renewal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_sms_credits_on_renewal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO sms_credit (trainer_id, amount, source)
  VALUES
    (NEW.trainer_id,
    (((extract('years' from NEW.expires_date)::int -  extract('years' from NEW.purchase_date)::int) * 12)
    - extract('month' from NEW.purchase_date)::int + extract('month' from NEW.expires_date)::int) * 30,
    'subscription');
  RETURN NULL;
END;
$$;


--
-- Name: change_password(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_password(trainer_id uuid, current_password text, new_password text) RETURNS SETOF text
    LANGUAGE plpgsql
    AS $$
-- replaces the password if the previous password is provided correctly
-- Will logout all sessions and create and return a new access token id
DECLARE
	password_matches boolean;
	matched_user_id uuid;
BEGIN
	SELECT (password_hash = crypt(current_password, password_hash)) AS password_matches
	INTO STRICT password_matches
	FROM trainer WHERE id = change_password.trainer_id;

	IF NOT password_matches THEN
		RAISE EXCEPTION 'unauthenticated'
			USING HINT = 'Provided password doesn''t match the existing password';
	END IF;

	UPDATE trainer
	SET password_hash = crypt(new_password, gen_salt('bf', 10))
	WHERE id = change_password.trainer_id
	RETURNING trainer.user_id INTO matched_user_id;

	DELETE
	FROM access_token
	WHERE access_token.user_id = matched_user_id;

	RETURN QUERY
	INSERT INTO access_token (type, user_id, user_type, expires_at)
	VALUES ('api', matched_user_id, 'trainer', now() + '14 day'::interval)
	RETURNING id;

END;
$$;


--
-- Name: client_trim(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_trim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    NEW.email := trim(both ' ' from NEW.email);
    NEW.first_name := trim(both ' ' from NEW.first_name);
    NEW.last_name := trim(both ' ' from NEW.last_name);
    NEW.mobile_number := trim(both ' ' from NEW.mobile_number);
    NEW.emergency_contact_name := trim(both ' ' from NEW.emergency_contact_name);
    NEW.emergency_contact_mobile_number := trim(both ' ' from NEW.emergency_contact_mobile_number);
    NEW.other_number := trim(both ' ' from NEW.other_number);
    NEW.notes := trim(both ' ' from NEW.notes);
    NEW.goals := trim(both ' ' from NEW.goals);
    NEW.medication := trim(both ' ' from NEW.medication);
    NEW.current_injuries := trim(both ' ' from NEW.current_injuries);
    NEW.past_injuries := trim(both ' ' from NEW.past_injuries);
    RETURN NEW;
  END;
$$;


--
-- Name: compose_session_replication_role(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compose_session_replication_role(role text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
        DECLARE
                curr_val text := 'unset';
        BEGIN
                EXECUTE 'SET session_replication_role = ' || quote_literal(role);
                EXECUTE 'SHOW session_replication_role' INTO curr_val;
                RETURN curr_val;
        END
$$;


SET default_tablespace = '';

--
-- Name: session_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_series (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    event_type public.citext NOT NULL,
    name text,
    duration interval NOT NULL,
    start timestamp with time zone NOT NULL,
    end_ timestamp with time zone,
    location text,
    price numeric(10,2),
    color public.hex_color,
    session_icon_id public.citext,
    icon_url public.url,
    timezone public.timezone NOT NULL,
    daily_recurrence_interval interval day,
    CONSTRAINT session_series_daily_recurrence_interval_check CHECK ((daily_recurrence_interval >= '1 day'::interval)),
    CONSTRAINT session_series_duration_check CHECK (((duration >= '00:00:00'::interval) AND isfinite(duration))),
    CONSTRAINT session_series_location_check CHECK ((location <> ''::text)),
    CONSTRAINT session_series_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: create_event(uuid, timestamp without time zone, timestamp without time zone, text, interval, interval, text, interval, text, text, point, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_event(trainer_id uuid, start_date timestamp without time zone, end_date timestamp without time zone, name text, duration interval, app_reminder_trigger interval DEFAULT NULL::interval, location text DEFAULT NULL::text, daily_recurrence_interval interval DEFAULT NULL::interval, address text DEFAULT NULL::text, google_place_id text DEFAULT NULL::text, geo point DEFAULT NULL::point, service_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.session_series
    LANGUAGE plpgsql
    AS $$
DECLARE
  trainer_timezone text;
  new_session_series_id uuid;
  session_dt timestamptz;
BEGIN

  SELECT timezone INTO STRICT trainer_timezone FROM trainer where id = create_event.trainer_id;
  EXECUTE format('SET LOCAL TIME ZONE %I;', trainer_timezone);

  INSERT INTO session_series (
    trainer_id,
    app_reminder_trigger,
    event_type,
    duration,
    start,
    end_,
    daily_recurrence_interval,
    location,
    timezone,
    name)
  VALUES (
    create_event.trainer_id,
    create_event.app_reminder_trigger,
    'event',
    create_event.duration,
    create_event.start_date,
    create_event.end_date,
    create_event.daily_recurrence_interval,
    create_event.location,
    trainer_timezone,
    create_event.name
  ) RETURNING id INTO STRICT new_session_series_id;

  FOR session_dt IN
    SELECT generate_series(
        start_date,
        CASE WHEN daily_recurrence_interval IS NOT NULL THEN end_date ELSE start_date END,
        coalesce(daily_recurrence_interval, '1 day'::interval))
  LOOP
    INSERT INTO session (
      session_series_id,
      start,
      duration,
      timezone,
      trainer_id,
      location,
      address,
      geo,
      google_place_id,
      service_id
    )
    VALUES (
      new_session_series_id,
      session_dt,
      create_event.duration,
      trainer_timezone,
      create_event.trainer_id,
      create_event.location,
      create_event.address,
      create_event.geo,
      create_event.google_place_id,
      create_event.service_id

    );
  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_argument'
    USING HINT = 'Arguments provided did not create a session series with at least 1 session';
  END IF;

  RETURN QUERY SELECT * FROM session_series WHERE session_series.id = new_session_series_id;
END;
$$;


--
-- Name: create_group_session(uuid, timestamp without time zone, timestamp without time zone, interval, uuid[], numeric, text, interval, text, interval, text, text, integer, text, text, point, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_group_session(trainer_id uuid, start_date timestamp without time zone, end_date timestamp without time zone, duration interval, clients uuid[], price numeric, name text, app_reminder_trigger interval DEFAULT NULL::interval, location text DEFAULT NULL::text, daily_recurrence_interval interval DEFAULT NULL::interval, color text DEFAULT NULL::text, session_icon_id text DEFAULT NULL::text, maximum_attendance integer DEFAULT NULL::integer, address text DEFAULT NULL::text, google_place_id text DEFAULT NULL::text, geo point DEFAULT NULL::point, service_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.session_series
    LANGUAGE plpgsql
    AS $$
DECLARE
  trainer_timezone text;
  new_session_series_id uuid;
  session_dt timestamptz;
  client_ids uuid[];
  new_session_id uuid;
BEGIN

  -- if there are duplicate clients or a client that can't be found then exit
  SELECT array_agg(id) INTO client_ids
  FROM client
  WHERE client.id = any(create_group_session.clients::uuid[])
    AND client.trainer_id=create_group_session.trainer_id;
  IF array_length(client_ids, 1) != array_length(create_group_session.clients, 1) THEN
    RAISE EXCEPTION 'invalid_argument'
    USING HINT = 'Duplicate clients or clients not found';
  END IF;
  -- TODO add more detailed error message

  SELECT timezone INTO STRICT trainer_timezone FROM trainer where id = create_group_session.trainer_id;
  EXECUTE format('SET LOCAL TIME ZONE %I;', trainer_timezone);

  INSERT INTO session_series (
    trainer_id,
    app_reminder_trigger,
    event_type,
    duration,
    start,
    end_,
    daily_recurrence_interval,
    location,
    timezone,
    price,
    name,
    color,
    session_icon_id)
  VALUES (
    create_group_session.trainer_id,
    create_group_session.app_reminder_trigger,
    'group_session',
    create_group_session.duration,
    create_group_session.start_date,
    create_group_session.end_date,
    create_group_session.daily_recurrence_interval,
    create_group_session.location,
    trainer_timezone,
    create_group_session.price,
    create_group_session.name,
    create_group_session.color,
    create_group_session.session_icon_id
  ) RETURNING id INTO STRICT new_session_series_id;

  FOR session_dt IN
    SELECT generate_series(
        start_date,
        CASE WHEN daily_recurrence_interval IS NOT NULL THEN end_date ELSE start_date END,
        coalesce(daily_recurrence_interval, '1 day'::interval))
LOOP
    INSERT INTO session (
      session_series_id,
      start,
      duration,
      timezone,
      maximum_attendance,
      trainer_id,
      location,
      address,
      geo,
      google_place_id,
      service_id
    )
    VALUES (
      new_session_series_id,
      session_dt,
      create_group_session.duration,
      trainer_timezone,
      maximum_attendance,
      create_group_session.trainer_id,
      create_group_session.location,
      create_group_session.address,
      create_group_session.geo,
      create_group_session.google_place_id,
      create_group_session.service_id
    ) RETURNING id INTO STRICT new_session_id;

    INSERT INTO client_session (
      trainer_id, client_id, session_id, price
    ) SELECT create_group_session.trainer_id, c, new_session_id, create_group_session.price FROM unnest(client_ids) c;

  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_argument'
    USING HINT = 'Arguments provided did not create a session series with at least 1 session';
  END IF;

  RETURN QUERY SELECT * FROM session_series WHERE session_series.id = new_session_series_id;
END;
$$;


--
-- Name: create_single_session(uuid, timestamp without time zone, timestamp without time zone, interval, uuid[], numeric, interval, text, interval, text, text, text, point, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_single_session(trainer_id uuid, start_date timestamp without time zone, end_date timestamp without time zone, duration interval, clients uuid[], price numeric, app_reminder_trigger interval DEFAULT NULL::interval, location text DEFAULT NULL::text, daily_recurrence_interval interval DEFAULT NULL::interval, name text DEFAULT NULL::text, address text DEFAULT NULL::text, google_place_id text DEFAULT NULL::text, geo point DEFAULT NULL::point, service_id uuid DEFAULT NULL::uuid) RETURNS SETOF public.session_series
    LANGUAGE plpgsql
    AS $$
DECLARE
  trainer_timezone text;
  new_session_series_id uuid;
  session_dt timestamptz;
  client_ids uuid[];
  new_session_id uuid;
BEGIN

  -- if there are duplicate clients or a client that can't be found then exit
  SELECT array_agg(id) INTO client_ids
  FROM client
  WHERE client.id = any(create_single_session.clients::uuid[])
    AND client.trainer_id=create_single_session.trainer_id;
  IF array_length(client_ids, 1) != 1 THEN
    RAISE EXCEPTION 'invalid_argument'
    USING HINT = 'Invalid number of clients';
  END IF;
  -- TODO add more detailed error message

  SELECT timezone INTO STRICT trainer_timezone FROM trainer where id = create_single_session.trainer_id;
  EXECUTE format('SET LOCAL TIME ZONE %I;', trainer_timezone);

  INSERT INTO session_series (
    trainer_id,
    app_reminder_trigger,
    event_type,
    duration,
    start,
    end_,
    daily_recurrence_interval,
    location,
    timezone,
    price,
    name)
  VALUES (
    create_single_session.trainer_id,
    create_single_session.app_reminder_trigger,
    'single_session',
    create_single_session.duration,
    create_single_session.start_date,
    create_single_session.end_date,
    create_single_session.daily_recurrence_interval,
    create_single_session.location,
    trainer_timezone,
    create_single_session.price,
    create_single_session.name
  ) RETURNING id INTO STRICT new_session_series_id;

  FOR session_dt IN
    SELECT generate_series(
        start_date,
        CASE WHEN daily_recurrence_interval IS NOT NULL THEN end_date ELSE start_date END,
        coalesce(daily_recurrence_interval, '1 day'::interval))
LOOP
    INSERT INTO session (
      session_series_id,
      start,
      duration,
      timezone,
      trainer_id,
      location,
      address,
      geo,
      google_place_id,
      service_id
    )
    VALUES (
      new_session_series_id,
      session_dt,
      create_single_session.duration,
      trainer_timezone,
      create_single_session.trainer_id,
      create_single_session.location,
      create_single_session.address,
      create_single_session.geo,
      create_single_session.google_place_id,
      create_single_session.service_id
    ) RETURNING id INTO STRICT new_session_id;

    INSERT INTO client_session (
      trainer_id, client_id, session_id, price
    ) SELECT create_single_session.trainer_id, c, new_session_id, create_single_session.price FROM unnest(client_ids) c;

  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_argument'
    USING HINT = 'Arguments provided did not create a session series with at least 1 session';
  END IF;

  RETURN QUERY SELECT * FROM session_series WHERE session_series.id = new_session_series_id;
END;
$$;


--
-- Name: payment_plan_payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_payment (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    payment_plan_id uuid NOT NULL,
    date timestamp with time zone NOT NULL,
    status public.citext NOT NULL,
    amount numeric(10,2) NOT NULL,
    amount_outstanding numeric(10,2) NOT NULL,
    retry_count smallint DEFAULT 0 NOT NULL,
    last_retry_time timestamp with time zone,
    fee numeric(10,2),
    trainer_id uuid NOT NULL,
    CONSTRAINT payment_plan_payment_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payment_plan_payment_amount_outstanding_check CHECK ((amount_outstanding >= (0)::numeric)),
    CONSTRAINT payment_plan_payment_fee_check CHECK ((fee >= (0)::numeric)),
    CONSTRAINT payment_plan_payment_retry_count_check CHECK ((retry_count >= 0))
);


--
-- Name: generate_payment_plan_payments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_payment_plan_payments() RETURNS SETOF public.payment_plan_payment
    LANGUAGE plpgsql
    AS $$
DECLARE
	p payment_plan;
	series_stats record;
	payment_stats record;
BEGIN
	FOR p IN SELECT * FROM payment_plan WHERE status NOT IN('ended', 'cancelled') LOOP
		SELECT
			count(date), max(date) max_date INTO payment_stats
		FROM
			payment_plan_payment
		WHERE
			payment_plan_payment.payment_plan_id = p.id;

		SELECT
			count(*) INTO series_stats
		FROM
			generate_series(p.start, least(p.end_, NOW()), p.frequency_weekly_interval * '1 week'::interval);

		RETURN query
			INSERT INTO payment_plan_payment (trainer_id, payment_plan_id, date, status, amount, amount_outstanding)
			SELECT
                p.trainer_id,
				p.id,
				date,
				CASE p.status
				WHEN 'paused' THEN
					'paused'
				ELSE
					'pending'
				END,
				p.amount,
				p.amount
			FROM
				generate_series(p.start, least(p.end_, NOW()), p.frequency_weekly_interval * '1 week'::interval) date
			WHERE
				date > coalesce(payment_stats.max_date + p.frequency_weekly_interval * '1 week'::interval - '1 day'::interval, '-infinity')
			ORDER BY
				date DESC
			LIMIT greatest(0, (series_stats.count - payment_stats.count))
			RETURNING payment_plan_payment.*;
	END LOOP;
END;
$$;


--
-- Name: generate_ulid_uuid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_ulid_uuid() RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  timestamp  BYTEA = E'\\000\\000\\000\\000\\000\\000';

  unix_time  BIGINT;
  ulid       BYTEA;
BEGIN
  -- 6 timestamp bytes
  unix_time = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  timestamp = SET_BYTE(timestamp, 0, (unix_time >> 40)::BIT(8)::INTEGER);
  timestamp = SET_BYTE(timestamp, 1, (unix_time >> 32)::BIT(8)::INTEGER);
  timestamp = SET_BYTE(timestamp, 2, (unix_time >> 24)::BIT(8)::INTEGER);
  timestamp = SET_BYTE(timestamp, 3, (unix_time >> 16)::BIT(8)::INTEGER);
  timestamp = SET_BYTE(timestamp, 4, (unix_time >> 8)::BIT(8)::INTEGER);
  timestamp = SET_BYTE(timestamp, 5, unix_time::BIT(8)::INTEGER);

  -- 10 entropy bytes
  ulid = timestamp || gen_random_bytes(10);

  RETURN CAST( substring(CAST (ulid AS text) from 3) AS uuid);
END
$$;


--
-- Name: is_booking_time_available(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_booking_time_available(service_id uuid, booking_time timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql
    AS $_$
DECLARE
  override_intervals timerange[];
  override_accepting_bookings boolean;
  default_intervals timerange[];
  default_accepting_bookings boolean;
  provider_timezone text;
  service_duration interval;
  service_buffer_before interval;
  service_buffer_after interval;
  within_availability boolean;
  conflicts_with_event boolean;
BEGIN
  -- checking for availability
  -- if override check acceptingbookings
  -- if accepting bookings check intervals
  -- if no override check day acceptingBookings
  -- if acceptingBookings check intervals
  -- if available check for session overlap
  -- inputs, booking time, serviceId;
  SELECT
    trainer.timezone,
    service.duration,
    make_interval(mins => service.buffer_minutes_before),
    make_interval(mins => service.buffer_minutes_after)
  INTO STRICT provider_timezone, service_duration, service_buffer_before, service_buffer_after
  FROM trainer
  JOIN service ON service.trainer_id=trainer.id
  WHERE service.id=is_booking_time_available.service_id;

  SELECT
    availability.accepting_bookings,
    availability.available_intervals
  INTO override_accepting_bookings, override_intervals
  FROM availability
  JOIN trainer ON availability.trainer_id=trainer.id
  JOIN service ON service.trainer_id=trainer.id
  WHERE service.id=is_booking_time_available.service_id
  AND timezone(trainer.timezone, is_booking_time_available.booking_time)::date = availability."date";


  EXECUTE format('SELECT trainer.online_bookings_%1$I_accepting_bookings, trainer.online_bookings_%1$I_available_intervals '
   'FROM trainer '
   'JOIN service ON service.trainer_id=trainer.id '
   'WHERE service.id=$1'
  , to_char(timezone(provider_timezone, is_booking_time_available.booking_time), 'FMday')) INTO STRICT default_accepting_bookings, default_intervals USING is_booking_time_available.service_id;

  IF COALESCE(override_accepting_bookings, default_accepting_bookings) = FALSE THEN
    RETURN FALSE;
  END IF;

-- https://dba.stackexchange.com/a/101010
-- merge availability intervals into contiguous groups and sort them
-- only consider the intervals which can take the entire service time
select count(*) >=1 INTO STRICT within_availability FROM (
SELECT timerange(min(lower(ivals)), max(enddate)) AS ivals
FROM  (
   SELECT *, count(nextstart > enddate OR NULL) OVER (ORDER BY ivals DESC NULLS LAST) AS grp
   FROM  (
      SELECT ivals
           , max(upper(ivals)) OVER (ORDER BY ivals) AS enddate
           , lead(lower(ivals)) OVER (ORDER BY ivals) As nextstart
      FROM unnest(COALESCE(override_intervals ,default_intervals)) ivals
      ) a
   ) b
GROUP  BY grp
ORDER  BY 1) merged where merged.ivals @> timerange(
  timezone(provider_timezone, booking_time - service_buffer_before)::time,
  timezone(provider_timezone, booking_time + service_duration + service_buffer_after)::time, '[)');

select count(*) >=1 INTO STRICT conflicts_with_event from (
SELECT tstzrange(min(lower(ivals)), max(enddate)) AS ivals
FROM  (
   SELECT *, count(nextstart > enddate OR NULL) OVER (ORDER BY ivals DESC NULLS LAST) AS grp
   FROM  (
      SELECT ivals
           , max(upper(ivals)) OVER (ORDER BY ivals) AS enddate
           , lead(lower(ivals)) OVER (ORDER BY ivals) As nextstart
      FROM (
        select tstzrange(session.start - make_interval(mins => session.buffer_minutes_before), session.start+session.duration + make_interval(mins => session.buffer_minutes_after), '[)') ivals
        from session
        join session_series on session_series.id=session.session_series_id
        JOIN trainer ON trainer.id = session_series.trainer_id
        JOIN service ON service.trainer_id = trainer.id
        WHERE trainer.id=session_series.trainer_id
        AND session_series.event_type != 'single_session'
        AND service.id=is_booking_time_available.service_id
        UNION ALL
        select tstzrange(session.start - make_interval(mins => session.buffer_minutes_before), session.start+session.duration + make_interval(mins => session.buffer_minutes_after), '[)') ivals
        from session
        join session_series on session_series.id=session.session_series_id
        JOIN trainer ON trainer.id = session_series.trainer_id
        JOIN service ON service.trainer_id = trainer.id
        LEFT JOIN client_session ON client_session.session_id = session.id
        WHERE trainer.id=session_series.trainer_id
        AND session_series.event_type = 'single_session'
        AND client_session.state != 'cancelled'
        AND client_session.state != 'declined'
        AND service.id=is_booking_time_available.service_id
        UNION ALL
        SELECT
        tstzrange(
            		coalesce(start_time, timezone(trainer.timezone, start_date)),
            		coalesce(end_time, timezone(trainer.timezone, end_date)), '[)')
        FROM busy_time
        JOIN trainer on trainer.id=busy_time.trainer_id
        join service on service.trainer_id=trainer.id
        where service.id=is_booking_time_available.service_id
        ) ivals
      ) a
   ) b
GROUP  BY grp
ORDER  BY 1) merged where merged.ivals && tstzrange(booking_time - service_buffer_before, booking_time + service_duration + service_buffer_after);

RETURN within_availability AND NOT conflicts_with_event;
END;
$_$;


--
-- Name: json_underscore_to_camel_case(json); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.json_underscore_to_camel_case(data json) RETURNS json
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT ('{'||string_agg(key_underscore_to_camel_case(key)||':'||value, ',')||'}')::json
    FROM json_each(data)
$$;


--
-- Name: key_underscore_to_camel_case(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.key_underscore_to_camel_case(s text) RETURNS json
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT to_json(substring(s, 1, 1) || substring(replace(initcap(replace(s, '_', ' ')), ' ', ''), 2));
$$;


--
-- Name: login_trainer(public.citext, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.login_trainer(email public.citext, password text) RETURNS TABLE(user_id uuid, trainer_id uuid, access_token text)
    LANGUAGE plpgsql
    AS $$
DECLARE
	password_result record;
BEGIN
	SELECT
		trainer.id AS trainer_id,
		trainer.user_id,
		trainer.user_type,
		(password_hash = crypt(PASSWORD, password_hash)) AS password_match INTO password_result
	FROM
		trainer
	WHERE
		trainer.email = login_trainer.email;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'not_found'
			USING HINT = 'Couldn''t find a trainer with that email';
	END IF;
	IF NOT password_result.password_match THEN
		RAISE EXCEPTION 'unauthenticated'
			USING HINT = 'Password doesn''t match';
	ELSE
		RETURN query INSERT INTO access_token (user_id, user_type, expires_at, type)
			VALUES(password_result.user_id, password_result.user_type, now() + '2 week'::interval, 'api')
		RETURNING
			password_result.user_id, password_result.trainer_id, id as access_token;
	END IF;
END;
$$;


--
-- Name: muid_to_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.muid_to_uuid(id text) RETURNS uuid
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- from https://gist.github.com/cdmckay/a82261e48a42a3bbd78a
  select
    (encode(substring(bin from 9 for 9), 'hex') || encode(substring(bin from 0 for 9), 'hex'))::uuid
  from decode(translate(id, '-_', '+/') || '==', 'base64') as bin;
$$;


--
-- Name: notify_task_queue_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_queue_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
BEGIN
  IF NEW.schedule_time <= NOW() THEN
  	PERFORM pg_notify('task_queue', NEW.id::text);
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: process_stripe_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_stripe_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW .processed_at IS NOT NULL THEN RETURN NEW;

END IF;

INSERT INTO
  task_queue (task_type, data)
VALUES
  (
    'processStripeEvent',
    json_build_object('id', NEW .id)
  );

RETURN NEW;

END;

$$;


--
-- Name: queue_mandrill_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_mandrill_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW .processed_at IS NULL THEN
  INSERT INTO
    task_queue (task_type, data)
  VALUES
    (
      'processMandrillEvent',
      json_build_object(
        'ts',
        NEW .ts :: text,
        '_id',
        NEW ._id,
        'event',
        NEW .event
      )
    );

END IF;

RETURN NEW;

END;

$$;


--
-- Name: save_account_external_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_account_external_accounts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO stripe.bank_account (id, api_version, object)
  SELECT value->>'id', NEW.api_version, value
  FROM (SELECT value FROM jsonb_array_elements(NEW.object#>'{external_accounts, data}')) ba
  ON CONFLICT (id) DO UPDATE
  SET api_version = EXCLUDED.api_version, object = EXCLUDED.object;
  RETURN NULL;
END;
$$;


--
-- Name: send_mail(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_mail() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NOT (
    NEW .queued_at IS NULL
    AND NEW .mandrill_message_id IS NULL
    AND NEW .rejected_at IS NULL
    and NEW .sent_at is null
  ) THEN RETURN NEW;

END IF;

INSERT INTO
  task_queue (task_type, data, max_attempts)
VALUES
  ('sendMail', json_build_object('id', NEW .id), 1);

RETURN NEW;

END;

$$;


--
-- Name: send_sms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_sms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NOT (
    NEW .queued_at IS NULL
    AND NEW .twilio_message_sid IS NULL
    AND NEW .queue_failed_at IS NULL
  ) THEN RETURN NEW;

END IF;

INSERT INTO
  task_queue (task_type, data, max_attempts)
VALUES
  ('sendSms', json_build_object('id', NEW .id), 1);

RETURN NEW;

END;

$$;


--
-- Name: set_client_email_appointment_reminder_session_null_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_email_appointment_reminder_session_null_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  UPDATE
    client_email_appointment_reminder
  SET
    session_id = NULL
  WHERE
    client_email_appointment_reminder.session_id = OLD .id;

RETURN OLD;

END;

$$;


--
-- Name: set_email_appointment_reminder_client_null_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_email_appointment_reminder_client_null_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  UPDATE
    email_appointment_reminder
  SET
    client_id = NULL
  WHERE
    email_appointment_reminder.client_id = OLD.id;

RETURN OLD;

END;

$$;


--
-- Name: set_email_appointment_reminder_session_null_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_email_appointment_reminder_session_null_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  UPDATE
    email_appointment_reminder
  SET
    session_id = NULL
  WHERE
    email_appointment_reminder.session_id = OLD .id;

RETURN OLD;

END;

$$;


--
-- Name: set_mail_client_null_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_mail_client_null_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  UPDATE
    mail
  SET
    client_id = NULL,
    client_was_deleted = TRUE
  WHERE
    mail.client_id = OLD .id;

RETURN OLD;

END;

$$;


--
-- Name: set_sms_client_null_on_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_sms_client_null_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  UPDATE
    sms
  SET
    client_id = NULL,
    client_was_deleted = TRUE
  WHERE
    sms.client_id = OLD .id;

RETURN OLD;

END;

$$;


--
-- Name: trainer_trim(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trainer_trim() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    NEW.email := trim(both ' ' from NEW.email);
    NEW.first_name := trim(both ' ' from NEW.first_name);
    NEW.last_name := trim(both ' ' from NEW.last_name);
    RETURN NEW;
  END;
$$;


--
-- Name: unattach_deleted_sale_from_client_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unattach_deleted_sale_from_client_session() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN
   UPDATE client_session SET sale_id = NULL
      WHERE sale_id = OLD.id;
   RETURN OLD;
END;$$;


--
-- Name: unattach_deleted_service_from_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unattach_deleted_service_from_sessions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN
   UPDATE "session" SET service_id = NULL
      WHERE service_id = OLD.id;
   RETURN OLD;
END;$$;


--
-- Name: update_appointment_reminder_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_appointment_reminder_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  reminder_time timestamptz;
BEGIN
  reminder_time := NEW.start - NEW.service_provider_reminder_1;
  IF reminder_time < NOW() AND NEW.service_provider_reminder_1_checked_at IS NULL THEN
    NEW.service_provider_reminder_1_checked_at := NOW();
  ELSIF reminder_time >= NOW() AND NEW.service_provider_reminder_1_checked_at IS NOT NULL THEN
    NEW.service_provider_reminder_1_checked_at := NULL;
  END IF;

  reminder_time := NEW.start - NEW.service_provider_reminder_2;
  IF reminder_time < NOW() AND NEW.service_provider_reminder_2_checked_at IS NULL THEN
    NEW.service_provider_reminder_2_checked_at := NOW();
  ELSIF reminder_time >= NOW() AND NEW.service_provider_reminder_2_checked_at IS NOT NULL THEN
    NEW.service_provider_reminder_2_checked_at := NULL;
  END IF;

  reminder_time := NEW.start - NEW.client_reminder_1;
  IF reminder_time < NOW() AND NEW.client_reminder_1_checked_at IS NULL THEN
    NEW.client_reminder_1_checked_at := NOW();
  ELSIF reminder_time >= NOW() AND NEW.client_reminder_1_checked_at IS NOT NULL THEN
    NEW.client_reminder_1_checked_at := NULL;
  END IF;

  reminder_time := NEW.start - NEW.client_reminder_2;
  IF reminder_time < NOW() AND NEW.client_reminder_2_checked_at IS NULL THEN
    NEW.client_reminder_2_checked_at := NOW();
  ELSIF reminder_time >= NOW() AND NEW.client_reminder_2_checked_at IS NOT NULL THEN
    NEW.client_reminder_2_checked_at := NULL;
  END IF;

  RETURN NEW;

END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.updated_at = NEW.updated_at THEN
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uuid_or_null(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uuid_or_null(str text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
	RETURN str::uuid;
EXCEPTION
WHEN invalid_text_representation THEN
	RETURN NULL;
END;
$$;


--
-- Name: uuid_to_muid(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uuid_to_muid(id uuid) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- from https://gist.github.com/cdmckay/a82261e48a42a3bbd78a
  select translate(
    encode(
      substring(decode(replace(id::text, '-', ''), 'hex') from 9 for 8) ||
      substring(decode(replace(id::text, '-', ''), 'hex') from 1 for 8),
      'base64'
    ),
    '+/=', '-_'
  );
$$;


--
-- Name: logged_actions; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.logged_actions (
    event_id bigint NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    relid oid NOT NULL,
    session_user_name text,
    action_tstamp_tx timestamp with time zone NOT NULL,
    action_tstamp_stm timestamp with time zone NOT NULL,
    action_tstamp_clk timestamp with time zone NOT NULL,
    transaction_id bigint,
    application_name text,
    client_addr inet,
    client_port integer,
    client_query text,
    action text NOT NULL,
    row_data public.hstore,
    changed_fields public.hstore,
    statement_only boolean NOT NULL,
    CONSTRAINT logged_actions_action_check CHECK ((action = ANY (ARRAY['I'::text, 'D'::text, 'U'::text, 'T'::text])))
);


--
-- Name: TABLE logged_actions; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON TABLE audit.logged_actions IS 'History of auditable actions on audited tables, from audit.if_modified_func()';


--
-- Name: COLUMN logged_actions.event_id; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.event_id IS 'Unique identifier for each auditable event';


--
-- Name: COLUMN logged_actions.schema_name; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.schema_name IS 'Database schema audited table for this event is in';


--
-- Name: COLUMN logged_actions.table_name; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.table_name IS 'Non-schema-qualified table name of table event occured in';


--
-- Name: COLUMN logged_actions.relid; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.relid IS 'Table OID. Changes with drop/create. Get with ''tablename''::regclass';


--
-- Name: COLUMN logged_actions.session_user_name; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.session_user_name IS 'Login / session user whose statement caused the audited event';


--
-- Name: COLUMN logged_actions.action_tstamp_tx; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.action_tstamp_tx IS 'Transaction start timestamp for tx in which audited event occurred';


--
-- Name: COLUMN logged_actions.action_tstamp_stm; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.action_tstamp_stm IS 'Statement start timestamp for tx in which audited event occurred';


--
-- Name: COLUMN logged_actions.action_tstamp_clk; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.action_tstamp_clk IS 'Wall clock time at which audited event''s trigger call occurred';


--
-- Name: COLUMN logged_actions.transaction_id; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.transaction_id IS 'Identifier of transaction that made the change. May wrap, but unique paired with action_tstamp_tx.';


--
-- Name: COLUMN logged_actions.application_name; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.application_name IS 'Application name set when this audit event occurred. Can be changed in-session by client.';


--
-- Name: COLUMN logged_actions.client_addr; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.client_addr IS 'IP address of client that issued query. Null for unix domain socket.';


--
-- Name: COLUMN logged_actions.client_port; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.client_port IS 'Remote peer IP port address of client that issued query. Undefined for unix socket.';


--
-- Name: COLUMN logged_actions.client_query; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.client_query IS 'Top-level query that caused this auditable event. May be more than one statement.';


--
-- Name: COLUMN logged_actions.action; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.action IS 'Action type; I = insert, D = delete, U = update, T = truncate';


--
-- Name: COLUMN logged_actions.row_data; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.row_data IS 'Record value. Null for statement-level trigger. For INSERT this is the new tuple. For DELETE and UPDATE it is the old tuple.';


--
-- Name: COLUMN logged_actions.changed_fields; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.changed_fields IS 'New values of fields changed by UPDATE. Null except for row-level UPDATE events.';


--
-- Name: COLUMN logged_actions.statement_only; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON COLUMN audit.logged_actions.statement_only IS '''t'' if audit event is from an FOR EACH STATEMENT trigger, ''f'' for FOR EACH ROW';


--
-- Name: logged_actions_event_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

CREATE SEQUENCE audit.logged_actions_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logged_actions_event_id_seq; Type: SEQUENCE OWNED BY; Schema: audit; Owner: -
--

ALTER SEQUENCE audit.logged_actions_event_id_seq OWNED BY audit.logged_actions.event_id;


--
-- Name: tableslist; Type: VIEW; Schema: audit; Owner: -
--

CREATE VIEW audit.tableslist AS
 SELECT DISTINCT triggers.trigger_schema AS schema,
    triggers.event_object_table AS auditedtable
   FROM information_schema.triggers
  WHERE ((triggers.trigger_name)::text = ANY (ARRAY['audit_trigger_row'::text, 'audit_trigger_stm'::text]))
  ORDER BY triggers.trigger_schema, triggers.event_object_table;


--
-- Name: VIEW tableslist; Type: COMMENT; Schema: audit; Owner: -
--

COMMENT ON VIEW audit.tableslist IS '
View showing all tables with auditing set up. Ordered by schema, then table.
';


--
-- Name: event; Type: TABLE; Schema: mandrill; Owner: -
--

CREATE TABLE mandrill.event (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ts bigint NOT NULL,
    _id text NOT NULL,
    event text NOT NULL,
    object jsonb NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: access_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_token (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text DEFAULT public.uuid_to_muid(public.uuid_generate_v4()) NOT NULL,
    user_id uuid NOT NULL,
    user_type public.citext NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval) NOT NULL,
    type public.citext NOT NULL
);


--
-- Name: access_token_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_token_type (
    type public.citext NOT NULL
);


--
-- Name: app_store_pending_renewal_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_store_pending_renewal_info (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trainer_id uuid NOT NULL,
    product_id text NOT NULL,
    data jsonb NOT NULL
);


--
-- Name: app_store_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_store_transaction (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_id text NOT NULL,
    original_transaction_id text NOT NULL,
    trainer_id uuid NOT NULL,
    product_id text NOT NULL,
    purchase_date timestamp with time zone NOT NULL,
    expires_date timestamp with time zone NOT NULL,
    web_order_line_item_id text NOT NULL,
    is_trial_period boolean NOT NULL,
    is_in_intro_offer_period boolean NOT NULL,
    encoded_receipt text NOT NULL
);


--
-- Name: trainer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    user_id uuid NOT NULL,
    user_type public.citext DEFAULT 'trainer'::public.citext NOT NULL,
    email public.email NOT NULL,
    password_hash public.bcrypt_hash NOT NULL,
    first_name text NOT NULL,
    last_name text,
    phone_number text,
    stripe_account_id text,
    timezone public.timezone NOT NULL,
    locale public.locale NOT NULL,
    send_receipts boolean DEFAULT true NOT NULL,
    receive_wraps boolean DEFAULT true NOT NULL,
    last_wrap_date timestamp with time zone,
    last_ios_id_for_vendor uuid,
    admin_note text,
    eligible_for_grandfather boolean DEFAULT false NOT NULL,
    terms_accepted boolean DEFAULT false NOT NULL,
    country_id smallint NOT NULL,
    online_bookings_contact_email public.email,
    online_bookings_contact_number text,
    online_bookings_enabled boolean DEFAULT true NOT NULL,
    online_bookings_page_url_slug public.citext DEFAULT public.uuid_generate_v1mc() NOT NULL,
    online_bookings_show_contact_number boolean DEFAULT true,
    online_bookings_duration_until_booking_window_opens interval DEFAULT '1 day'::interval NOT NULL,
    online_bookings_duration_until_booking_window_closes interval DEFAULT '1 mon'::interval NOT NULL,
    online_bookings_monday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_monday_available_intervals public.timerange[] DEFAULT ARRAY['[09:00:00,12:00:00)'::public.timerange, '[13:00:00,17:00:00)'::public.timerange] NOT NULL,
    online_bookings_tuesday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_tuesday_available_intervals public.timerange[] DEFAULT ARRAY['[09:00:00,12:00:00)'::public.timerange, '[13:00:00,17:00:00)'::public.timerange] NOT NULL,
    online_bookings_wednesday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_wednesday_available_intervals public.timerange[] DEFAULT ARRAY['[09:00:00,12:00:00)'::public.timerange, '[13:00:00,17:00:00)'::public.timerange] NOT NULL,
    online_bookings_thursday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_thursday_available_intervals public.timerange[] DEFAULT ARRAY['[09:00:00,12:00:00)'::public.timerange, '[13:00:00,17:00:00)'::public.timerange] NOT NULL,
    online_bookings_friday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_friday_available_intervals public.timerange[] DEFAULT ARRAY['[09:00:00,12:00:00)'::public.timerange, '[13:00:00,17:00:00)'::public.timerange] NOT NULL,
    online_bookings_saturday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_saturday_available_intervals public.timerange[] DEFAULT ARRAY[]::public.timerange[] NOT NULL,
    online_bookings_sunday_accepting_bookings boolean DEFAULT true NOT NULL,
    online_bookings_sunday_available_intervals public.timerange[] DEFAULT ARRAY[]::public.timerange[] NOT NULL,
    business_name text,
    online_bookings_business_name text,
    minimum_balance numeric DEFAULT 0 NOT NULL,
    icalendar_url_slug text DEFAULT public.uuid_to_muid(public.uuid_generate_v4()) NOT NULL,
    sign_in_with_apple_user_id text,
    brand_color public.citext DEFAULT 'blue'::public.citext NOT NULL,
    business_logo_url text,
    brand_dark_mode boolean DEFAULT false,
    online_bookings_terms_and_conditions text,
    online_bookings_booking_note text,
    online_bookings_cancellation_policy text,
    industry text,
    default_service_provider_appointment_reminder_1 interval,
    default_service_provider_appointment_reminder_2 interval,
    default_client_appointment_reminder_1 interval,
    default_client_appointment_reminder_2 interval,
    default_client_appointment_reminder_1_type text DEFAULT 'email'::text NOT NULL,
    default_client_appointment_reminder_2_type text DEFAULT 'email'::text NOT NULL,
    default_service_provider_appointment_reminder_1_type text DEFAULT 'emailAndNotification'::text NOT NULL,
    default_service_provider_appointment_reminder_2_type text DEFAULT 'emailAndNotification'::text NOT NULL,
    stripe_customer_id text,
    sms_credit_checkout_id text DEFAULT public.uuid_to_muid(public.uuid_generate_v4()) NOT NULL,
    trialled_didnt_sub_mailchimp_tag_applied boolean DEFAULT false NOT NULL,
    cover_image_url text,
    default_can_clients_cancel_appointment boolean DEFAULT false NOT NULL,
    stripe_subscription_id text,
    partner text,
    monthly_price_override numeric,
    yearly_price_override numeric,
    stripe_payments_blocked boolean DEFAULT false,
    default_cancellation_advance_notice_duration interval DEFAULT '1 day'::interval NOT NULL,
    first_user_agent text,
    CONSTRAINT trainer_default_appointment_client_reminder_minutes_1_check CHECK ((default_client_appointment_reminder_1 >= '00:00:00'::interval)),
    CONSTRAINT trainer_default_appointment_client_reminder_minutes_2_check CHECK ((default_client_appointment_reminder_2 >= '00:00:00'::interval)),
    CONSTRAINT trainer_default_appointment_service_provider_reminder_mi_check1 CHECK ((default_service_provider_appointment_reminder_2 >= '00:00:00'::interval)),
    CONSTRAINT trainer_default_appointment_service_provider_reminder_min_check CHECK ((default_service_provider_appointment_reminder_1 >= '00:00:00'::interval)),
    CONSTRAINT trainer_first_name_check CHECK ((first_name <> ''::text)),
    CONSTRAINT trainer_last_name_check CHECK ((last_name <> ''::text)),
    CONSTRAINT trainer_monthly_price_override_check CHECK ((monthly_price_override >= (0)::numeric)),
    CONSTRAINT trainer_online_bookings_duration_until_booking_window_clo_check CHECK (((online_bookings_duration_until_booking_window_closes >= '00:00:00'::interval) AND isfinite(online_bookings_duration_until_booking_window_closes))),
    CONSTRAINT trainer_online_bookings_duration_until_booking_window_ope_check CHECK (((online_bookings_duration_until_booking_window_opens >= '00:00:00'::interval) AND isfinite(online_bookings_duration_until_booking_window_opens))),
    CONSTRAINT trainer_phone_number_check CHECK ((phone_number ~ '^[0-9]+$'::text)),
    CONSTRAINT trainer_user_type_check CHECK ((user_type OPERATOR(public.=) 'trainer'::public.citext)),
    CONSTRAINT trainer_yearly_price_override_check CHECK ((yearly_price_override >= (0)::numeric))
);


--
-- Name: trial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trial (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    start_time timestamp with time zone DEFAULT now() NOT NULL,
    end_time timestamp with time zone NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.subscription (
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT subscription_object_check CHECK (((object ->> 'object'::text) = 'subscription'::text))
);


--
-- Name: account_subscription_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.account_subscription_status AS
 SELECT trainer.id AS trainer_id,
        CASE
            WHEN ((subscription.object ->> 'status'::text) = 'active'::text) THEN json_strip_nulls(json_build_object('status', 'subscribed', 'periodEndDate', to_timestamp((((subscription.object -> 'current_period_end'::text))::integer)::double precision), 'renewsAtPeriodEnd', (NOT ((subscription.object -> 'cancel_at_period_end'::text))::boolean), 'platform', 'stripe', 'interval', (subscription.object #>> '{items,data,0,price,recurring,interval}'::text[])))
            WHEN (_app_store_transaction.expires_date > now()) THEN json_strip_nulls(json_build_object('status', 'subscribed', 'periodEndDate', _app_store_transaction.expires_date, 'renewsAtPeriodEnd',
            CASE (_app_store_transaction.data ->> 'auto_renew_status'::text)
                WHEN '1'::text THEN true
                WHEN '0'::text THEN false
                ELSE NULL::boolean
            END, 'interval',
            CASE
                WHEN (_app_store_transaction.product_id ~~ '%.yearly'::text) THEN 'year'::text
                ELSE 'month'::text
            END, 'platform', 'apple'))
            WHEN (((_app_store_transaction.data ->> 'grace_period_expires_date'::text))::timestamp with time zone > now()) THEN json_strip_nulls(json_build_object('status', 'subscribed', 'periodEndDate', ((_app_store_transaction.data ->> 'grace_period_expires_date'::text))::timestamp with time zone, 'renewsAtPeriodEnd',
            CASE (_app_store_transaction.data ->> 'auto_renew_status'::text)
                WHEN '1'::text THEN true
                WHEN '0'::text THEN false
                ELSE NULL::boolean
            END, 'platform', 'apple', 'interval',
            CASE
                WHEN (_app_store_transaction.product_id ~~ '%.yearly'::text) THEN 'year'::text
                ELSE 'month'::text
            END))
            WHEN (_trial.max_end_time > now()) THEN json_build_object('status', 'trialling', 'trialEndDate', _trial.max_end_time)
            WHEN trainer.eligible_for_grandfather THEN json_build_object('status', 'grandfathered')
            WHEN (_app_store_transaction.expires_date IS NULL) THEN json_build_object('status', 'limited')
            WHEN ((subscription.object ->> 'status'::text) = 'past_due'::text) THEN json_build_object('status', 'lapsed', 'platform', 'stripe')
            WHEN ((_app_store_transaction.data ->> 'is_in_billing_retry_period'::text) = '1'::text) THEN json_build_object('status', 'lapsed', 'platform', 'apple')
            ELSE json_build_object('status', 'cancelled')
        END AS subscription,
        CASE
            WHEN ((_app_store_transaction.expires_date > now()) AND ((_app_store_transaction.data ->> 'auto_renew_status'::text) = '1'::text)) THEN _app_store_transaction.expires_date
            WHEN (((subscription.object ->> 'status'::text) = 'active'::text) AND (NOT ((subscription.object -> 'cancel_at_period_end'::text))::boolean)) THEN to_timestamp((((subscription.object -> 'current_period_end'::text))::integer)::double precision)
            WHEN (((_app_store_transaction.data ->> 'grace_period_expires_date'::text))::timestamp with time zone > now()) THEN ((_app_store_transaction.data ->> 'grace_period_expires_date'::text))::timestamp with time zone
            ELSE NULL::timestamp with time zone
        END AS sms_credit_top_up_at,
        CASE
            WHEN ((_app_store_transaction.expires_date > now()) AND ((_app_store_transaction.data ->> 'auto_renew_status'::text) = '1'::text)) THEN
            CASE
                WHEN (_app_store_transaction.product_id ~~ '%.yearly'::text) THEN 360
                ELSE 30
            END
            WHEN (((subscription.object ->> 'status'::text) = 'active'::text) AND (NOT ((subscription.object -> 'cancel_at_period_end'::text))::boolean)) THEN
            CASE
                WHEN ((subscription.object #>> '{items,data,0,price,recurring,interval}'::text[]) = 'year'::text) THEN 360
                ELSE 30
            END
            WHEN (((_app_store_transaction.data ->> 'grace_period_expires_date'::text))::timestamp with time zone > now()) THEN
            CASE
                WHEN (_app_store_transaction.product_id ~~ '%.yearly'::text) THEN 360
                ELSE 30
            END
            ELSE 0
        END AS sms_credit_top_up_count
   FROM (((public.trainer
     LEFT JOIN stripe.subscription ON ((subscription.id = trainer.stripe_subscription_id)))
     LEFT JOIN ( SELECT trial.trainer_id,
            max(trial.end_time) AS max_end_time
           FROM public.trial
          GROUP BY trial.trainer_id) _trial ON ((_trial.trainer_id = trainer.id)))
     LEFT JOIN ( SELECT DISTINCT ON (app_store_transaction.trainer_id) app_store_transaction.trainer_id,
            app_store_transaction.expires_date,
            app_store_transaction.purchase_date,
            app_store_pending_renewal_info.data,
            app_store_transaction.product_id
           FROM (public.app_store_transaction
             LEFT JOIN public.app_store_pending_renewal_info ON (((app_store_pending_renewal_info.trainer_id = app_store_transaction.trainer_id) AND (app_store_pending_renewal_info.product_id = app_store_transaction.product_id))))
          ORDER BY app_store_transaction.trainer_id, app_store_transaction.expires_date DESC) _app_store_transaction ON ((_app_store_transaction.trainer_id = trainer.id)));


--
-- Name: analytics_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_data (
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    anonymous_id uuid,
    user_id uuid,
    properties jsonb,
    screen public.citext,
    event public.citext,
    type public.citext,
    received_at timestamp with time zone NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    context_active boolean,
    context_app_name text,
    context_app_version text,
    context_app_build text,
    context_app_namespace text,
    context_campaign_name text,
    context_campaign_source text,
    context_campaign_medium text,
    context_campaign_term text,
    context_campaign_content text,
    context_device_id text,
    context_device_advertising_id text,
    context_device_ad_tracking_enabled text,
    context_device_manufacturer text,
    context_device_model text,
    context_device_name text,
    context_device_type text,
    context_device_version text,
    context_ip text,
    context_library_name text,
    context_library_version text,
    context_locale text,
    context_location_city text,
    context_location_country text,
    context_location_latitude real,
    context_location_longitude real,
    context_location_region text,
    context_location_speed real,
    context_network_bluetooth boolean,
    context_network_carrier text,
    context_network_cellular boolean,
    context_network_wifi boolean,
    context_os_name text,
    context_os_version text,
    context_page_hash text,
    context_page_path text,
    context_page_referrer text,
    context_page_search text,
    context_page_title text,
    context_page_url text,
    context_referrer_id text,
    context_referrer_type text,
    context_referrer_name text,
    context_referrer_url text,
    context_referrer_link text,
    context_screen_density real,
    context_screen_height real,
    context_screen_width real,
    context_timezone text,
    context_group_id text,
    context_user_agent text
);


--
-- Name: app_notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_notification (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    user_id uuid NOT NULL,
    user_type public.citext DEFAULT 'trainer'::public.citext NOT NULL,
    client_id uuid,
    payment_plan_id uuid,
    payment_id uuid,
    payment_plan_payment_id uuid,
    session_pack_id uuid,
    viewed boolean DEFAULT false NOT NULL,
    body text NOT NULL,
    message_type text NOT NULL,
    notification_type text NOT NULL,
    trainer_id uuid NOT NULL,
    CONSTRAINT app_notification_check CHECK ((((((((client_id IS NOT NULL))::integer + ((payment_plan_id IS NOT NULL))::integer) + ((payment_id IS NOT NULL))::integer) + ((payment_plan_payment_id IS NOT NULL))::integer) + ((session_pack_id IS NOT NULL))::integer) <= 1)),
    CONSTRAINT app_notification_message_type_check CHECK ((message_type = ANY (ARRAY['success'::text, 'default'::text, 'failure'::text]))),
    CONSTRAINT app_notification_notification_type_check CHECK ((notification_type = ANY (ARRAY['general'::text, 'reminder'::text, 'transaction'::text]))),
    CONSTRAINT app_notification_user_type_check CHECK ((user_type OPERATOR(public.=) 'trainer'::public.citext))
);


--
-- Name: app_store_server_notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_store_server_notification (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id integer NOT NULL,
    receive_time timestamp with time zone DEFAULT now() NOT NULL,
    object jsonb NOT NULL
);


--
-- Name: app_store_server_notification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.app_store_server_notification ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.app_store_server_notification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: apple_search_ads_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apple_search_ads_attribution (
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    anonymous_id uuid NOT NULL,
    attribution boolean,
    org_name text,
    org_id text,
    campaign_id text,
    campaign_name text,
    purchase_date timestamp with time zone,
    conversion_date timestamp with time zone,
    conversion_type text,
    click_date timestamp with time zone,
    adgroup_id text,
    adgroup_name text,
    country_or_region text,
    keyword text,
    keyword_id text,
    keyword_matchtype text,
    creativeset_id text,
    creativeset_name text
);


--
-- Name: availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trainer_id uuid NOT NULL,
    date date NOT NULL,
    accepting_bookings boolean,
    available_intervals public.timerange[]
);


--
-- Name: booking_payment_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_payment_type (
    type text NOT NULL
);


--
-- Name: booking_question_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_question_state (
    state text NOT NULL
);


--
-- Name: brand_color; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_color (
    id public.citext NOT NULL
);


--
-- Name: busy_time; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.busy_time (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    start_date date,
    end_date date,
    CONSTRAINT busy_time_check CHECK ((((start_date IS NULL) AND (end_date IS NULL) AND (start_time IS NOT NULL) AND (end_time IS NOT NULL) AND isfinite(start_time) AND isfinite(end_time)) OR ((start_date IS NOT NULL) AND (end_date IS NOT NULL) AND (start_time IS NULL) AND (end_time IS NULL) AND isfinite(start_date) AND isfinite(end_date))))
);


--
-- Name: client; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    user_id uuid NOT NULL,
    user_type public.citext DEFAULT 'client'::public.citext NOT NULL,
    email public.citext,
    password_hash public.bcrypt_hash,
    first_name text NOT NULL,
    last_name text,
    profile_image_url public.url,
    birthday date,
    mobile_number text,
    status public.citext NOT NULL,
    emergency_contact_name text,
    emergency_contact_mobile_number text,
    stripe_customer_id text,
    terms_accepted boolean DEFAULT false NOT NULL,
    other_number text,
    notes text,
    goals text,
    medication text,
    current_injuries text,
    past_injuries text,
    trainer_id uuid NOT NULL,
    sms_reminders_enabled boolean DEFAULT false NOT NULL,
    email_appointment_reminders_enabled boolean DEFAULT true NOT NULL,
    company text,
    location text,
    address text,
    geo point,
    google_place_id text,
    CONSTRAINT client_current_injuries_check CHECK ((current_injuries <> ''::text)),
    CONSTRAINT client_email_check CHECK (((email)::text <> ''::text)),
    CONSTRAINT client_emergency_contact_mobile_number_check CHECK ((emergency_contact_mobile_number <> ''::text)),
    CONSTRAINT client_emergency_contact_name_check CHECK ((emergency_contact_name <> ''::text)),
    CONSTRAINT client_first_name_check CHECK ((first_name <> ''::text)),
    CONSTRAINT client_first_name_check1 CHECK ((first_name <> ''::text)),
    CONSTRAINT client_goals_check CHECK ((goals <> ''::text)),
    CONSTRAINT client_last_name_check CHECK ((last_name <> ''::text)),
    CONSTRAINT client_medication_check CHECK ((medication <> ''::text)),
    CONSTRAINT client_notes_check CHECK ((notes <> ''::text)),
    CONSTRAINT client_other_number_check CHECK ((other_number <> ''::text)),
    CONSTRAINT client_past_injuries_check CHECK ((past_injuries <> ''::text)),
    CONSTRAINT client_user_type_check CHECK ((user_type OPERATOR(public.=) 'client'::public.citext))
);


--
-- Name: client_appointment_reminder_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_appointment_reminder_type (
    type text NOT NULL
);


--
-- Name: client_login_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_login_request (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email public.citext NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    failed_authentication_count integer DEFAULT 0 NOT NULL,
    authenticated boolean DEFAULT false NOT NULL
);


--
-- Name: client_note; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_note (
    id uuid DEFAULT public.generate_ulid_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid NOT NULL,
    title text,
    body text
);


--
-- Name: client_payment_reminder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_payment_reminder (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid NOT NULL,
    send_time timestamp with time zone DEFAULT now(),
    send_success boolean NOT NULL
);


--
-- Name: client_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_session (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    client_id uuid NOT NULL,
    session_id uuid NOT NULL,
    price numeric(10,2),
    note text,
    trainer_id uuid NOT NULL,
    sale_id uuid,
    booked_online boolean DEFAULT false,
    booking_id text DEFAULT public.uuid_to_muid(public.uuid_generate_v4()),
    booking_icalendar_url text,
    state text DEFAULT 'confirmed'::text NOT NULL,
    cancel_time timestamp with time zone,
    cancel_reason character varying(1000),
    accept_time timestamp with time zone,
    decline_time timestamp with time zone,
    invite_time timestamp with time zone,
    confirm_time timestamp with time zone,
    booking_question text,
    booking_question_response text,
    CONSTRAINT client_session_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: client_session_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_session_state (
    state text NOT NULL
);


--
-- Name: client_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_status (
    status public.citext NOT NULL
);


--
-- Name: country; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country (
    id smallint NOT NULL,
    alpha_2_code public.citext NOT NULL,
    alpha_3_code public.citext NOT NULL,
    name text NOT NULL
);


--
-- Name: credit_pack; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_pack (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_credit_pack boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    total_credits integer NOT NULL,
    CONSTRAINT credit_pack_is_credit_pack_check CHECK ((is_credit_pack = true)),
    CONSTRAINT credit_pack_total_credits_check CHECK ((total_credits > 0))
);


--
-- Name: currency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency (
    id smallint NOT NULL,
    alpha_code public.citext NOT NULL,
    name text NOT NULL
);


--
-- Name: email_appointment_reminder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_appointment_reminder (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    session_id uuid,
    client_id uuid,
    mail_id uuid NOT NULL,
    is_client_reminder boolean DEFAULT false NOT NULL
);


--
-- Name: event_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_type (
    type public.citext NOT NULL
);


--
-- Name: finance_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_item (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    name text NOT NULL,
    amount numeric(10,2) NOT NULL,
    start_date timestamp with time zone NOT NULL,
    note text,
    image_url text
);


--
-- Name: installation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installation (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id integer NOT NULL,
    user_id uuid NOT NULL,
    user_type public.citext DEFAULT 'trainer'::public.citext NOT NULL,
    device_token text NOT NULL,
    device_type text NOT NULL,
    CONSTRAINT installation_device_type_check CHECK ((device_type = 'ios'::text)),
    CONSTRAINT installation_user_type_check CHECK ((user_type OPERATOR(public.=) 'trainer'::public.citext))
);


--
-- Name: installation_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.installation ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.installation_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid,
    client_id uuid,
    client_was_deleted boolean,
    mandrill_message_id text,
    from_email public.email NOT NULL,
    from_name text,
    to_email public.email NOT NULL,
    to_name text,
    subject text NOT NULL,
    html text NOT NULL,
    queued_at timestamp with time zone,
    rejected_at timestamp with time zone,
    reject_reason text,
    sent_at timestamp with time zone,
    reply_to text
);


--
-- Name: mail_bounce; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_bounce (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    mail_id uuid NOT NULL,
    bounced_at timestamp with time zone NOT NULL,
    bounce_type text,
    diagnosis text,
    description text
);


--
-- Name: mail_bounce_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_bounce_type (
    type text NOT NULL
);


--
-- Name: mail_click; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_click (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    mail_id uuid NOT NULL,
    clicked_at timestamp with time zone NOT NULL,
    ip inet NOT NULL,
    user_agent text NOT NULL,
    url text NOT NULL,
    location jsonb
);


--
-- Name: mail_open; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_open (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    mail_id uuid NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    ip inet NOT NULL,
    user_agent text NOT NULL,
    location jsonb
);


--
-- Name: mission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mission (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trainer_id uuid NOT NULL,
    id text NOT NULL,
    completed_at timestamp with time zone,
    reward_id uuid,
    display_order smallint NOT NULL
);


--
-- Name: mission_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mission_type (
    id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    action_url text
);


--
-- Name: payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    is_manual boolean,
    is_stripe boolean,
    is_scheduled_stripe boolean,
    is_credit_pack boolean,
    is_subscription boolean,
    amount numeric NOT NULL,
    refunded_time timestamp with time zone,
    CONSTRAINT payment_amount_check1 CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payment_check1 CHECK ((((((((is_manual IS NOT NULL))::integer + ((is_scheduled_stripe IS NOT NULL))::integer) + ((is_stripe IS NOT NULL))::integer) + ((is_credit_pack IS NOT NULL))::integer) + ((is_subscription IS NOT NULL))::integer) = 1)),
    CONSTRAINT payment_is_credit_pack_check CHECK (is_credit_pack),
    CONSTRAINT payment_is_manual_check CHECK (is_manual),
    CONSTRAINT payment_is_scheduled_stripe_check CHECK (is_scheduled_stripe),
    CONSTRAINT payment_is_stripe_check CHECK (is_stripe),
    CONSTRAINT payment_is_subscription_check CHECK (is_subscription)
);


--
-- Name: payment_credit_pack; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_credit_pack (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_credit_pack boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    sale_credit_pack_id uuid NOT NULL,
    transaction_time timestamp with time zone NOT NULL,
    credits_used integer NOT NULL,
    CONSTRAINT payment_credit_pack_credits_used_check CHECK ((credits_used >= 0)),
    CONSTRAINT payment_credit_pack_is_credit_pack_check CHECK (is_credit_pack)
);


--
-- Name: payment_manual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_manual (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_manual boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    method public.citext NOT NULL,
    transaction_time timestamp with time zone NOT NULL,
    specific_method_name public.citext,
    CONSTRAINT payment_manual_is_manual_check CHECK (is_manual)
);


--
-- Name: payment_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_method (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    method public.citext NOT NULL
);


--
-- Name: payment_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid NOT NULL,
    status public.citext NOT NULL,
    start timestamp with time zone NOT NULL,
    end_ timestamp with time zone NOT NULL,
    accepted_end timestamp with time zone,
    frequency_weekly_interval smallint NOT NULL,
    name text NOT NULL,
    amount numeric(10,2) NOT NULL,
    accepted_amount numeric(10,2),
    acceptance_request_time timestamp with time zone,
    CONSTRAINT payment_plan_accepted_amount_check CHECK ((accepted_amount >= (0)::numeric)),
    CONSTRAINT payment_plan_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payment_plan_check CHECK ((((accepted_amount IS NULL) AND (accepted_end IS NULL)) OR ((accepted_amount IS NOT NULL) AND (accepted_end IS NOT NULL)))),
    CONSTRAINT payment_plan_check1 CHECK (((status OPERATOR(public.<>) 'pending'::public.citext) OR (acceptance_request_time IS NOT NULL)))
);


--
-- Name: payment_plan_acceptance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_acceptance (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    payment_plan_id uuid NOT NULL,
    date timestamp with time zone NOT NULL,
    ip_address inet NOT NULL,
    amount numeric(10,2) NOT NULL,
    end_ timestamp with time zone NOT NULL,
    trainer_id uuid NOT NULL,
    CONSTRAINT payment_plan_acceptance_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: payment_plan_charge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_charge (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    payment_plan_payment_id uuid NOT NULL,
    stripe_charge_id text,
    stripe_payment_intent_id text,
    CONSTRAINT stripe_check CHECK ((((stripe_charge_id IS NOT NULL) AND (stripe_payment_intent_id IS NULL)) OR ((stripe_charge_id IS NULL) AND (stripe_payment_intent_id IS NOT NULL))))
);


--
-- Name: payment_plan_pause; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_pause (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    payment_plan_id uuid NOT NULL,
    start timestamp with time zone NOT NULL,
    end_ timestamp with time zone NOT NULL,
    trainer_id uuid NOT NULL
);


--
-- Name: payment_plan_payment_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_payment_status (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status public.citext NOT NULL
);


--
-- Name: payment_plan_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_plan_status (
    status public.citext NOT NULL
);


--
-- Name: payment_scheduled_stripe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_scheduled_stripe (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_scheduled_stripe boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    trigger_time timestamp with time zone NOT NULL,
    stripe_charge_id text,
    CONSTRAINT payment_scheduled_stripe_is_scheduled_stripe_check CHECK (is_scheduled_stripe)
);


--
-- Name: payment_scheduled_stripe_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_scheduled_stripe_attempt (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    payment_scheduled_stripe_id uuid NOT NULL
);


--
-- Name: payment_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_stats (
    count bigint,
    max_date timestamp with time zone
);


--
-- Name: payment_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_status (
    status public.citext NOT NULL
);


--
-- Name: payment_stripe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_stripe (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_stripe boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    stripe_charge_id text,
    fee numeric NOT NULL,
    stripe_payment_intent_id text,
    fee_passed_on boolean DEFAULT false NOT NULL,
    CONSTRAINT payment_stripe_fee_check CHECK ((fee >= (0)::numeric)),
    CONSTRAINT payment_stripe_is_stripe_check CHECK (is_stripe),
    CONSTRAINT stripe_check CHECK ((((stripe_charge_id IS NOT NULL) AND (stripe_payment_intent_id IS NULL)) OR ((stripe_charge_id IS NULL) AND (stripe_payment_intent_id IS NOT NULL))))
);


--
-- Name: payment_subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_subscription (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_subscription boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    CONSTRAINT payment_subscription_is_subscription_check CHECK (is_subscription)
);


--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    is_item boolean,
    is_credit_pack boolean,
    is_service boolean,
    is_membership boolean,
    name text NOT NULL,
    description text NOT NULL,
    price numeric NOT NULL,
    currency_id smallint NOT NULL,
    display_order smallint,
    CONSTRAINT product_check CHECK (((((((is_item IS NOT NULL))::integer + ((is_credit_pack IS NOT NULL))::integer) + ((is_service IS NOT NULL))::integer) + ((is_membership IS NOT NULL))::integer) = 1)),
    CONSTRAINT product_is_credit_pack_check CHECK (is_credit_pack),
    CONSTRAINT product_is_good_check CHECK (is_item),
    CONSTRAINT product_is_membership_check CHECK (is_membership),
    CONSTRAINT product_is_service_check CHECK (is_service),
    CONSTRAINT product_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: request_client_address_online_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_client_address_online_type (
    type text NOT NULL
);


--
-- Name: reward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    type text NOT NULL,
    claimed_at timestamp with time zone
);


--
-- Name: reward_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_type (
    type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL
);


--
-- Name: sale; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid NOT NULL,
    subscription_period_id uuid,
    payment_request_time timestamp with time zone,
    note text DEFAULT ''::text NOT NULL,
    due_time timestamp with time zone DEFAULT now() NOT NULL,
    payment_request_pass_on_transaction_fee boolean DEFAULT false NOT NULL,
    CONSTRAINT sale_payment_request_time_check CHECK (isfinite(payment_request_time))
);


--
-- Name: sale_credit_pack; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_credit_pack (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_credit_pack boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    total_credits integer NOT NULL,
    CONSTRAINT ordered_credit_pack_is_credit_pack_check CHECK ((is_credit_pack = true)),
    CONSTRAINT ordered_credit_pack_total_credits_check CHECK ((total_credits > 0))
);


--
-- Name: sale_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_item (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_item boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    CONSTRAINT ordered_good_is_good_check CHECK (is_item)
);


--
-- Name: stripe_charge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_charge (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date,
    object jsonb
);


--
-- Name: sale_payment_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sale_payment_status AS
 SELECT sale.id AS sale_id,
        CASE
            WHEN (payment.refunded_time IS NOT NULL) THEN 'refunded'::text
            WHEN ((stripe_charge.object -> 'paid'::text))::boolean THEN 'paid'::text
            WHEN (NOT ((stripe_charge.object -> 'paid'::text))::boolean) THEN 'rejected'::text
            WHEN (payment.id IS NOT NULL) THEN 'paid'::text
            WHEN (sale.payment_request_time IS NOT NULL) THEN 'requested'::text
            WHEN (payment.id IS NULL) THEN 'none'::text
            ELSE NULL::text
        END AS payment_status
   FROM (((public.sale
     LEFT JOIN public.payment ON ((payment.sale_id = sale.id)))
     LEFT JOIN public.payment_stripe ON ((payment_stripe.id = payment.id)))
     LEFT JOIN public.stripe_charge ON ((stripe_charge.id = payment_stripe.stripe_charge_id)));


--
-- Name: sale_product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_product (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    is_item boolean,
    is_credit_pack boolean,
    is_service boolean,
    is_membership boolean,
    name text NOT NULL,
    price numeric NOT NULL,
    client_id uuid NOT NULL,
    product_id uuid,
    sale_id uuid NOT NULL,
    CONSTRAINT ordered_product_check CHECK (((((((is_item IS NOT NULL))::integer + ((is_credit_pack IS NOT NULL))::integer) + ((is_service IS NOT NULL))::integer) + ((is_membership IS NOT NULL))::integer) = 1)),
    CONSTRAINT ordered_product_is_credit_pack_check CHECK (is_credit_pack),
    CONSTRAINT ordered_product_is_good_check CHECK (is_item),
    CONSTRAINT ordered_product_is_membership_check CHECK (is_membership),
    CONSTRAINT ordered_product_is_service_check CHECK (is_service),
    CONSTRAINT ordered_product_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: sale_service; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_service (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_service boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    duration interval minute,
    location text,
    address text,
    geo point,
    google_place_id text,
    CONSTRAINT ordered_service_duration_check CHECK (((duration >= '00:00:00'::interval) AND isfinite(duration))),
    CONSTRAINT ordered_service_is_service_check CHECK (is_service)
);


--
-- Name: schema_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_history (
    installed_rank integer NOT NULL,
    version text,
    description text NOT NULL,
    type text NOT NULL,
    script text NOT NULL,
    checksum uuid,
    installed_by text,
    installed_on timestamp with time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: schema_history_installed_rank_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schema_history ALTER COLUMN installed_rank ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.schema_history_installed_rank_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
--



--
-- Name: service; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    is_service boolean DEFAULT true NOT NULL,
    trainer_id uuid NOT NULL,
    duration interval minute,
    location text,
    bookable_online boolean NOT NULL,
    address text,
    geo point,
    google_place_id text,
    cover_image_url text,
    image_0_url text,
    image_1_url text,
    image_2_url text,
    image_3_url text,
    image_4_url text,
    booking_payment_type text DEFAULT 'noPrepayment'::text NOT NULL,
    buffer_minutes_before smallint DEFAULT 0 NOT NULL,
    buffer_minutes_after smallint DEFAULT 0 NOT NULL,
    time_slot_frequency_minutes smallint DEFAULT 15 NOT NULL,
    image_5_url text,
    icon_url text,
    request_client_address_online text,
    booking_question text,
    booking_question_state text,
    CONSTRAINT service_duration_check1 CHECK (((duration >= '00:00:00'::interval) AND isfinite(duration))),
    CONSTRAINT service_is_service_check CHECK ((is_service = true)),
    CONSTRAINT service_time_slot_frequency_minutes_check CHECK ((time_slot_frequency_minutes > 0))
);


--
-- Name: service_provider_appointment_reminder_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_provider_appointment_reminder_type (
    type text NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    session_series_id uuid NOT NULL,
    start timestamp with time zone NOT NULL,
    duration interval NOT NULL,
    timezone public.timezone NOT NULL,
    note text,
    service_id uuid,
    booked_online boolean DEFAULT false,
    maximum_attendance integer,
    trainer_id uuid NOT NULL,
    sms_reminder_sent_time timestamp with time zone,
    location text,
    address text,
    geo point,
    google_place_id text,
    bookable_online boolean DEFAULT false NOT NULL,
    booking_payment_type text DEFAULT 'noPrepayment'::text NOT NULL,
    service_provider_reminder_1 interval,
    service_provider_reminder_2 interval,
    client_reminder_1 interval,
    client_reminder_2 interval,
    service_provider_reminder_1_checked_at timestamp with time zone,
    service_provider_reminder_2_checked_at timestamp with time zone,
    client_reminder_1_checked_at timestamp with time zone,
    client_reminder_2_checked_at timestamp with time zone,
    client_reminder_1_type text DEFAULT 'email'::text NOT NULL,
    client_reminder_2_type text DEFAULT 'email'::text NOT NULL,
    service_provider_reminder_1_type text DEFAULT 'emailAndNotification'::text NOT NULL,
    service_provider_reminder_2_type text DEFAULT 'emailAndNotification'::text NOT NULL,
    buffer_minutes_before smallint DEFAULT 0 NOT NULL,
    buffer_minutes_after smallint DEFAULT 0 NOT NULL,
    description text,
    can_clients_cancel boolean DEFAULT false NOT NULL,
    cancellation_advance_notice_duration interval DEFAULT '1 day'::interval NOT NULL,
    request_client_address_online text,
    booking_question text,
    booking_question_state text,
    CONSTRAINT session_client_reminder_minutes_1_check CHECK ((client_reminder_1 >= '00:00:00'::interval)),
    CONSTRAINT session_client_reminder_minutes_2_check CHECK ((client_reminder_2 >= '00:00:00'::interval)),
    CONSTRAINT session_duration_check CHECK (((duration >= '00:00:00'::interval) AND isfinite(duration))),
    CONSTRAINT session_maximum_attendance_check CHECK ((maximum_attendance >= 0)),
    CONSTRAINT session_service_provider_reminder_minutes_1_check CHECK ((service_provider_reminder_1 >= '00:00:00'::interval)),
    CONSTRAINT session_service_provider_reminder_minutes_2_check CHECK ((service_provider_reminder_2 >= '00:00:00'::interval))
);


--
-- Name: session_icon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_icon (
    id public.citext NOT NULL
);


--
-- Name: sms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid,
    twilio_message_sid text,
    client_id uuid,
    client_was_deleted boolean,
    from_number text,
    to_number text NOT NULL,
    body character varying(1600) NOT NULL,
    queued_at timestamp with time zone,
    queue_failed_at timestamp with time zone,
    queue_failed_reason text
);


--
-- Name: sms_credit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_credit (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc(),
    trainer_id uuid NOT NULL,
    amount integer NOT NULL,
    source text NOT NULL,
    sms_credit_checkout_session_id text
);


--
-- Name: message; Type: TABLE; Schema: twilio; Owner: -
--

CREATE TABLE twilio.message (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sid text NOT NULL,
    object jsonb NOT NULL
);


--
-- Name: sms_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sms_balance AS
 SELECT trainer.id AS trainer_id,
    (COALESCE(credits.credits, (0)::bigint) - COALESCE(used.used, (0)::bigint)) AS credit_balance
   FROM ((public.trainer
     LEFT JOIN ( SELECT sms_credit.trainer_id,
            sum(sms_credit.amount) AS credits
           FROM public.sms_credit
          GROUP BY sms_credit.trainer_id) credits ON ((credits.trainer_id = trainer.id)))
     LEFT JOIN ( SELECT sms.trainer_id,
            count(*) AS used
           FROM (public.sms
             JOIN twilio.message ON ((message.sid = sms.twilio_message_sid)))
          WHERE ((sms.queued_at IS NOT NULL) AND ((message.object ->> 'status'::text) <> 'failed'::text) AND (sms.trainer_id IS NOT NULL))
          GROUP BY sms.trainer_id) used ON ((credits.trainer_id = used.trainer_id)));


--
-- Name: sms_credit_checkout_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_credit_checkout_session (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    trainer_id uuid NOT NULL,
    credit_count integer NOT NULL
);


--
-- Name: sms_credit_source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_credit_source (
    source text NOT NULL
);


--
-- Name: stripe_balance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_balance (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL
);


--
-- Name: stripe_payment_intent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_payment_intent (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb
);


--
-- Name: stripe_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_resource (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date,
    object jsonb NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid,
    name text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    timezone public.timezone NOT NULL,
    recurrence_frequency public.citext NOT NULL,
    recurrence_interval integer NOT NULL,
    amount numeric NOT NULL,
    accept_time timestamp with time zone,
    ip_address inet,
    CONSTRAINT subscription_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT subscription_recurrence_interval_check CHECK ((recurrence_interval > 0))
);


--
-- Name: subscription_frequency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_frequency (
    frequency public.citext NOT NULL,
    duration interval NOT NULL
);


--
-- Name: subscription_pause; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_pause (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid,
    subscription_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL
);


--
-- Name: subscription_period; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_period (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid,
    subscription_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL
);


--
-- Name: subscription_update; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_update (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    trainer_id uuid NOT NULL,
    client_id uuid,
    subscription_id uuid NOT NULL,
    update_time timestamp with time zone DEFAULT now() NOT NULL,
    end_time timestamp with time zone NOT NULL,
    timezone public.timezone NOT NULL,
    recurrence_frequency public.citext NOT NULL,
    recurrence_interval integer NOT NULL,
    amount numeric NOT NULL,
    accept_time timestamp with time zone,
    ip_address inet,
    CONSTRAINT subscription_update_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT subscription_update_recurrence_interval_check CHECK ((recurrence_interval > 0))
);


--
-- Name: supported_country_currency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supported_country_currency (
    country_id smallint NOT NULL,
    currency_id smallint NOT NULL
);


--
-- Name: survey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey (
    id integer NOT NULL,
    trainer_id uuid NOT NULL,
    survey_time timestamp with time zone DEFAULT now() NOT NULL,
    topics_to_improve text[] DEFAULT '{}'::text[] NOT NULL,
    industry text,
    years_experience text,
    features text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT survey_years_experience_check CHECK ((years_experience ~ '^(?:(?:[><]?\d+)|(?:\d+-\d+))$'::text))
);


--
-- Name: survey_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.survey ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.survey_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: task_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_queue (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL,
    task_type text NOT NULL,
    schedule_time timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_time timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    data jsonb,
    recurring_schedule text,
    timezone public.timezone,
    max_attempts integer DEFAULT 2147483647 NOT NULL,
    max_retry_duration interval,
    min_backoff interval DEFAULT '00:01:00'::interval NOT NULL,
    max_backoff interval DEFAULT '01:00:00'::interval NOT NULL,
    max_doublings integer DEFAULT 16 NOT NULL,
    attempt_deadline timestamp with time zone DEFAULT 'infinity'::timestamp with time zone NOT NULL,
    first_attempt_time timestamp with time zone
);


--
-- Name: task_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.task_queue ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.task_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_ (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT public.uuid_generate_v1mc() NOT NULL,
    type public.citext NOT NULL
);


--
-- Name: user_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_type (
    type public.citext NOT NULL
);


--
-- Name: vw_first_card_payments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_first_card_payments AS
 SELECT card_payments.trainer_id,
    min(card_payments.card_payment_date) AS first_card_payment_processed
   FROM ( SELECT payment_stripe.trainer_id,
            min(to_timestamp((((stripe_charge.object -> 'created'::text))::integer)::double precision)) AS card_payment_date
           FROM (public.payment_stripe
             JOIN public.stripe_charge ON ((stripe_charge.id = payment_stripe.stripe_charge_id)))
          WHERE ((stripe_charge.object -> 'paid'::text))::boolean
          GROUP BY payment_stripe.trainer_id
        UNION
         SELECT payment_plan.trainer_id,
            min(payment_plan_payment.date) AS card_payment_date
           FROM ((public.payment_plan_payment
             JOIN public.payment_plan ON ((payment_plan.id = payment_plan_payment.payment_plan_id)))
             JOIN ( VALUES ('paid'::text), ('refunded'::text)) vals(v) ON (((payment_plan_payment.status)::text = vals.v)))
          GROUP BY payment_plan.trainer_id) card_payments
  GROUP BY card_payments.trainer_id;


--
-- Name: vw_legacy_app_notification; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_app_notification AS
 SELECT app_notification.id,
    app_notification.created_at AS created,
    app_notification.viewed,
        CASE
            WHEN (app_notification.payment_plan_id IS NOT NULL) THEN 'plan'::text
            WHEN (app_notification.payment_plan_payment_id IS NOT NULL) THEN 'planPayment'::text
            WHEN (app_notification.session_pack_id IS NOT NULL) THEN 'sessionPack'::text
            WHEN (app_notification.payment_id IS NOT NULL) THEN 'payment'::text
            WHEN (app_notification.client_id IS NOT NULL) THEN 'client'::text
            ELSE NULL::text
        END AS model_name,
        CASE
            WHEN (app_notification.payment_plan_id IS NOT NULL) THEN app_notification.payment_plan_id
            WHEN (app_notification.payment_plan_payment_id IS NOT NULL) THEN app_notification.payment_plan_payment_id
            WHEN (app_notification.session_pack_id IS NOT NULL) THEN app_notification.session_pack_id
            WHEN (app_notification.payment_id IS NOT NULL) THEN app_notification.payment_id
            WHEN (app_notification.client_id IS NOT NULL) THEN app_notification.client_id
            ELSE NULL::uuid
        END AS model_id,
    app_notification.body AS alert,
    NULL::text AS expiration_interval,
    app_notification.notification_type,
    app_notification.user_id,
        CASE
            WHEN (app_notification.payment_plan_id IS NOT NULL) THEN payment_plan.client_id
            WHEN (app_notification.payment_plan_payment_id IS NOT NULL) THEN pp.client_id
            WHEN (app_notification.session_pack_id IS NOT NULL) THEN session_pack.client_id
            WHEN (app_notification.payment_id IS NOT NULL) THEN payment.client_id
            WHEN (app_notification.client_id IS NOT NULL) THEN app_notification.client_id
            ELSE NULL::uuid
        END AS client_id,
    app_notification.message_type,
    app_notification.notification_type AS category
   FROM ((((public.app_notification
     LEFT JOIN public.payment_plan ON ((payment_plan.id = app_notification.payment_plan_id)))
     LEFT JOIN ( SELECT sale_product.id,
            sale.client_id
           FROM (public.sale_product
             JOIN public.sale ON ((sale.id = sale_product.sale_id)))
          WHERE sale_product.is_credit_pack) session_pack ON ((session_pack.id = app_notification.session_pack_id)))
     LEFT JOIN public.payment ON ((payment.id = app_notification.payment_id)))
     LEFT JOIN ( SELECT payment_plan_1.client_id,
            payment_plan_payment.id
           FROM (public.payment_plan_payment
             JOIN public.payment_plan payment_plan_1 ON ((payment_plan_1.id = payment_plan_payment.payment_plan_id)))) pp ON ((pp.id = app_notification.payment_plan_payment_id)));


--
-- Name: vw_legacy_plan; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_plan AS
 SELECT payment_plan.trainer_id AS "trainerId",
    payment_plan.id,
    payment_plan.name,
    (payment_plan.amount)::double precision AS amount,
    payment_plan.status,
    payment_plan.start AS "startDate",
    NULLIF(payment_plan.end_, 'infinity'::timestamp with time zone) AS "endDate",
    (payment_plan.frequency_weekly_interval * 7) AS frequency,
    payment_plan.client_id AS "clientId",
    ( SELECT COALESCE(json_agg(( SELECT row_to_json(p.*) AS row_to_json
                   FROM ( SELECT payment_plan_payment.id,
                            payment_plan_payment.date,
                            payment_plan_payment.amount,
                            payment_plan_payment.amount_outstanding AS "outstandingAmount",
                            payment_plan_payment.status,
                            payment_plan_payment.payment_plan_id AS "planId",
                            currency.alpha_code AS currency) p)), '[]'::json) AS "coalesce"
           FROM public.payment_plan_payment
          WHERE (payment_plan_payment.payment_plan_id = payment_plan.id)) AS "planPayments",
    ( SELECT COALESCE(json_agg(( SELECT row_to_json(p.*) AS row_to_json
                   FROM ( SELECT payment_plan_pause.id,
                            payment_plan_pause.start AS "startDate",
                            NULLIF(payment_plan_pause.end_, 'infinity'::timestamp with time zone) AS "endDate",
                            NULL::text AS "reminderDate",
                            payment_plan_pause.payment_plan_id AS "planId") p)), '[]'::json) AS "coalesce"
           FROM public.payment_plan_pause
          WHERE (payment_plan_pause.payment_plan_id = payment_plan.id)) AS "planPauses",
    payment_dates.next_payment_date AS "nextPaymentDate",
    payment_dates.last_payment_date AS "lastPaymentDate",
    COALESCE(( SELECT json_agg(a.session_series_id) AS json_agg
           FROM ( SELECT session.session_series_id
                   FROM ((((public.client_session
                     JOIN public.sale ON ((sale.id = client_session.sale_id)))
                     JOIN public.session ON ((session.id = client_session.session_id)))
                     JOIN public.payment ON ((payment.sale_id = sale.id)))
                     JOIN public.payment_subscription ON ((payment_subscription.id = payment.id)))
                  WHERE (payment_subscription.subscription_id = payment_plan.id)
                  GROUP BY session.session_series_id) a), '[]'::json) AS "sessionSeriesIds",
    currency.alpha_code AS currency
   FROM ((((public.payment_plan
     JOIN ( SELECT payment_plan_1.id AS payment_plan_id,
                CASE
                    WHEN (payment_plan_1.status OPERATOR(public.=) ANY (ARRAY['active'::public.citext, 'pending'::public.citext, 'paused'::public.citext])) THEN (ppp.last_payment_date + ((payment_plan_1.frequency_weekly_interval)::double precision * '7 days'::interval))
                    ELSE NULL::timestamp with time zone
                END AS next_payment_date,
            ppp.last_payment_date
           FROM (public.payment_plan payment_plan_1
             LEFT JOIN ( SELECT payment_plan_payment.payment_plan_id,
                    max(payment_plan_payment.date) AS last_payment_date
                   FROM public.payment_plan_payment
                  GROUP BY payment_plan_payment.payment_plan_id) ppp ON ((ppp.payment_plan_id = payment_plan_1.id)))) payment_dates ON ((payment_plan.id = payment_dates.payment_plan_id)))
     JOIN public.trainer ON ((trainer.id = payment_plan.trainer_id)))
     JOIN public.supported_country_currency ON ((supported_country_currency.country_id = trainer.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)));


--
-- Name: vw_legacy_session_pack; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_session_pack AS
 SELECT sale_product.trainer_id AS "trainerId",
    sale_product.id,
    sale_product.name,
    (sale_product.price)::double precision AS amount,
    sale_credit_pack.total_credits AS "sessionsTotal",
    (sale_credit_pack.total_credits - COALESCE((cs.count)::integer, 0)) AS "sessionsRemaining",
        CASE
            WHEN (payment.refunded_time IS NOT NULL) THEN 'refunded'::text
            WHEN (NOT ((stripe_charge.object -> 'paid'::text))::boolean) THEN 'rejected'::text
            WHEN (payment.id IS NOT NULL) THEN 'paid'::text
            WHEN (sale.payment_request_time IS NOT NULL) THEN 'requested'::text
            WHEN (sale_product.price = (0)::numeric) THEN 'paid'::text
            ELSE 'pending'::text
        END AS "paymentStatus",
        CASE
            WHEN payment.is_stripe THEN 'card'::text
            WHEN (payment_manual.method OPERATOR(public.=) 'card'::public.citext) THEN 'card'::text
            WHEN (payment_manual.method OPERATOR(public.=) 'cash'::public.citext) THEN 'cash'::text
            WHEN (sale.payment_request_time IS NOT NULL) THEN 'card'::text
            ELSE 'cash'::text
        END AS "paymentMethod",
    payment_stripe.stripe_charge_id AS "stripeCharge",
    NULL::text AS "stripeRefund",
    sale.client_id AS "clientId",
    sale_credit_pack.created_at AS "createdAt"
   FROM (((((((public.sale_credit_pack
     JOIN public.sale_product ON ((sale_credit_pack.id = sale_product.id)))
     JOIN public.sale ON ((sale.id = sale_product.sale_id)))
     LEFT JOIN public.payment ON ((payment.sale_id = sale.id)))
     LEFT JOIN public.payment_stripe ON ((payment_stripe.id = payment.id)))
     LEFT JOIN public.payment_manual ON ((payment_manual.id = payment.id)))
     LEFT JOIN public.stripe_charge ON ((stripe_charge.id = payment_stripe.stripe_charge_id)))
     LEFT JOIN ( SELECT payment_credit_pack.sale_credit_pack_id AS ordered_credit_pack_id,
            sum(payment_credit_pack.credits_used) AS count
           FROM (public.payment_credit_pack
             JOIN public.payment payment_1 ON ((payment_1.id = payment_credit_pack.id)))
          WHERE (payment_1.refunded_time IS NULL)
          GROUP BY payment_credit_pack.sale_credit_pack_id) cs ON ((cs.ordered_credit_pack_id = sale_product.id)));


--
-- Name: customer; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.customer (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT customer_object_check CHECK (((object ->> 'object'::text) = 'customer'::text))
);


--
-- Name: payment_method; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.payment_method (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT payment_method_object_check CHECK (((object ->> 'object'::text) = 'payment_method'::text))
);


--
-- Name: vw_legacy_client; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_client AS
 SELECT client.id,
    client.first_name AS "firstName",
    client.last_name AS "lastName",
    client.email,
    client.profile_image_url AS "profileImageURL",
    client.mobile_number AS "mobileNumber",
    client.other_number AS "otherNumber",
    client.status,
    client.emergency_contact_name AS "emergencyContactName",
    client.emergency_contact_mobile_number AS "emergencyContactMobileNumber",
    client.stripe_customer_id AS "stripeCustomer",
    COALESCE(pm.last4, (customer.object #>> '{sources,data,0,last4}'::text[])) AS "cardLast4Digits",
    COALESCE(pm.brand, (customer.object #>> '{sources,data,0,brand}'::text[])) AS "cardBrand",
    client.terms_accepted AS "termsAccepted",
    client.trainer_id AS "trainerId",
    client.user_id AS "memberId",
    ( SELECT json_agg(n.*) AS json_agg
           FROM ( SELECT ((client.id)::text || client_notes.column2) AS id,
                    COALESCE(client_notes.column1, ''::text) AS content,
                    client_notes.column2 AS classification,
                    client.id AS "clientId",
                    NULL::text AS "financeItemId",
                    NULL::text AS "sessionSeriesId",
                    NULL::text AS "sessionId",
                    NULL::text AS "clientSessionId"
                   FROM ( VALUES (client.notes,'notes'::text), (client.goals,'goals'::text), (client.medication,'medication'::text), (client.current_injuries,'currentInjuries'::text), (client.past_injuries,'pastInjuries'::text)) client_notes) n) AS notes,
    client.birthday,
    ( SELECT COALESCE(json_agg(vw_legacy_session_pack.*), '[]'::json) AS "coalesce"
           FROM public.vw_legacy_session_pack
          WHERE (vw_legacy_session_pack."clientId" = client.id)) AS "sessionPacks",
    ( SELECT COALESCE(json_agg(vw_legacy_plan.*), '[]'::json) AS "coalesce"
           FROM public.vw_legacy_plan vw_legacy_plan
          WHERE (vw_legacy_plan."clientId" = client.id)) AS plans,
    client.company,
    client.location,
    client.address,
    client.google_place_id AS "googlePlaceId",
        CASE
            WHEN (client.geo IS NOT NULL) THEN json_build_object('lat', client.geo[0], 'lng', client.geo[1])
            ELSE NULL::json
        END AS geo
   FROM ((public.client
     LEFT JOIN stripe.customer ON ((customer.id = client.stripe_customer_id)))
     LEFT JOIN ( SELECT DISTINCT ON ((payment_method.object ->> 'customer'::text)) (payment_method.object ->> 'customer'::text) AS customer,
            (payment_method.object ->> 'created'::text) AS created,
            (payment_method.object #>> '{card,brand}'::text[]) AS brand,
            (payment_method.object #>> '{card,last4}'::text[]) AS last4
           FROM stripe.payment_method
          WHERE ((payment_method.object ->> 'customer'::text) IS NOT NULL)
          ORDER BY (payment_method.object ->> 'customer'::text), (payment_method.object ->> 'created'::text) DESC) pm ON ((pm.customer = client.stripe_customer_id)));


--
-- Name: vw_legacy_payment; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_payment AS
 SELECT client_session.trainer_id AS "trainerId",
    client_session.id,
        CASE
            WHEN payment.is_subscription THEN 'plan'::text
            WHEN payment.is_credit_pack THEN 'sessionPack'::text
            ELSE 'payg'::text
        END AS "paymentType",
    (
        CASE
            WHEN payment.is_subscription THEN client_session.price
            WHEN payment.is_credit_pack THEN client_session.price
            ELSE COALESCE(payment.amount, client_session.price)
        END)::double precision AS "contributionAmount",
    (
        CASE
            WHEN (payment.refunded_time IS NOT NULL) THEN (0)::numeric
            WHEN payment.is_subscription THEN (0)::numeric
            WHEN payment.is_credit_pack THEN (0)::numeric
            WHEN (NOT ((stripe_charge.object -> 'paid'::text))::boolean) THEN (0)::numeric
            ELSE COALESCE(payment.amount, (0)::numeric)
        END)::double precision AS "paidAmount",
        CASE
            WHEN payment.is_subscription THEN NULL::text
            WHEN (payment_credit_pack.id IS NOT NULL) THEN NULL::text
            WHEN payment.is_stripe THEN 'card'::text
            WHEN (payment_manual.method OPERATOR(public.=) 'card'::public.citext) THEN 'card'::text
            WHEN (payment_manual.method OPERATOR(public.=) 'cash'::public.citext) THEN 'cash'::text
            WHEN (sale.payment_request_time IS NOT NULL) THEN 'card'::text
            ELSE 'cash'::text
        END AS "paymentMethod",
    COALESCE(payment_manual.transaction_time, to_timestamp((((stripe_charge.object -> 'created'::text))::integer)::double precision), payment_manual.created_at) AS "paidDate",
        CASE
            WHEN (payment.refunded_time IS NOT NULL) THEN 'refunded'::text
            WHEN payment.is_credit_pack THEN 'pending'::text
            WHEN payment.is_subscription THEN 'pending'::text
            WHEN (NOT ((stripe_charge.object -> 'paid'::text))::boolean) THEN 'rejected'::text
            WHEN (payment.id IS NOT NULL) THEN 'paid'::text
            WHEN (sale.payment_request_time IS NOT NULL) THEN 'requested'::text
            WHEN (client_session.price = (0)::numeric) THEN 'paid'::text
            ELSE 'pending'::text
        END AS status,
    payment_stripe.stripe_charge_id AS "stripeCharge",
    NULL::text AS "stripeRefund",
    client_session.id AS "clientSessionId",
        CASE
            WHEN payment.is_credit_pack THEN payment_credit_pack.sale_credit_pack_id
            ELSE NULL::uuid
        END AS "sessionPackId",
    payment_subscription.subscription_id AS "planId",
    client_session.created_at AS "createdAt",
    client_session.updated_at AS "updatedAt"
   FROM (((((((public.client_session
     LEFT JOIN public.sale ON ((sale.id = client_session.sale_id)))
     LEFT JOIN public.payment ON ((payment.sale_id = sale.id)))
     LEFT JOIN public.payment_manual ON ((payment_manual.id = payment.id)))
     LEFT JOIN public.payment_stripe ON ((payment.id = payment_stripe.id)))
     LEFT JOIN public.payment_credit_pack ON ((payment.id = payment_credit_pack.id)))
     LEFT JOIN public.stripe_charge ON ((stripe_charge.id = payment_stripe.stripe_charge_id)))
     LEFT JOIN public.payment_subscription ON ((payment.id = payment_subscription.id)));


--
-- Name: vw_legacy_client_session; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_client_session AS
 SELECT client_session.id,
    client_session.client_id AS "clientId",
    client_session.session_id AS "sessionId",
    (client_session.price)::double precision AS price,
        CASE
            WHEN (client_session.state = 'maybe'::text) THEN NULL::boolean
            ELSE ((client_session.state = 'confirmed'::text) OR (client_session.state = 'accepted'::text))
        END AS attended,
    to_json(p.*) AS payment,
        CASE
            WHEN (client_session.note IS NULL) THEN '[]'::json
            ELSE ( SELECT json_build_array(row_to_json(n_.*)) AS json_build_array
               FROM ( SELECT client_session.id,
                        client_session.note AS content,
                        'notes'::text AS classification,
                        NULL::text AS "clientId",
                        NULL::text AS "financeItemId",
                        NULL::text AS "sessionSeriesId",
                        NULL::text AS "sessionId",
                        client_session.id AS "clientSessionId") n_)
        END AS notes,
    client_session.sale_id AS "saleId",
    client_session.created_at AS "createdAt",
    client_session.state,
    client_session.cancel_time AS "cancelTime",
    client_session.cancel_reason AS "cancelReason",
    client_session.accept_time AS "acceptTime",
    client_session.decline_time AS "declineTime",
    client_session.invite_time AS "inviteTime",
    client_session.confirm_time AS "confirmTime",
    client_session.booking_question AS "bookingQuestion",
    client_session.booking_question_response AS "bookingQuestionResponse"
   FROM (public.client_session
     LEFT JOIN public.vw_legacy_payment p ON ((p.id = client_session.id)));


--
-- Name: vw_legacy_finance_item; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_finance_item AS
 SELECT (finance_item.id)::text AS id,
    finance_item.name,
    (finance_item.amount)::double precision AS amount,
    NULL::text AS status,
    NULL::text AS "paymentType",
    NULL::text AS "stripeApplicationFeeId",
    finance_item.start_date AS "startDate",
    finance_item.trainer_id AS "trainerId",
    finance_item.created_at AS "createdAt",
    finance_item.updated_at AS "updatedAt",
    finance_item.image_url AS "imageUrl"
   FROM public.finance_item
UNION ALL
 SELECT ('ch_'::text || payment_stripe.id) AS id,
    'Card processing fee'::text AS name,
    (- payment_stripe.fee) AS amount,
        CASE
            WHEN (payment.refunded_time IS NOT NULL) THEN 'refunded'::text
            ELSE 'paid'::text
        END AS status,
    NULL::text AS "paymentType",
    NULL::text AS "stripeApplicationFeeId",
    COALESCE(to_timestamp((((stripe_charge.object -> 'created'::text))::integer)::double precision), to_timestamp((((stripe_payment_intent.object -> 'created'::text))::integer)::double precision), payment_stripe.created_at) AS "startDate",
    payment.trainer_id AS "trainerId",
    COALESCE(to_timestamp((((stripe_charge.object -> 'created'::text))::integer)::double precision), to_timestamp((((stripe_payment_intent.object -> 'created'::text))::integer)::double precision), payment_stripe.created_at) AS "createdAt",
    COALESCE(to_timestamp((((stripe_charge.object -> 'created'::text))::integer)::double precision), to_timestamp((((stripe_payment_intent.object -> 'created'::text))::integer)::double precision), payment_stripe.created_at) AS "updatedAt",
    NULL::text AS "imageUrl"
   FROM (((public.payment_stripe
     JOIN public.payment ON ((payment.id = payment_stripe.id)))
     LEFT JOIN public.stripe_charge ON ((payment_stripe.stripe_charge_id = stripe_charge.id)))
     LEFT JOIN public.stripe_payment_intent ON ((payment_stripe.stripe_payment_intent_id = stripe_payment_intent.id)))
  WHERE (((stripe_charge.object -> 'paid'::text))::boolean OR ((stripe_payment_intent.object ->> 'status'::text) = 'succeeded'::text))
UNION ALL
 SELECT ('ch_'::text || payment_plan_payment.id) AS id,
    'Card processing fee'::text AS name,
    (- payment_plan_payment.fee) AS amount,
    payment_plan_payment.status,
    NULL::text AS "paymentType",
    NULL::text AS "stripeApplicationFeeId",
    payment_plan_charge.created_at AS "startDate",
    payment_plan.trainer_id AS "trainerId",
    payment_plan_charge.created_at AS "createdAt",
    payment_plan_charge.created_at AS "updatedAt",
    NULL::text AS "imageUrl"
   FROM (((public.payment_plan_payment
     JOIN public.payment_plan ON ((payment_plan_payment.payment_plan_id = payment_plan.id)))
     JOIN ( SELECT payment_plan_charge_1.payment_plan_payment_id,
            max(payment_plan_charge_1.created_at) AS created_at
           FROM public.payment_plan_charge payment_plan_charge_1
          GROUP BY payment_plan_charge_1.payment_plan_payment_id) payment_plan_charge ON ((payment_plan_payment.id = payment_plan_charge.payment_plan_payment_id)))
     JOIN ( VALUES ('paid'::text), ('refunded'::text)) vals(v) ON (((payment_plan_payment.status)::text = vals.v)))
  WHERE (payment_plan_payment.fee IS NOT NULL);


--
-- Name: vw_legacy_plan_payment; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_plan_payment AS
 SELECT payment_plan_payment.id,
    payment_plan_payment.date,
    (payment_plan_payment.amount)::double precision AS amount,
    (payment_plan_payment.amount_outstanding)::double precision AS "outstandingAmount",
    payment_plan_payment.status,
    payment_plan_payment.payment_plan_id AS "planId",
    currency.alpha_code AS currency
   FROM (((public.payment_plan_payment
     JOIN public.trainer ON ((trainer.id = payment_plan_payment.trainer_id)))
     JOIN public.supported_country_currency ON ((supported_country_currency.country_id = trainer.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)));


--
-- Name: vw_legacy_session; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_session AS
 SELECT session.id,
    session.timezone,
    to_char(timezone((session.timezone)::text, session.start), 'YYYY-MM-DD HH24:MI:SS'::text) AS date,
    (date_part('epoch'::text, session.duration) / (3600)::double precision) AS length,
    session.session_series_id AS "sessionSeriesId",
    ( SELECT COALESCE(json_agg(cs.*), '[]'::json) AS "coalesce"
           FROM ( SELECT vw_legacy_client_session.id,
                    vw_legacy_client_session."clientId",
                    vw_legacy_client_session."sessionId",
                    vw_legacy_client_session.price,
                    vw_legacy_client_session.attended,
                    vw_legacy_client_session.payment,
                    vw_legacy_client_session.notes,
                    vw_legacy_client_session."saleId",
                    vw_legacy_client_session."createdAt",
                    vw_legacy_client_session.state,
                    vw_legacy_client_session."cancelTime",
                    vw_legacy_client_session."cancelReason",
                    vw_legacy_client_session."acceptTime",
                    vw_legacy_client_session."declineTime",
                    vw_legacy_client_session."inviteTime",
                    vw_legacy_client_session."confirmTime",
                    vals.v
                   FROM (public.vw_legacy_client_session
                     JOIN ( VALUES ('confirmed'::text), ('accepted'::text), ('cancelled'::text), ('maybe'::text)) vals(v) ON ((vals.v = vw_legacy_client_session.state)))
                  WHERE (vw_legacy_client_session."sessionId" = session.id)
                  ORDER BY vw_legacy_client_session."createdAt" DESC) cs) AS "clientSessions",
        CASE
            WHEN (session.note IS NULL) THEN '[]'::json
            ELSE ( SELECT json_build_array(row_to_json(n_.*)) AS json_build_array
               FROM ( SELECT session.id,
                        session.note AS content,
                        'notes'::text AS classification,
                        NULL::text AS "clientId",
                        NULL::text AS "financeItemId",
                        NULL::text AS "sessionSeriesId",
                        session.id AS "sessionId",
                        NULL::text AS "clientSessionId") n_)
        END AS notes,
    session.service_id AS "serviceId",
    session.booked_online AS "bookedOnline",
    session.maximum_attendance AS "maximumAttendance",
    ( SELECT COALESCE(json_agg(i.*), '[]'::json) AS "coalesce"
           FROM ( SELECT client_session.id,
                    client_session.client_id AS "clientId",
                    client_session.session_id AS "sessionId",
                        CASE client_session.state
                            WHEN 'invited'::text THEN 'sent'::text
                            ELSE client_session.state
                        END AS status,
                    client_session.invite_time AS "sentAt",
                        CASE client_session.state
                            WHEN 'invited'::text THEN NULL::timestamp with time zone
                            ELSE client_session.decline_time
                        END AS "actionedAt"
                   FROM (public.client_session
                     JOIN ( VALUES ('declined'::text), ('invited'::text)) vals(v) ON ((vals.v = client_session.state)))
                  WHERE (client_session.session_id = session.id)) i) AS invitations,
    session.location,
    session.address,
    session.google_place_id AS "googlePlaceId",
        CASE
            WHEN (session.geo IS NOT NULL) THEN json_build_object('lat', session.geo[0], 'lng', session.geo[1])
            ELSE NULL::json
        END AS geo,
    session.booking_payment_type AS "bookingPaymentType",
        CASE
            WHEN (session.service_provider_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.service_provider_reminder_1_type, 'timeBeforeStart', (session.service_provider_reminder_1)::text)
        END AS "serviceProviderReminder1",
        CASE
            WHEN (session.service_provider_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.service_provider_reminder_2_type, 'timeBeforeStart', (session.service_provider_reminder_2)::text)
        END AS "serviceProviderReminder2",
        CASE
            WHEN (session.client_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.client_reminder_1_type, 'timeBeforeStart', (session.client_reminder_1)::text)
        END AS "clientReminder1",
        CASE
            WHEN (session.client_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.client_reminder_2_type, 'timeBeforeStart', (session.client_reminder_2)::text)
        END AS "clientReminder2",
    session.buffer_minutes_before AS "bufferMinutesBefore",
    session.buffer_minutes_after AS "bufferMinutesAfter",
    session.bookable_online AS "bookableOnline",
    session.description,
    session.can_clients_cancel AS "canClientsCancel"
   FROM public.session;


--
-- Name: vw_legacy_session_2; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_session_2 AS
 SELECT session.id,
    session.timezone,
    to_char(timezone((session.timezone)::text, session.start), 'YYYY-MM-DD HH24:MI:SS'::text) AS date,
    (date_part('epoch'::text, session.duration) / (3600)::double precision) AS length,
    session.session_series_id AS "sessionSeriesId",
    ( SELECT COALESCE(json_agg(cs.*), '[]'::json) AS "coalesce"
           FROM ( SELECT vw_legacy_client_session.id,
                    vw_legacy_client_session."clientId",
                    vw_legacy_client_session."sessionId",
                    vw_legacy_client_session.price,
                    vw_legacy_client_session.attended,
                    vw_legacy_client_session.payment,
                    vw_legacy_client_session.notes,
                    vw_legacy_client_session."saleId",
                    vw_legacy_client_session."createdAt",
                    vw_legacy_client_session.state,
                    vw_legacy_client_session."cancelTime",
                    vw_legacy_client_session."cancelReason",
                    vw_legacy_client_session."acceptTime",
                    vw_legacy_client_session."declineTime",
                    vw_legacy_client_session."inviteTime",
                    vw_legacy_client_session."confirmTime",
                    vw_legacy_client_session."bookingQuestion",
                    vw_legacy_client_session."bookingQuestionResponse"
                   FROM public.vw_legacy_client_session
                  WHERE (vw_legacy_client_session."sessionId" = session.id)
                  ORDER BY vw_legacy_client_session."createdAt" DESC) cs) AS "clientSessions",
        CASE
            WHEN (session.note IS NULL) THEN '[]'::json
            ELSE ( SELECT json_build_array(row_to_json(n_.*)) AS json_build_array
               FROM ( SELECT session.id,
                        session.note AS content,
                        'notes'::text AS classification,
                        NULL::text AS "clientId",
                        NULL::text AS "financeItemId",
                        NULL::text AS "sessionSeriesId",
                        session.id AS "sessionId",
                        NULL::text AS "clientSessionId") n_)
        END AS notes,
    session.service_id AS "serviceId",
    session.booked_online AS "bookedOnline",
    session.maximum_attendance AS "maximumAttendance",
    ( SELECT COALESCE(json_agg(i.*), '[]'::json) AS "coalesce"
           FROM ( SELECT client_session.id,
                    client_session.client_id AS "clientId",
                    client_session.session_id AS "sessionId",
                        CASE client_session.state
                            WHEN 'invited'::text THEN 'sent'::text
                            ELSE client_session.state
                        END AS status,
                    client_session.invite_time AS "sentAt",
                        CASE client_session.state
                            WHEN 'invited'::text THEN NULL::timestamp with time zone
                            ELSE client_session.decline_time
                        END AS "actionedAt"
                   FROM (public.client_session
                     JOIN ( VALUES ('declined'::text), ('invited'::text)) vals(v) ON ((vals.v = client_session.state)))
                  WHERE (client_session.session_id = session.id)) i) AS invitations,
    session.location,
    session.address,
    session.google_place_id AS "googlePlaceId",
        CASE
            WHEN (session.geo IS NOT NULL) THEN json_build_object('lat', session.geo[0], 'lng', session.geo[1])
            ELSE NULL::json
        END AS geo,
    session.booking_payment_type AS "bookingPaymentType",
        CASE
            WHEN (session.service_provider_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.service_provider_reminder_1_type, 'timeBeforeStart', (session.service_provider_reminder_1)::text)
        END AS "serviceProviderReminder1",
        CASE
            WHEN (session.service_provider_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.service_provider_reminder_2_type, 'timeBeforeStart', (session.service_provider_reminder_2)::text)
        END AS "serviceProviderReminder2",
        CASE
            WHEN (session.client_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.client_reminder_1_type, 'timeBeforeStart', (session.client_reminder_1)::text)
        END AS "clientReminder1",
        CASE
            WHEN (session.client_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', session.client_reminder_2_type, 'timeBeforeStart', (session.client_reminder_2)::text)
        END AS "clientReminder2",
    session.buffer_minutes_before AS "bufferMinutesBefore",
    session.buffer_minutes_after AS "bufferMinutesAfter",
    session.bookable_online AS "bookableOnline",
    session.description,
    session.can_clients_cancel AS "canClientsCancel",
    (session.cancellation_advance_notice_duration)::text AS "cancellationAdvanceNoticeDuration",
    session.request_client_address_online AS "requestClientAddressOnline",
    session.booking_question AS "bookingQuestion",
    session.booking_question_state AS "bookingQuestionState",
    session.start AS "startTime",
    session_series.name,
        CASE session_series.event_type
            WHEN 'event'::public.citext THEN 'event'::text
            WHEN 'single_session'::public.citext THEN 'single'::text
            WHEN 'group_session'::public.citext THEN 'group'::text
            ELSE NULL::text
        END AS type,
    to_char(session_series.price, 'FMMI9999990.00'::text) AS price,
    currency.alpha_code AS currency
   FROM ((((public.session
     JOIN public.session_series ON ((session_series.id = session.session_series_id)))
     JOIN public.trainer ON ((trainer.id = session.trainer_id)))
     JOIN public.supported_country_currency ON ((supported_country_currency.country_id = trainer.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)));


--
-- Name: vw_legacy_session_series; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_session_series AS
 SELECT session_series.created_at AS "createdAt",
    session_series.id,
        CASE session_series.event_type
            WHEN 'event'::public.citext THEN 'event'::text
            WHEN 'single_session'::public.citext THEN 'single'::text
            WHEN 'group_session'::public.citext THEN 'group'::text
            ELSE NULL::text
        END AS "sessionType",
    session_series.name AS "sessionName",
    session_series.color AS "sessionColor",
    session_series.session_icon_id AS "avatarName",
    session_series.icon_url AS "imageURL",
    round(((((100)::double precision * date_part('epoch'::text, session_series.duration)) / (3600)::double precision) / (100)::double precision)) AS "sessionLength",
    session_series.timezone,
    to_char(timezone((session_series.timezone)::text, session_series.start), 'YYYY-MM-DD HH24:MI:SS'::text) AS "startDate",
    to_char(
        CASE
            WHEN (session_series.end_ IS NULL) THEN date_trunc('second'::text, (timezone((session_series.timezone)::text, session_series.start) + session_series.duration))
            ELSE timezone((session_series.timezone)::text, session_series.end_)
        END, 'YYYY-MM-DD HH24:MI:SS'::text) AS "endDate",
    date_part('day'::text, session_series.daily_recurrence_interval) AS "repeatsEvery",
    COALESCE((date_part('epoch'::text, ( SELECT session.service_provider_reminder_1
           FROM public.session
          WHERE (session.session_series_id = session_series.id)
          ORDER BY session.start DESC
         LIMIT 1)) / (3600)::double precision), ('-1'::integer)::double precision) AS "reminderHours",
    session_series.location,
    (session_series.price)::double precision AS price,
    session_series.trainer_id AS "trainerId",
    COALESCE(( SELECT json_agg(vw_legacy_session.*) AS json_agg
           FROM public.vw_legacy_session
          WHERE (vw_legacy_session."sessionSeriesId" = session_series.id)), '[]'::json) AS sessions,
    currency.alpha_code AS currency
   FROM (((public.session_series
     JOIN public.trainer ON ((trainer.id = session_series.trainer_id)))
     JOIN public.supported_country_currency ON ((supported_country_currency.country_id = trainer.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)));


--
-- Name: vw_legacy_session_series_2; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_session_series_2 AS
 SELECT session_series.created_at AS "createdAt",
    session_series.id,
        CASE session_series.event_type
            WHEN 'event'::public.citext THEN 'event'::text
            WHEN 'single_session'::public.citext THEN 'single'::text
            WHEN 'group_session'::public.citext THEN 'group'::text
            ELSE NULL::text
        END AS "sessionType",
    session_series.name AS "sessionName",
    session_series.color AS "sessionColor",
    session_series.session_icon_id AS "avatarName",
    session_series.icon_url AS "imageURL",
    round(((((100)::double precision * date_part('epoch'::text, session_series.duration)) / (3600)::double precision) / (100)::double precision)) AS "sessionLength",
    session_series.timezone,
    to_char(timezone((session_series.timezone)::text, session_series.start), 'YYYY-MM-DD HH24:MI:SS'::text) AS "startDate",
    to_char(
        CASE
            WHEN (session_series.end_ IS NULL) THEN date_trunc('second'::text, (timezone((session_series.timezone)::text, session_series.start) + session_series.duration))
            ELSE timezone((session_series.timezone)::text, session_series.end_)
        END, 'YYYY-MM-DD HH24:MI:SS'::text) AS "endDate",
    date_part('day'::text, session_series.daily_recurrence_interval) AS "repeatsEvery",
    COALESCE((date_part('epoch'::text, ( SELECT session.service_provider_reminder_1
           FROM public.session
          WHERE (session.session_series_id = session_series.id)
          ORDER BY session.start DESC
         LIMIT 1)) / (3600)::double precision), ('-1'::integer)::double precision) AS "reminderHours",
    session_series.location,
    (session_series.price)::double precision AS price,
    session_series.trainer_id AS "trainerId",
    COALESCE(( SELECT json_agg(vw_legacy_session_2.*) AS json_agg
           FROM public.vw_legacy_session_2
          WHERE (vw_legacy_session_2."sessionSeriesId" = session_series.id)), '[]'::json) AS sessions,
    currency.alpha_code AS currency
   FROM (((public.session_series
     JOIN public.trainer ON ((trainer.id = session_series.trainer_id)))
     JOIN public.supported_country_currency ON ((supported_country_currency.country_id = trainer.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)));


--
-- Name: account; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.account (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT account_object_check CHECK (((object ->> 'object'::text) = 'account'::text))
);


--
-- Name: vw_legacy_trainer; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_legacy_trainer AS
 SELECT trainer.created_at,
    trainer.id,
    trainer.email,
    trainer.first_name,
    trainer.last_name,
    trainer.phone_number AS phone,
    upper(COALESCE((trainer.last_ios_id_for_vendor)::text, 'IOS-SIMULATOR'::text)) AS device_id,
        CASE
            WHEN (trainer.stripe_account_id IS NULL) THEN 'pending'::text
            WHEN (account.object IS NULL) THEN 'pending'::text
            WHEN (account.api_version = '2015-07-28'::date) THEN COALESCE((account.object #>> '{legal_entity,verification,status}'::text[]), 'pending'::text)
            WHEN (((account.object -> 'payouts_enabled'::text) = 'true'::jsonb) AND ((account.object -> 'charges_enabled'::text) = 'true'::jsonb)) THEN 'verified'::text
            ELSE 'unverified'::text
        END AS stripe_account_status,
    trainer.user_id AS member_id,
    vw_first_card_payments.first_card_payment_processed,
    trainer.timezone,
    reverse(regexp_replace(reverse((trainer.locale)::text), '-'::text, '_'::text)) AS locale,
    country.alpha_2_code AS country,
    lower((currency.alpha_code)::text) AS default_currency,
    account_subscription_status.subscription,
    trainer.terms_accepted,
    trainer.business_name,
        CASE
            WHEN (trainer.default_service_provider_appointment_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', trainer.default_service_provider_appointment_reminder_1_type, 'timeBeforeStart', (trainer.default_service_provider_appointment_reminder_1)::text)
        END AS default_service_provider_appointment_reminder_1,
        CASE
            WHEN (trainer.default_service_provider_appointment_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', trainer.default_service_provider_appointment_reminder_2_type, 'timeBeforeStart', (trainer.default_service_provider_appointment_reminder_2)::text)
        END AS default_service_provider_appointment_reminder_2,
        CASE
            WHEN (trainer.default_client_appointment_reminder_1 IS NULL) THEN NULL::json
            ELSE json_build_object('type', trainer.default_client_appointment_reminder_1_type, 'timeBeforeStart', (trainer.default_client_appointment_reminder_1)::text)
        END AS default_client_appointment_reminder_1,
        CASE
            WHEN (trainer.default_client_appointment_reminder_2 IS NULL) THEN NULL::json
            ELSE json_build_object('type', trainer.default_client_appointment_reminder_2_type, 'timeBeforeStart', (trainer.default_client_appointment_reminder_2)::text)
        END AS default_client_appointment_reminder_2,
    (sms_balance.credit_balance)::integer AS sms_credit_balance,
    account_subscription_status.sms_credit_top_up_at,
    account_subscription_status.sms_credit_top_up_count
   FROM (((((((public.trainer
     JOIN public.country ON ((country.id = trainer.country_id)))
     LEFT JOIN public.supported_country_currency ON ((country.id = supported_country_currency.country_id)))
     JOIN public.currency ON ((currency.id = supported_country_currency.currency_id)))
     JOIN public.sms_balance ON ((sms_balance.trainer_id = trainer.id)))
     LEFT JOIN stripe.account ON ((account.id = trainer.stripe_account_id)))
     LEFT JOIN public.vw_first_card_payments ON ((vw_first_card_payments.trainer_id = trainer.id)))
     JOIN public.account_subscription_status ON ((trainer.id = account_subscription_status.trainer_id)));


--
-- Name: vw_valid_access_token; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_valid_access_token AS
 SELECT access_token.id AS access_token,
    user_.id AS member_id,
    trainer.id AS trainer_id
   FROM ((public.access_token
     JOIN public.user_ ON ((user_.id = access_token.user_id)))
     JOIN public.trainer ON ((trainer.user_id = user_.id)))
  WHERE (access_token.expires_at >= now());


--
-- Name: balance_transactions; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.balance_transactions (
    id text NOT NULL,
    transaction_time timestamp with time zone NOT NULL,
    amount numeric NOT NULL,
    currency public.citext NOT NULL
);


--
-- Name: metrics; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.metrics (
    date date NOT NULL,
    impression_count integer DEFAULT 0,
    unique_impression_count integer DEFAULT 0,
    install_count integer DEFAULT 0,
    page_view_count integer DEFAULT 0,
    unique_page_view_count integer DEFAULT 0,
    apple_sales numeric DEFAULT 0,
    new_account_count integer DEFAULT 0,
    discounted_new_sub_count integer DEFAULT 0,
    discounted_new_mmr_amount numeric DEFAULT 0,
    discounted_churned_sub_count integer DEFAULT 0,
    discounted_churned_mmr_amount numeric DEFAULT 0,
    discounted_reactivated_sub_count integer DEFAULT 0,
    discounted_reactivated_mmr_amount numeric DEFAULT 0,
    standard_new_sub_count integer DEFAULT 0,
    standard_new_mmr_amount numeric DEFAULT 0,
    standard_churned_sub_count integer DEFAULT 0,
    standard_churned_mmr_amount numeric DEFAULT 0,
    standard_reactivated_sub_count integer DEFAULT 0,
    standard_reactivated_mmr_amount numeric DEFAULT 0,
    discounted_churn_estimate double precision,
    discounted_arpa double precision,
    standard_churn_estimate double precision,
    standard_arpa double precision
);


--
-- Name: mrr; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.mrr (
    date timestamp with time zone,
    new_amount numeric,
    churn_amount numeric,
    reactivate_amount numeric,
    months_paid integer
);


--
-- Name: bank_account; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.bank_account (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT bank_account_object_check CHECK (((object ->> 'object'::text) = 'bank_account'::text))
);


--
-- Name: checkout_session; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.checkout_session (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT checkout_session_object_check CHECK (((object ->> 'object'::text) = 'checkout.session'::text))
);


--
-- Name: event; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.event (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    object jsonb NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: invoice; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.invoice (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT invoice_object_check CHECK (((object ->> 'object'::text) = 'invoice'::text))
);


--
-- Name: payout; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.payout (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id text NOT NULL,
    api_version date NOT NULL,
    account text NOT NULL,
    object jsonb NOT NULL,
    CONSTRAINT payout_object_check CHECK (((object ->> 'object'::text) = 'payout'::text))
);


--
-- Name: logged_actions event_id; Type: DEFAULT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.logged_actions ALTER COLUMN event_id SET DEFAULT nextval('audit.logged_actions_event_id_seq'::regclass);


--
-- Name: logged_actions logged_actions_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.logged_actions
    ADD CONSTRAINT logged_actions_pkey PRIMARY KEY (event_id);


--
-- Name: event event_pkey; Type: CONSTRAINT; Schema: mandrill; Owner: -
--

ALTER TABLE ONLY mandrill.event
    ADD CONSTRAINT event_pkey PRIMARY KEY (ts, _id, event);


--
-- Name: access_token access_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_token
    ADD CONSTRAINT access_token_pkey PRIMARY KEY (id, type);


--
-- Name: access_token_type access_token_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_token_type
    ADD CONSTRAINT access_token_type_pkey PRIMARY KEY (type);


--
-- Name: analytics_data analytics_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_data
    ADD CONSTRAINT analytics_data_pkey PRIMARY KEY (id);


--
-- Name: app_notification app_notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_pkey PRIMARY KEY (id);


--
-- Name: app_store_pending_renewal_info app_store_pending_renewal_info_trainer_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_pending_renewal_info
    ADD CONSTRAINT app_store_pending_renewal_info_trainer_id_product_id_key UNIQUE (trainer_id, product_id);


--
-- Name: app_store_server_notification app_store_server_notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_server_notification
    ADD CONSTRAINT app_store_server_notification_pkey PRIMARY KEY (id);


--
-- Name: app_store_transaction app_store_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_transaction
    ADD CONSTRAINT app_store_transaction_pkey PRIMARY KEY (transaction_id);


--
-- Name: app_store_transaction app_store_transaction_transaction_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_transaction
    ADD CONSTRAINT app_store_transaction_transaction_id_trainer_id_key UNIQUE (transaction_id, trainer_id);


--
-- Name: apple_search_ads_attribution apple_search_ads_attribution_anonymous_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apple_search_ads_attribution
    ADD CONSTRAINT apple_search_ads_attribution_anonymous_id_key UNIQUE (anonymous_id);


--
-- Name: apple_search_ads_attribution apple_search_ads_attribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apple_search_ads_attribution
    ADD CONSTRAINT apple_search_ads_attribution_pkey PRIMARY KEY (id);


--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (trainer_id, date);


--
-- Name: booking_payment_type booking_payment_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_payment_type
    ADD CONSTRAINT booking_payment_type_pkey PRIMARY KEY (type);


--
-- Name: booking_question_state booking_question_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_question_state
    ADD CONSTRAINT booking_question_state_pkey PRIMARY KEY (state);


--
-- Name: brand_color brand_color_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_color
    ADD CONSTRAINT brand_color_pkey PRIMARY KEY (id);


--
-- Name: busy_time busy_time_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.busy_time
    ADD CONSTRAINT busy_time_pkey PRIMARY KEY (id);


--
-- Name: client_appointment_reminder_type client_appointment_reminder_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_appointment_reminder_type
    ADD CONSTRAINT client_appointment_reminder_type_pkey PRIMARY KEY (type);


--
-- Name: email_appointment_reminder client_email_appointment_reminder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_pkey PRIMARY KEY (id);


--
-- Name: client_login_request client_login_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_login_request
    ADD CONSTRAINT client_login_request_pkey PRIMARY KEY (id);


--
-- Name: client_note client_note_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note
    ADD CONSTRAINT client_note_pkey PRIMARY KEY (id);


--
-- Name: client_payment_reminder client_payment_reminder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_payment_reminder
    ADD CONSTRAINT client_payment_reminder_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: client client_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: client_session client_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: client_session client_session_sale_id_key1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_sale_id_key1 UNIQUE (sale_id);


--
-- Name: client_session client_session_session_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_session_id_client_id_key UNIQUE (session_id, client_id);


--
-- Name: client_session_state client_session_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session_state
    ADD CONSTRAINT client_session_state_pkey PRIMARY KEY (state);


--
-- Name: client_status client_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_status
    ADD CONSTRAINT client_status_pkey PRIMARY KEY (status);


--
-- Name: client client_user_id_user_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_user_id_user_type_key UNIQUE (user_id, user_type);


--
-- Name: country country_alpha_2_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_alpha_2_code_key UNIQUE (alpha_2_code);


--
-- Name: country country_alpha_3_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_alpha_3_code_key UNIQUE (alpha_3_code);


--
-- Name: country country_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_pkey1 PRIMARY KEY (id);


--
-- Name: credit_pack credit_pack_id_trainer_id_is_credit_pack_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_pack
    ADD CONSTRAINT credit_pack_id_trainer_id_is_credit_pack_key UNIQUE (id, trainer_id, is_credit_pack);


--
-- Name: credit_pack credit_pack_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_pack
    ADD CONSTRAINT credit_pack_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: currency currency_alpha_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT currency_alpha_code_key UNIQUE (alpha_code);


--
-- Name: currency currency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT currency_pkey PRIMARY KEY (id);


--
-- Name: event_type event_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_type
    ADD CONSTRAINT event_type_pkey PRIMARY KEY (type);


--
-- Name: finance_item finance_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_item
    ADD CONSTRAINT finance_item_pkey PRIMARY KEY (id);


--
-- Name: installation installation_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_pkey1 PRIMARY KEY (id);


--
-- Name: installation installation_user_id_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_user_id_device_token_key UNIQUE (user_id, device_token);


--
-- Name: mail_bounce mail_bounce_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_bounce
    ADD CONSTRAINT mail_bounce_pkey PRIMARY KEY (id);


--
-- Name: mail_bounce_type mail_bounce_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_bounce_type
    ADD CONSTRAINT mail_bounce_type_pkey PRIMARY KEY (type);


--
-- Name: mail_click mail_click_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_click
    ADD CONSTRAINT mail_click_pkey PRIMARY KEY (id);


--
-- Name: mail mail_mail_id_client_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_mail_id_client_id_trainer_id_key UNIQUE (id, client_id, trainer_id);


--
-- Name: mail mail_mail_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_mail_id_trainer_id_key UNIQUE (id, trainer_id);


--
-- Name: mail mail_mandrill_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_mandrill_message_id_key UNIQUE (mandrill_message_id);


--
-- Name: mail_open mail_open_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_open
    ADD CONSTRAINT mail_open_pkey PRIMARY KEY (id);


--
-- Name: mail mail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_pkey PRIMARY KEY (id);


--
-- Name: mission mission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_pkey PRIMARY KEY (trainer_id, id);


--
-- Name: mission_type mission_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission_type
    ADD CONSTRAINT mission_type_pkey PRIMARY KEY (id);


--
-- Name: sale_credit_pack ordered_credit_pack_id_trainer_id_is_credit_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_credit_pack
    ADD CONSTRAINT ordered_credit_pack_id_trainer_id_is_credit_key UNIQUE (id, trainer_id, is_credit_pack);


--
-- Name: sale_credit_pack ordered_credit_pack_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_credit_pack
    ADD CONSTRAINT ordered_credit_pack_id_trainer_id_key UNIQUE (id, trainer_id);


--
-- Name: sale_credit_pack ordered_credit_pack_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_credit_pack
    ADD CONSTRAINT ordered_credit_pack_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: sale_item ordered_good_id_trainer_id_is_good_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_item
    ADD CONSTRAINT ordered_good_id_trainer_id_is_good_key UNIQUE (id, trainer_id, is_item);


--
-- Name: sale_item ordered_good_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_item
    ADD CONSTRAINT ordered_good_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: sale_product ordered_product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: sale_service ordered_service_id_trainer_id_is_service_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_service
    ADD CONSTRAINT ordered_service_id_trainer_id_is_service_key UNIQUE (id, trainer_id, is_service);


--
-- Name: sale_service ordered_service_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_service
    ADD CONSTRAINT ordered_service_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_credit_pack payment_credit_pack_id_trainer_id_is_credit_pack_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_credit_pack
    ADD CONSTRAINT payment_credit_pack_id_trainer_id_is_credit_pack_key UNIQUE (id, trainer_id, is_credit_pack);


--
-- Name: payment_credit_pack payment_credit_pack_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_credit_pack
    ADD CONSTRAINT payment_credit_pack_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_manual payment_manual_id_trainer_id_is_manual_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_manual
    ADD CONSTRAINT payment_manual_id_trainer_id_is_manual_key UNIQUE (id, trainer_id, is_manual);


--
-- Name: payment_manual payment_manual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_manual
    ADD CONSTRAINT payment_manual_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_method payment_method_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_method
    ADD CONSTRAINT payment_method_pkey PRIMARY KEY (method);


--
-- Name: payment payment_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_pkey1 PRIMARY KEY (id, trainer_id);


--
-- Name: payment_plan_acceptance payment_plan_acceptance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_acceptance
    ADD CONSTRAINT payment_plan_acceptance_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_plan_charge payment_plan_charge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_charge
    ADD CONSTRAINT payment_plan_charge_pkey PRIMARY KEY (id);


--
-- Name: payment_plan_pause payment_plan_pause_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_pause
    ADD CONSTRAINT payment_plan_pause_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_plan_payment payment_plan_payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_payment
    ADD CONSTRAINT payment_plan_payment_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_plan_payment_status payment_plan_payment_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_payment_status
    ADD CONSTRAINT payment_plan_payment_status_pkey PRIMARY KEY (status);


--
-- Name: payment_plan payment_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan
    ADD CONSTRAINT payment_plan_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_plan_status payment_plan_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_status
    ADD CONSTRAINT payment_plan_status_pkey PRIMARY KEY (status);


--
-- Name: payment payment_sale_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_sale_id_key UNIQUE (sale_id);


--
-- Name: payment_scheduled_stripe_attempt payment_scheduled_stripe_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe_attempt
    ADD CONSTRAINT payment_scheduled_stripe_attempt_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_scheduled_stripe payment_scheduled_stripe_id_trainer_id_is_scheduled_stripe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe
    ADD CONSTRAINT payment_scheduled_stripe_id_trainer_id_is_scheduled_stripe_key UNIQUE (id, trainer_id, is_scheduled_stripe);


--
-- Name: payment_scheduled_stripe payment_scheduled_stripe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe
    ADD CONSTRAINT payment_scheduled_stripe_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_status payment_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_status
    ADD CONSTRAINT payment_status_pkey PRIMARY KEY (status);


--
-- Name: payment_stripe payment_stripe_id_trainer_id_is_stripe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_stripe
    ADD CONSTRAINT payment_stripe_id_trainer_id_is_stripe_key UNIQUE (id, trainer_id, is_stripe);


--
-- Name: payment_stripe payment_stripe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_stripe
    ADD CONSTRAINT payment_stripe_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: payment_subscription payment_subscription_id_trainer_id_is_subscription_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_subscription
    ADD CONSTRAINT payment_subscription_id_trainer_id_is_subscription_key UNIQUE (id, trainer_id, is_subscription);


--
-- Name: payment_subscription payment_subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_subscription
    ADD CONSTRAINT payment_subscription_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: product product_id_trainer_id_is_credit_pack_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_id_trainer_id_is_credit_pack_key UNIQUE (id, trainer_id, is_credit_pack);


--
-- Name: product product_id_trainer_id_is_good_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_id_trainer_id_is_good_key UNIQUE (id, trainer_id, is_item);


--
-- Name: product product_id_trainer_id_is_membership_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_id_trainer_id_is_membership_key UNIQUE (id, trainer_id, is_membership);


--
-- Name: product product_id_trainer_id_is_service_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_id_trainer_id_is_service_key UNIQUE (id, trainer_id, is_service);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: request_client_address_online_type request_client_address_online_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_client_address_online_type
    ADD CONSTRAINT request_client_address_online_type_pkey PRIMARY KEY (type);


--
-- Name: reward reward_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward
    ADD CONSTRAINT reward_id_trainer_id_key UNIQUE (id, trainer_id);


--
-- Name: reward reward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward
    ADD CONSTRAINT reward_pkey PRIMARY KEY (id);


--
-- Name: reward_type reward_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_type
    ADD CONSTRAINT reward_type_pkey PRIMARY KEY (type);


--
-- Name: sale sale_id_client_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT sale_id_client_id_trainer_id_key UNIQUE (id, client_id, trainer_id);


--
-- Name: sale sale_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT sale_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: schema_history schema_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_history
    ADD CONSTRAINT schema_history_pkey PRIMARY KEY (installed_rank);


--
-- Name: schema_history schema_history_script_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_history
    ADD CONSTRAINT schema_history_script_key UNIQUE (script);


--
-- Name: schema_history schema_history_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_history
    ADD CONSTRAINT schema_history_version_key UNIQUE (version);


--
--



--
-- Name: service service_id_trainer_id_is_service_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_id_trainer_id_is_service_key UNIQUE (id, trainer_id, is_service);


--
-- Name: service service_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_pkey1 PRIMARY KEY (id, trainer_id);


--
-- Name: service_provider_appointment_reminder_type service_provider_appointment_reminder_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_provider_appointment_reminder_type
    ADD CONSTRAINT service_provider_appointment_reminder_type_pkey PRIMARY KEY (type);


--
-- Name: session_icon session_icon_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_icon
    ADD CONSTRAINT session_icon_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: session_series session_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_series
    ADD CONSTRAINT session_series_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: sms_credit_checkout_session sms_credit_checkout_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit_checkout_session
    ADD CONSTRAINT sms_credit_checkout_session_pkey PRIMARY KEY (id);


--
-- Name: sms_credit_source sms_credit_source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit_source
    ADD CONSTRAINT sms_credit_source_pkey PRIMARY KEY (source);


--
-- Name: sms sms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms
    ADD CONSTRAINT sms_pkey PRIMARY KEY (id);


--
-- Name: stripe_balance stripe_balance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_balance
    ADD CONSTRAINT stripe_balance_pkey PRIMARY KEY (account_id);


--
-- Name: stripe_charge stripe_charge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_charge
    ADD CONSTRAINT stripe_charge_pkey PRIMARY KEY (id);


--
-- Name: stripe_payment_intent stripe_payment_intent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_payment_intent
    ADD CONSTRAINT stripe_payment_intent_pkey PRIMARY KEY (id);


--
-- Name: stripe_resource stripe_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_resource
    ADD CONSTRAINT stripe_resource_pkey PRIMARY KEY (id);


--
-- Name: subscription_frequency subscription_frequency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_frequency
    ADD CONSTRAINT subscription_frequency_pkey PRIMARY KEY (frequency);


--
-- Name: subscription subscription_id_client_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_id_client_id_trainer_id_key UNIQUE (id, client_id, trainer_id);


--
-- Name: subscription_pause subscription_pause_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_pause
    ADD CONSTRAINT subscription_pause_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: subscription_period subscription_period_id_client_id_trainer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_period
    ADD CONSTRAINT subscription_period_id_client_id_trainer_id_key UNIQUE (id, client_id, trainer_id);


--
-- Name: subscription_period subscription_period_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_period
    ADD CONSTRAINT subscription_period_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: subscription_update subscription_update_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_update
    ADD CONSTRAINT subscription_update_pkey PRIMARY KEY (id, trainer_id);


--
-- Name: supported_country_currency supported_country_currency_country_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supported_country_currency
    ADD CONSTRAINT supported_country_currency_country_id_key UNIQUE (country_id);


--
-- Name: supported_country_currency supported_country_currency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supported_country_currency
    ADD CONSTRAINT supported_country_currency_pkey PRIMARY KEY (country_id, currency_id);


--
-- Name: survey survey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey
    ADD CONSTRAINT survey_pkey PRIMARY KEY (id);


--
-- Name: task_queue task_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_queue
    ADD CONSTRAINT task_queue_pkey PRIMARY KEY (id);


--
-- Name: trainer trainer_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_email_key UNIQUE (email);


--
-- Name: trainer trainer_icalendar_url_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_icalendar_url_slug_key UNIQUE (icalendar_url_slug);


--
-- Name: trainer trainer_online_bookings_page_url_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_online_bookings_page_url_slug_key UNIQUE (online_bookings_page_url_slug);


--
-- Name: trainer trainer_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_pkey1 PRIMARY KEY (id);


--
-- Name: trainer trainer_sign_in_with_apple_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_sign_in_with_apple_user_id_key UNIQUE (sign_in_with_apple_user_id);


--
-- Name: trainer trainer_sms_credit_checkout_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_sms_credit_checkout_id_key UNIQUE (sms_credit_checkout_id);


--
-- Name: trainer trainer_user_id_user_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_user_id_user_type_key UNIQUE (user_id, user_type);


--
-- Name: trial trial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial
    ADD CONSTRAINT trial_pkey PRIMARY KEY (id);


--
-- Name: sale_product unique_sale_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT unique_sale_id UNIQUE (sale_id);


--
-- Name: user_ user__id_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_
    ADD CONSTRAINT user__id_type_key UNIQUE (id, type);


--
-- Name: user_ user__pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_
    ADD CONSTRAINT user__pkey PRIMARY KEY (id);


--
-- Name: user_type user_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_type
    ADD CONSTRAINT user_type_pkey PRIMARY KEY (type);


--
-- Name: balance_transactions balance_transactions_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.balance_transactions
    ADD CONSTRAINT balance_transactions_pkey PRIMARY KEY (id);


--
-- Name: metrics metrics_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (date);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: bank_account bank_account_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.bank_account
    ADD CONSTRAINT bank_account_pkey PRIMARY KEY (id);


--
-- Name: checkout_session checkout_session_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.checkout_session
    ADD CONSTRAINT checkout_session_pkey PRIMARY KEY (id);


--
-- Name: customer customer_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (id);


--
-- Name: invoice invoice_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.invoice
    ADD CONSTRAINT invoice_pkey PRIMARY KEY (id);


--
-- Name: payment_method payment_method_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payment_method
    ADD CONSTRAINT payment_method_pkey PRIMARY KEY (id);


--
-- Name: payout payout_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payout
    ADD CONSTRAINT payout_pkey PRIMARY KEY (id);


--
-- Name: event stripe_event_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.event
    ADD CONSTRAINT stripe_event_pkey PRIMARY KEY (id);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (id);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: twilio; Owner: -
--

ALTER TABLE ONLY twilio.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (sid);


--
-- Name: logged_actions_action_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX logged_actions_action_idx ON audit.logged_actions USING btree (action);


--
-- Name: logged_actions_action_tstamp_tx_stm_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX logged_actions_action_tstamp_tx_stm_idx ON audit.logged_actions USING btree (action_tstamp_stm);


--
-- Name: logged_actions_relid_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX logged_actions_relid_idx ON audit.logged_actions USING btree (relid);


--
-- Name: app_notification_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_client_id_idx ON public.app_notification USING btree (client_id);


--
-- Name: app_notification_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_payment_id_idx ON public.app_notification USING btree (payment_id);


--
-- Name: app_notification_payment_plan_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_payment_plan_id_idx ON public.app_notification USING btree (payment_plan_id);


--
-- Name: app_notification_payment_plan_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_payment_plan_payment_id_idx ON public.app_notification USING btree (payment_plan_payment_id);


--
-- Name: app_notification_session_pack_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_session_pack_id_idx ON public.app_notification USING btree (session_pack_id);


--
-- Name: app_notification_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_user_id_idx ON public.app_notification USING btree (user_id);


--
-- Name: app_notification_viewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_notification_viewed_idx ON public.app_notification USING btree (viewed);


--
-- Name: app_store_pending_renewal_info_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_store_pending_renewal_info_product_id_idx ON public.app_store_pending_renewal_info USING btree (product_id);


--
-- Name: app_store_transaction_expires_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_store_transaction_expires_date_idx ON public.app_store_transaction USING btree (expires_date DESC);


--
-- Name: app_store_transaction_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_store_transaction_product_id_idx ON public.app_store_transaction USING btree (product_id);


--
-- Name: client_session_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_session_created_at_idx ON public.client_session USING btree (created_at DESC);


--
-- Name: finance_item_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_item_trainer_id_idx ON public.finance_item USING btree (trainer_id);


--
-- Name: finance_item_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX finance_item_updated_at_idx ON public.finance_item USING btree (updated_at DESC NULLS LAST);


--
-- Name: mission_reward_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mission_reward_id_idx ON public.mission USING btree (reward_id);


--
-- Name: mission_type_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mission_type_id_idx ON public.mission_type USING btree (id);


--
-- Name: payment_credit_pack_ordered_credit_pack_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_credit_pack_ordered_credit_pack_id_idx ON public.payment_credit_pack USING btree (sale_credit_pack_id);


--
-- Name: payment_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_expr_idx ON public.payment USING btree (((refunded_time IS NULL)));


--
-- Name: payment_expr_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_expr_idx1 ON public.payment USING btree (((refunded_time IS NULL)));


--
-- Name: payment_plan_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_plan_client_id_idx ON public.payment_plan USING btree (client_id);


--
-- Name: payment_plan_pause_payment_plan_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_plan_pause_payment_plan_id_idx ON public.payment_plan_pause USING btree (payment_plan_id);


--
-- Name: payment_plan_payment_payment_plan_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_plan_payment_payment_plan_id_idx ON public.payment_plan_payment USING btree (payment_plan_id);


--
-- Name: payment_plan_payment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_plan_payment_status_idx ON public.payment_plan_payment USING btree (status);


--
-- Name: payment_plan_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_plan_trainer_id_idx ON public.payment_plan USING btree (trainer_id);


--
-- Name: payment_stripe_stripe_charge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_stripe_stripe_charge_id_idx ON public.payment_stripe USING btree (stripe_charge_id);


--
-- Name: payment_stripe_stripe_payment_intent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_stripe_stripe_payment_intent_id_idx ON public.payment_stripe USING btree (stripe_payment_intent_id);


--
-- Name: payment_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_trainer_id_idx ON public.payment USING btree (trainer_id);


--
-- Name: sale_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_client_id_idx ON public.sale USING btree (client_id);


--
-- Name: sale_product_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_product_trainer_id_idx ON public.sale_product USING btree (trainer_id);


--
-- Name: sale_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sale_trainer_id_idx ON public.sale USING btree (trainer_id);


--
-- Name: session_series_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_series_created_at_idx ON public.session_series USING btree (created_at);


--
-- Name: session_series_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_series_trainer_id_idx ON public.session_series USING btree (trainer_id);


--
-- Name: session_session_series_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_session_series_id_idx ON public.session USING btree (session_series_id);


--
-- Name: session_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_trainer_id_idx ON public.session USING btree (trainer_id);


--
-- Name: sms_credit_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_credit_trainer_id_idx ON public.sms_credit USING btree (trainer_id);


--
-- Name: sms_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_expr_idx ON public.sms USING btree (((queued_at IS NULL)));


--
-- Name: sms_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_trainer_id_idx ON public.sms USING btree (trainer_id);


--
-- Name: sms_twilio_message_sid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_twilio_message_sid_idx ON public.sms USING btree (twilio_message_sid);


--
-- Name: stripe_charge_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_charge_expr_idx ON public.stripe_charge USING btree (((object ->> 'destination'::text))) WHERE ((object ->> 'application_fee'::text) IS NOT NULL);


--
-- Name: stripe_charge_to_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_charge_to_timestamp_idx ON public.stripe_charge USING btree (to_timestamp((((object -> 'created'::text))::integer)::double precision) DESC NULLS LAST) WHERE ((object -> 'created'::text) IS NOT NULL);


--
-- Name: stripe_resource_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_resource_expr_idx ON public.stripe_resource USING btree (((object ->> 'object'::text)));


--
-- Name: supported_country_currency_country_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supported_country_currency_country_id_idx ON public.supported_country_currency USING btree (country_id);


--
-- Name: supported_country_currency_currency_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supported_country_currency_currency_id_idx ON public.supported_country_currency USING btree (currency_id);


--
-- Name: trainer_country_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trainer_country_id_idx ON public.trainer USING btree (country_id);


--
-- Name: trial_trainer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trial_trainer_id_idx ON public.trial USING btree (trainer_id);


--
-- Name: bank_account_expr_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX bank_account_expr_idx ON stripe.bank_account USING btree (((object ->> 'account'::text)));


--
-- Name: payment_method_expr_expr1_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX payment_method_expr_expr1_idx ON stripe.payment_method USING btree (((object ->> 'customer'::text)), ((object ->> 'created'::text)) DESC);


--
-- Name: payout_account_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX payout_account_idx ON stripe.payout USING btree (account);


--
-- Name: stripe_event_expr_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_event_expr_idx ON stripe.event USING btree (((object ->> 'created'::text)));


--
-- Name: stripe_event_regexp_replace_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_event_regexp_replace_idx ON stripe.event USING btree (regexp_replace((object ->> 'type'::text), '\.[a-z_]+$'::text, ''::text));


--
-- Name: message_expr_idx; Type: INDEX; Schema: twilio; Owner: -
--

CREATE INDEX message_expr_idx ON twilio.message USING btree ((((object ->> 'status'::text) = 'failed'::text)));


--
-- Name: event queue_mandrill_event; Type: TRIGGER; Schema: mandrill; Owner: -
--

CREATE TRIGGER queue_mandrill_event AFTER INSERT ON mandrill.event FOR EACH ROW WHEN ((new.processed_at IS NULL)) EXECUTE PROCEDURE public.queue_mandrill_event();


--
-- Name: event update_updated_at; Type: TRIGGER; Schema: mandrill; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON mandrill.event FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: app_store_transaction add_sms_credits_on_renewal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER add_sms_credits_on_renewal AFTER INSERT ON public.app_store_transaction FOR EACH ROW EXECUTE PROCEDURE public.add_sms_credits_on_renewal();


--
-- Name: client client_trim; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER client_trim BEFORE INSERT OR UPDATE ON public.client FOR EACH ROW EXECUTE PROCEDURE public.client_trim();


--
-- Name: mail send_mail; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER send_mail AFTER INSERT ON public.mail FOR EACH ROW WHEN (((new.queued_at IS NULL) AND (new.mandrill_message_id IS NULL) AND (new.rejected_at IS NULL) AND (new.sent_at IS NULL))) EXECUTE PROCEDURE public.send_mail();


--
-- Name: sms send_sms; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER send_sms AFTER INSERT ON public.sms FOR EACH ROW WHEN (((new.queued_at IS NULL) AND (new.twilio_message_sid IS NULL) AND (new.queue_failed_at IS NULL))) EXECUTE PROCEDURE public.send_sms();


--
-- Name: client set_email_appointment_reminder_client_null_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_email_appointment_reminder_client_null_on_delete BEFORE DELETE ON public.client FOR EACH ROW EXECUTE PROCEDURE public.set_email_appointment_reminder_client_null_on_delete();


--
-- Name: session set_email_appointment_reminder_session_null_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_email_appointment_reminder_session_null_on_delete BEFORE DELETE ON public.session FOR EACH ROW EXECUTE PROCEDURE public.set_email_appointment_reminder_session_null_on_delete();


--
-- Name: client set_mail_client_null_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_mail_client_null_on_delete BEFORE DELETE ON public.client FOR EACH ROW EXECUTE PROCEDURE public.set_mail_client_null_on_delete();


--
-- Name: client set_sms_client_null_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_sms_client_null_on_delete BEFORE DELETE ON public.client FOR EACH ROW EXECUTE PROCEDURE public.set_sms_client_null_on_delete();


--
-- Name: task_queue task_queue_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_queue_insert AFTER INSERT ON public.task_queue FOR EACH ROW EXECUTE PROCEDURE public.notify_task_queue_insert();


--
-- Name: trainer trainer_trim; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trainer_trim BEFORE INSERT OR UPDATE ON public.trainer FOR EACH ROW EXECUTE PROCEDURE public.trainer_trim();


--
-- Name: sale unattach_deleted_sale_from_client_session; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER unattach_deleted_sale_from_client_session BEFORE DELETE ON public.sale FOR EACH ROW EXECUTE PROCEDURE public.unattach_deleted_sale_from_client_session();


--
-- Name: service unattach_deleted_service_from_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER unattach_deleted_service_from_sessions BEFORE DELETE ON public.service FOR EACH ROW EXECUTE PROCEDURE public.unattach_deleted_service_from_sessions();


--
-- Name: session update_appointment_reminder_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_appointment_reminder_before_insert BEFORE INSERT ON public.session FOR EACH ROW EXECUTE PROCEDURE public.update_appointment_reminder_check();


--
-- Name: session update_appointment_reminder_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_appointment_reminder_before_update BEFORE UPDATE OF service_provider_reminder_1, service_provider_reminder_2, client_reminder_1, client_reminder_2, start ON public.session FOR EACH ROW EXECUTE PROCEDURE public.update_appointment_reminder_check();


--
-- Name: access_token update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.access_token FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: analytics_data update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.analytics_data FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: app_notification update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.app_notification FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: app_store_pending_renewal_info update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.app_store_pending_renewal_info FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: app_store_server_notification update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.app_store_server_notification FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: app_store_transaction update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.app_store_transaction FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: availability update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.availability FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: busy_time update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.busy_time FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: client update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.client FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: client_login_request update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.client_login_request FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: client_note update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at AFTER UPDATE ON public.client_note FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: client_payment_reminder update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.client_payment_reminder FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: client_session update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.client_session FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: credit_pack update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.credit_pack FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: email_appointment_reminder update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.email_appointment_reminder FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: finance_item update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.finance_item FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: installation update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.installation FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: mail update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.mail FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: mail_bounce update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.mail_bounce FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: mail_click update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.mail_click FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: mail_open update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.mail_open FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: mission update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.mission FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_credit_pack update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_credit_pack FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_manual update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_manual FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_method update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_method FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_plan update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_plan FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_plan_acceptance update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_plan_acceptance FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_plan_charge update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_plan_charge FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_plan_pause update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_plan_pause FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_plan_payment update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_plan_payment FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_scheduled_stripe update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_scheduled_stripe FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_scheduled_stripe_attempt update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_scheduled_stripe_attempt FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_stripe update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_stripe FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_subscription update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.payment_subscription FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: product update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: reward update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.reward FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sale update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sale FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sale_credit_pack update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sale_credit_pack FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sale_item update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sale_item FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sale_product update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sale_product FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sale_service update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sale_service FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: service update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.service FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: session update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.session FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: session_series update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.session_series FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sms update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sms FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sms_credit update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sms_credit FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: sms_credit_checkout_session update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.sms_credit_checkout_session FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: stripe_balance update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.stripe_balance FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: stripe_charge update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.stripe_charge FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: stripe_payment_intent update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.stripe_payment_intent FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: stripe_resource update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.stripe_resource FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: subscription update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.subscription FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: subscription_pause update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.subscription_pause FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: subscription_period update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.subscription_period FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: subscription_update update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.subscription_update FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: survey update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.survey FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: trainer update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.trainer FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: trial update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.trial FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: user_ update_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON public.user_ FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: event process_stripe_event; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER process_stripe_event AFTER INSERT ON stripe.event FOR EACH ROW WHEN ((new.processed_at IS NULL)) EXECUTE PROCEDURE public.process_stripe_event();


--
-- Name: account save_account_external_accounts; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER save_account_external_accounts AFTER INSERT OR UPDATE ON stripe.account FOR EACH ROW EXECUTE PROCEDURE public.save_account_external_accounts();


--
-- Name: account update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.account FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: bank_account update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.bank_account FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: checkout_session update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.checkout_session FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: customer update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.customer FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: event update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.event FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payment_method update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.payment_method FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: payout update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.payout FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: subscription update_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON stripe.subscription FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: message update_updated_at; Type: TRIGGER; Schema: twilio; Owner: -
--

CREATE TRIGGER update_updated_at BEFORE UPDATE ON twilio.message FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();


--
-- Name: access_token access_token_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_token
    ADD CONSTRAINT access_token_type_fkey FOREIGN KEY (type) REFERENCES public.access_token_type(type) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: access_token access_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_token
    ADD CONSTRAINT access_token_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES public.user_(id, type) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_notification app_notification_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_notification app_notification_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_payment_id_fkey FOREIGN KEY (payment_id, trainer_id) REFERENCES public.payment(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_notification app_notification_payment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_payment_plan_id_fkey FOREIGN KEY (payment_plan_id, trainer_id) REFERENCES public.payment_plan(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_notification app_notification_session_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_session_pack_id_fkey FOREIGN KEY (session_pack_id, trainer_id) REFERENCES public.sale_credit_pack(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_notification app_notification_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES public.user_(id, type) ON DELETE CASCADE;


--
-- Name: app_store_pending_renewal_info app_store_pending_renewal_info_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_pending_renewal_info
    ADD CONSTRAINT app_store_pending_renewal_info_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: app_store_transaction app_store_transaction_original_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_transaction
    ADD CONSTRAINT app_store_transaction_original_transaction_id_fkey FOREIGN KEY (original_transaction_id) REFERENCES public.app_store_transaction(transaction_id);


--
-- Name: app_store_transaction app_store_transaction_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_store_transaction
    ADD CONSTRAINT app_store_transaction_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: busy_time busy_time_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.busy_time
    ADD CONSTRAINT busy_time_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: email_appointment_reminder client_email_appointment_reminder_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: email_appointment_reminder client_email_appointment_reminder_mail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_mail_id_fkey FOREIGN KEY (mail_id, trainer_id) REFERENCES public.mail(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: email_appointment_reminder client_email_appointment_reminder_mail_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_mail_id_fkey1 FOREIGN KEY (mail_id, client_id, trainer_id) REFERENCES public.mail(id, client_id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: email_appointment_reminder client_email_appointment_reminder_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_session_id_fkey FOREIGN KEY (session_id, trainer_id) REFERENCES public.session(id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: email_appointment_reminder client_email_appointment_reminder_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_appointment_reminder
    ADD CONSTRAINT client_email_appointment_reminder_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_note client_note_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note
    ADD CONSTRAINT client_note_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_note client_note_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note
    ADD CONSTRAINT client_note_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_payment_reminder client_payment_reminder_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_payment_reminder
    ADD CONSTRAINT client_payment_reminder_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_session client_session_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_session client_session_sale_id_key; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_sale_id_key FOREIGN KEY (sale_id, client_id, trainer_id) REFERENCES public.sale(id, client_id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_session client_session_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_session_id_fkey FOREIGN KEY (session_id, trainer_id) REFERENCES public.session(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_session client_session_state_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_session
    ADD CONSTRAINT client_session_state_fkey FOREIGN KEY (state) REFERENCES public.client_session_state(state);


--
-- Name: client client_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_status_fkey FOREIGN KEY (status) REFERENCES public.client_status(status) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client client_stripe_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_stripe_customer_id_fkey FOREIGN KEY (stripe_customer_id) REFERENCES stripe.customer(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: client client_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client client_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client
    ADD CONSTRAINT client_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES public.user_(id, type) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: credit_pack credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_pack
    ADD CONSTRAINT credit_pack_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.product(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: finance_item finance_item_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_item
    ADD CONSTRAINT finance_item_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: installation installation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES public.user_(id, type) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale invoice_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT invoice_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mail_bounce mail_bounce_bounce_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_bounce
    ADD CONSTRAINT mail_bounce_bounce_type_fkey FOREIGN KEY (bounce_type) REFERENCES public.mail_bounce_type(type);


--
-- Name: mail_bounce mail_bounce_mail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_bounce
    ADD CONSTRAINT mail_bounce_mail_id_fkey FOREIGN KEY (mail_id) REFERENCES public.mail(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mail_click mail_click_mail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_click
    ADD CONSTRAINT mail_click_mail_id_fkey FOREIGN KEY (mail_id) REFERENCES public.mail(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mail mail_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: mail_open mail_open_mail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_open
    ADD CONSTRAINT mail_open_mail_id_fkey FOREIGN KEY (mail_id) REFERENCES public.mail(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mail mail_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail
    ADD CONSTRAINT mail_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mission mission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_id_fkey FOREIGN KEY (id) REFERENCES public.mission_type(id) ON UPDATE CASCADE;


--
-- Name: mission mission_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_reward_id_fkey FOREIGN KEY (reward_id, trainer_id) REFERENCES public.reward(id, trainer_id) ON UPDATE CASCADE;


--
-- Name: mission mission_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mission
    ADD CONSTRAINT mission_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_credit_pack ordered_credit_pack_ordered_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_credit_pack
    ADD CONSTRAINT ordered_credit_pack_ordered_product_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.sale_product(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_credit_pack ordered_credit_pack_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_credit_pack
    ADD CONSTRAINT ordered_credit_pack_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_item ordered_good_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_item
    ADD CONSTRAINT ordered_good_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.sale_product(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_item ordered_good_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_item
    ADD CONSTRAINT ordered_good_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_product ordered_product_ordered_credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_ordered_credit_pack_id_fkey FOREIGN KEY (id, trainer_id, is_credit_pack) REFERENCES public.sale_credit_pack(id, trainer_id, is_credit_pack) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_item ordered_product_ordered_good_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_item
    ADD CONSTRAINT ordered_product_ordered_good_id_fkey FOREIGN KEY (id, trainer_id, is_item) REFERENCES public.sale_item(id, trainer_id, is_item) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_product ordered_product_ordered_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_ordered_service_id_fkey FOREIGN KEY (id, trainer_id, is_service) REFERENCES public.sale_service(id, trainer_id, is_service) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_product ordered_product_product_credit_pack_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_product_credit_pack_fkey FOREIGN KEY (product_id, trainer_id, is_credit_pack) REFERENCES public.product(id, trainer_id, is_credit_pack) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_product ordered_product_product_good_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_product_good_fkey FOREIGN KEY (product_id, trainer_id, is_item) REFERENCES public.product(id, trainer_id, is_item) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_product ordered_product_product_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_product_membership_fkey FOREIGN KEY (product_id, trainer_id, is_membership) REFERENCES public.product(id, trainer_id, is_membership) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_product ordered_product_product_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_product_service_fkey FOREIGN KEY (product_id, trainer_id, is_service) REFERENCES public.product(id, trainer_id, is_service) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_product ordered_product_sale_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_product
    ADD CONSTRAINT ordered_product_sale_sale_id_fkey FOREIGN KEY (sale_id, trainer_id) REFERENCES public.sale(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sale_service ordered_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_service
    ADD CONSTRAINT ordered_service_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.sale_product(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: sale_service ordered_service_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_service
    ADD CONSTRAINT ordered_service_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_credit_pack payment_credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_credit_pack
    ADD CONSTRAINT payment_credit_pack_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.payment(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_credit_pack payment_credit_pack_ordered_credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_credit_pack
    ADD CONSTRAINT payment_credit_pack_ordered_credit_pack_id_fkey FOREIGN KEY (sale_credit_pack_id, trainer_id) REFERENCES public.sale_credit_pack(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_manual payment_manual_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_manual
    ADD CONSTRAINT payment_manual_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.payment(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_manual payment_manual_method_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_manual
    ADD CONSTRAINT payment_manual_method_fkey FOREIGN KEY (method) REFERENCES public.payment_method(method);


--
-- Name: payment payment_payment_credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_payment_credit_pack_id_fkey FOREIGN KEY (id, trainer_id, is_credit_pack) REFERENCES public.payment_credit_pack(id, trainer_id, is_credit_pack) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment payment_payment_manual_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_payment_manual_id_fkey FOREIGN KEY (id, trainer_id, is_manual) REFERENCES public.payment_manual(id, trainer_id, is_manual) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment payment_payment_scheduled_stripe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_payment_scheduled_stripe_id_fkey FOREIGN KEY (id, trainer_id, is_scheduled_stripe) REFERENCES public.payment_scheduled_stripe(id, trainer_id, is_scheduled_stripe) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment payment_payment_stripe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_payment_stripe_id_fkey FOREIGN KEY (id, trainer_id, is_stripe) REFERENCES public.payment_stripe(id, trainer_id, is_stripe) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment payment_payment_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_payment_subscription_id_fkey FOREIGN KEY (id, trainer_id, is_subscription) REFERENCES public.payment_subscription(id, trainer_id, is_subscription) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_plan_acceptance payment_plan_acceptance_payment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_acceptance
    ADD CONSTRAINT payment_plan_acceptance_payment_plan_id_fkey FOREIGN KEY (payment_plan_id, trainer_id) REFERENCES public.payment_plan(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_plan_charge payment_plan_charge_stripe_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_charge
    ADD CONSTRAINT payment_plan_charge_stripe_charge_id_fkey FOREIGN KEY (stripe_charge_id) REFERENCES public.stripe_charge(id);


--
-- Name: payment_plan_charge payment_plan_charge_stripe_payment_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_charge
    ADD CONSTRAINT payment_plan_charge_stripe_payment_intent_id_fkey FOREIGN KEY (stripe_payment_intent_id) REFERENCES public.stripe_payment_intent(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_plan payment_plan_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan
    ADD CONSTRAINT payment_plan_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_plan_pause payment_plan_pause_payment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_pause
    ADD CONSTRAINT payment_plan_pause_payment_plan_id_fkey FOREIGN KEY (payment_plan_id, trainer_id) REFERENCES public.payment_plan(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_plan_payment payment_plan_payment_payment_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_payment
    ADD CONSTRAINT payment_plan_payment_payment_plan_id_fkey FOREIGN KEY (payment_plan_id, trainer_id) REFERENCES public.payment_plan(id, trainer_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_plan_payment payment_plan_payment_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan_payment
    ADD CONSTRAINT payment_plan_payment_status_fkey FOREIGN KEY (status) REFERENCES public.payment_plan_payment_status(status);


--
-- Name: payment_plan payment_plan_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_plan
    ADD CONSTRAINT payment_plan_status_fkey FOREIGN KEY (status) REFERENCES public.payment_plan_status(status);


--
-- Name: payment payment_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment
    ADD CONSTRAINT payment_sale_id_fkey FOREIGN KEY (sale_id, client_id, trainer_id) REFERENCES public.sale(id, client_id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_scheduled_stripe_attempt payment_scheduled_stripe_attem_payment_scheduled_stripe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe_attempt
    ADD CONSTRAINT payment_scheduled_stripe_attem_payment_scheduled_stripe_id_fkey FOREIGN KEY (payment_scheduled_stripe_id, trainer_id) REFERENCES public.payment_scheduled_stripe(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_scheduled_stripe payment_scheduled_stripe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe
    ADD CONSTRAINT payment_scheduled_stripe_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.payment(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_scheduled_stripe payment_scheduled_stripe_stripe_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_scheduled_stripe
    ADD CONSTRAINT payment_scheduled_stripe_stripe_charge_id_fkey FOREIGN KEY (stripe_charge_id) REFERENCES public.stripe_charge(id);


--
-- Name: payment_stripe payment_stripe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_stripe
    ADD CONSTRAINT payment_stripe_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.payment(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_stripe payment_stripe_stripe_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_stripe
    ADD CONSTRAINT payment_stripe_stripe_charge_id_fkey FOREIGN KEY (stripe_charge_id) REFERENCES public.stripe_charge(id);


--
-- Name: payment_stripe payment_stripe_stripe_payment_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_stripe
    ADD CONSTRAINT payment_stripe_stripe_payment_intent_id_fkey FOREIGN KEY (stripe_payment_intent_id) REFERENCES public.stripe_payment_intent(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_subscription payment_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_subscription
    ADD CONSTRAINT payment_subscription_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.payment(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: payment_subscription payment_subscription_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_subscription
    ADD CONSTRAINT payment_subscription_subscription_id_fkey FOREIGN KEY (subscription_id, trainer_id) REFERENCES public.payment_plan(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: product product_credit_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_credit_pack_id_fkey FOREIGN KEY (id, trainer_id, is_credit_pack) REFERENCES public.credit_pack(id, trainer_id, is_credit_pack) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: product product_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES public.currency(id);


--
-- Name: product product_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_service_fkey FOREIGN KEY (id, trainer_id, is_service) REFERENCES public.service(id, trainer_id, is_service) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: reward reward_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward
    ADD CONSTRAINT reward_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reward reward_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward
    ADD CONSTRAINT reward_type_fkey FOREIGN KEY (type) REFERENCES public.reward_type(type) ON UPDATE CASCADE;


--
-- Name: sale sale_subscription_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale
    ADD CONSTRAINT sale_subscription_period_id_fkey FOREIGN KEY (subscription_period_id, client_id, trainer_id) REFERENCES public.subscription_period(id, client_id, trainer_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: service service_booking_payment_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_booking_payment_type_fkey FOREIGN KEY (booking_payment_type) REFERENCES public.booking_payment_type(type) ON UPDATE CASCADE;


--
-- Name: service service_booking_question_state_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_booking_question_state_fkey FOREIGN KEY (booking_question_state) REFERENCES public.booking_question_state(state);


--
-- Name: service service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_id_fkey FOREIGN KEY (id, trainer_id) REFERENCES public.product(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: service service_request_client_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT service_request_client_address_fkey FOREIGN KEY (request_client_address_online) REFERENCES public.request_client_address_online_type(type);


--
-- Name: session session_booking_payment_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_booking_payment_type_fkey FOREIGN KEY (booking_payment_type) REFERENCES public.booking_payment_type(type) ON UPDATE CASCADE;


--
-- Name: session session_booking_question_state_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_booking_question_state_fkey FOREIGN KEY (booking_question_state) REFERENCES public.booking_question_state(state);


--
-- Name: session session_client_reminder_1_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_client_reminder_1_type_fkey FOREIGN KEY (client_reminder_1_type) REFERENCES public.client_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: session session_client_reminder_2_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_client_reminder_2_type_fkey FOREIGN KEY (client_reminder_2_type) REFERENCES public.client_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: session session_request_client_address_online_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_request_client_address_online_fkey FOREIGN KEY (request_client_address_online) REFERENCES public.request_client_address_online_type(type);


--
-- Name: session_series session_series_event_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_series
    ADD CONSTRAINT session_series_event_type_fkey FOREIGN KEY (event_type) REFERENCES public.event_type(type);


--
-- Name: session_series session_series_session_icon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_series
    ADD CONSTRAINT session_series_session_icon_id_fkey FOREIGN KEY (session_icon_id) REFERENCES public.session_icon(id);


--
-- Name: session_series session_series_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_series
    ADD CONSTRAINT session_series_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON DELETE CASCADE;


--
-- Name: session session_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_service_id_fkey FOREIGN KEY (service_id, trainer_id) REFERENCES public.service(id, trainer_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: session session_service_provider_reminder_1_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_service_provider_reminder_1_type_fkey FOREIGN KEY (service_provider_reminder_1_type) REFERENCES public.service_provider_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: session session_service_provider_reminder_2_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_service_provider_reminder_2_type_fkey FOREIGN KEY (service_provider_reminder_2_type) REFERENCES public.service_provider_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: session session_session_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_session_series_id_fkey FOREIGN KEY (session_series_id, trainer_id) REFERENCES public.session_series(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sms_credit_checkout_session sms_credit_checkout_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit_checkout_session
    ADD CONSTRAINT sms_credit_checkout_session_id_fkey FOREIGN KEY (id) REFERENCES stripe.checkout_session(id);


--
-- Name: sms_credit_checkout_session sms_credit_checkout_session_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit_checkout_session
    ADD CONSTRAINT sms_credit_checkout_session_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id);


--
-- Name: sms_credit sms_credit_sms_credit_checkout_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit
    ADD CONSTRAINT sms_credit_sms_credit_checkout_session_id_fkey FOREIGN KEY (sms_credit_checkout_session_id) REFERENCES public.sms_credit_checkout_session(id);


--
-- Name: sms_credit sms_credit_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit
    ADD CONSTRAINT sms_credit_source_fkey FOREIGN KEY (source) REFERENCES public.sms_credit_source(source) ON UPDATE CASCADE;


--
-- Name: sms_credit sms_credit_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_credit
    ADD CONSTRAINT sms_credit_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sms sms_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms
    ADD CONSTRAINT sms_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sms sms_twilio_message_sid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms
    ADD CONSTRAINT sms_twilio_message_sid_fkey FOREIGN KEY (twilio_message_sid) REFERENCES twilio.message(sid) ON UPDATE CASCADE;


--
-- Name: subscription subscription_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_client_id_fkey FOREIGN KEY (client_id, trainer_id) REFERENCES public.client(id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscription_pause subscription_pause_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_pause
    ADD CONSTRAINT subscription_pause_subscription_id_fkey FOREIGN KEY (subscription_id, client_id, trainer_id) REFERENCES public.subscription(id, client_id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscription_period subscription_period_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_period
    ADD CONSTRAINT subscription_period_subscription_id_fkey FOREIGN KEY (subscription_id, client_id, trainer_id) REFERENCES public.subscription(id, client_id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscription subscription_recurrence_frequency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_recurrence_frequency_fkey FOREIGN KEY (recurrence_frequency) REFERENCES public.subscription_frequency(frequency);


--
-- Name: subscription subscription_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription
    ADD CONSTRAINT subscription_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscription_update subscription_update_recurrence_frequency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_update
    ADD CONSTRAINT subscription_update_recurrence_frequency_fkey FOREIGN KEY (recurrence_frequency) REFERENCES public.subscription_frequency(frequency);


--
-- Name: subscription_update subscription_update_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_update
    ADD CONSTRAINT subscription_update_subscription_id_fkey FOREIGN KEY (subscription_id, client_id, trainer_id) REFERENCES public.subscription(id, client_id, trainer_id) MATCH FULL ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: supported_country_currency supported_country_currency_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supported_country_currency
    ADD CONSTRAINT supported_country_currency_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.country(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: supported_country_currency supported_country_currency_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supported_country_currency
    ADD CONSTRAINT supported_country_currency_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES public.currency(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: survey survey_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey
    ADD CONSTRAINT survey_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: trainer trainer_brand_color_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_brand_color_fkey FOREIGN KEY (brand_color) REFERENCES public.brand_color(id);


--
-- Name: trainer trainer_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.country(id);


--
-- Name: trainer trainer_default_client_appointment_reminder_1_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_default_client_appointment_reminder_1_type_fkey FOREIGN KEY (default_client_appointment_reminder_1_type) REFERENCES public.client_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: trainer trainer_default_client_appointment_reminder_2_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_default_client_appointment_reminder_2_type_fkey FOREIGN KEY (default_client_appointment_reminder_2_type) REFERENCES public.client_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: trainer trainer_default_service_provider_appointment_reminder_1_ty_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_default_service_provider_appointment_reminder_1_ty_fkey FOREIGN KEY (default_service_provider_appointment_reminder_1_type) REFERENCES public.service_provider_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: trainer trainer_default_service_provider_appointment_reminder_2_ty_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_default_service_provider_appointment_reminder_2_ty_fkey FOREIGN KEY (default_service_provider_appointment_reminder_2_type) REFERENCES public.service_provider_appointment_reminder_type(type) ON UPDATE CASCADE;


--
-- Name: trainer trainer_stripe_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_stripe_account_id_fkey FOREIGN KEY (stripe_account_id) REFERENCES stripe.account(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: trainer trainer_stripe_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_stripe_subscription_id_fkey FOREIGN KEY (stripe_subscription_id) REFERENCES stripe.subscription(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: trainer trainer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer
    ADD CONSTRAINT trainer_user_id_fkey FOREIGN KEY (user_id, user_type) REFERENCES public.user_(id, type) ON DELETE CASCADE;


--
-- Name: trial trial_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial
    ADD CONSTRAINT trial_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainer(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_ user__type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_
    ADD CONSTRAINT user__type_fkey FOREIGN KEY (type) REFERENCES public.user_type(type) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payout payout_account_fkey; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payout
    ADD CONSTRAINT payout_account_fkey FOREIGN KEY (account) REFERENCES stripe.account(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



--
-- Dbmate schema migrations
--


-- migrate:down

-- Irreversible baseline migration.
