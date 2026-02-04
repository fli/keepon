CREATE TABLE IF NOT EXISTS public.workflow_outbox (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    dispatched_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by text,
    task_type text NOT NULL,
    payload jsonb NOT NULL,
    dedupe_key text,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 25 NOT NULL,
    workflow_run_id text,
    last_error text,
    CONSTRAINT workflow_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT workflow_outbox_status_check CHECK (
      status = ANY (ARRAY['pending'::text, 'dispatching'::text, 'dispatched'::text, 'running'::text, 'completed'::text, 'failed'::text])
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_outbox_dedupe_key_uniq ON public.workflow_outbox USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS workflow_outbox_status_available_idx ON public.workflow_outbox USING btree (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS workflow_outbox_status_locked_idx ON public.workflow_outbox USING btree (status, locked_at);
CREATE INDEX IF NOT EXISTS workflow_outbox_task_type_idx ON public.workflow_outbox USING btree (task_type);

CREATE TABLE IF NOT EXISTS public.workflow_task_execution (
    outbox_id uuid NOT NULL,
    task_type text NOT NULL,
    owner_step_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_task_execution_pkey PRIMARY KEY (outbox_id),
    CONSTRAINT workflow_task_execution_outbox_fk FOREIGN KEY (outbox_id) REFERENCES public.workflow_outbox(id) ON DELETE CASCADE,
    CONSTRAINT workflow_task_execution_status_check CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text]))
);

CREATE INDEX IF NOT EXISTS workflow_task_execution_status_idx ON public.workflow_task_execution USING btree (status, updated_at);

CREATE OR REPLACE FUNCTION public.enqueue_workflow_outbox(
  p_task_type text,
  p_payload jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_max_attempts integer DEFAULT 25,
  p_available_at timestamp with time zone DEFAULT now()
) RETURNS uuid
    LANGUAGE plpgsql
AS $$
DECLARE
  v_outbox_id uuid;
BEGIN
  INSERT INTO public.workflow_outbox (task_type, payload, dedupe_key, max_attempts, available_at)
  VALUES (p_task_type, p_payload, p_dedupe_key, p_max_attempts, p_available_at)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
  DO UPDATE
    SET dedupe_key = EXCLUDED.dedupe_key,
        updated_at = NOW()
  RETURNING id INTO v_outbox_id;

  RETURN v_outbox_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_stripe_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_workflow_outbox(
    'processStripeEvent',
    jsonb_build_object('id', NEW.id),
    ('processStripeEvent:' || NEW.id::text)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_mandrill_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW.processed_at IS NULL THEN
    PERFORM public.enqueue_workflow_outbox(
      'processMandrillEvent',
      jsonb_build_object(
        'ts', NEW.ts::text,
        '_id', NEW._id,
        'event', NEW.event
      ),
      ('processMandrillEvent:' || NEW.ts::text || ':' || NEW._id || ':' || NEW.event)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_mail() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NOT (
    NEW.queued_at IS NULL
    AND NEW.mandrill_message_id IS NULL
    AND NEW.rejected_at IS NULL
    AND NEW.sent_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_workflow_outbox(
    'sendMail',
    jsonb_build_object('id', NEW.id),
    ('sendMail:' || NEW.id::text),
    1
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_sms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NOT (
    NEW.queued_at IS NULL
    AND NEW.twilio_message_sid IS NULL
    AND NEW.queue_failed_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_workflow_outbox(
    'sendSms',
    jsonb_build_object('id', NEW.id),
    ('sendSms:' || NEW.id::text),
    1
  );

  RETURN NEW;
END;
$$;
