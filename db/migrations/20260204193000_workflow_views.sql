-- migrate:up

CREATE OR REPLACE VIEW public.vw_generate_payment_plan_payments AS
SELECT *
FROM public.generate_payment_plan_payments();

CREATE OR REPLACE VIEW public.vw_app_store_latest_receipts AS
SELECT DISTINCT ON (original_transaction_id, trainer_id)
  original_transaction_id,
  encoded_receipt,
  trainer_id
FROM app_store_transaction
WHERE expires_date + '60 days'::interval > NOW()
ORDER BY original_transaction_id, trainer_id, expires_date DESC;

CREATE OR REPLACE VIEW public.vw_trialled_didnt_sub_trainers AS
SELECT trainer.id AS trainer_id
FROM trainer
JOIN vw_legacy_trainer ON vw_legacy_trainer.id = trainer.id
WHERE vw_legacy_trainer.subscription->>'status' = 'limited'
  AND NOT trainer.trialled_didnt_sub_mailchimp_tag_applied;

CREATE OR REPLACE VIEW public.vw_due_payment_reminders AS
SELECT
  latest_remind_time,
  most_overdue,
  NOW() - most_overdue >= '13 days'::interval AS last_reminder,
  trainer.id AS trainer_id,
  trainer.user_id AS trainer_user_id,
  COALESCE(
    trainer.online_bookings_business_name,
    trainer.business_name,
    trainer.first_name || COALESCE(' ' || trainer.last_name, '')
  ) AS service_provider_name,
  trainer.brand_color,
  trainer.business_logo_url,
  client.id AS client_id,
  client.first_name AS client_first_name,
  client.last_name AS client_last_name,
  client.email AS client_email,
  overdue_count
FROM (
  SELECT
    trainer_id,
    client_id,
    max(due_date) AS most_overdue,
    count(*)::int AS overdue_count
  FROM (
    SELECT
      sale.trainer_id,
      sale.client_id,
      COALESCE(payment_request_time, sale.created_at) AS due_date
    FROM sale
    JOIN sale_payment_status ON sale_payment_status.sale_id = sale.id
    JOIN (VALUES ('rejected'), ('requested')) vals(v) ON vals.v = sale_payment_status.payment_status
    UNION ALL
    SELECT
      payment_plan_payment.trainer_id,
      client_id,
      payment_plan_payment.date AS due_date
    FROM payment_plan_payment
    JOIN payment_plan ON payment_plan.id = payment_plan_payment.payment_plan_id
    WHERE payment_plan_payment.status = 'rejected'
    UNION ALL
    SELECT
      trainer_id,
      client_id,
      CASE
        WHEN start > acceptance_request_time THEN start
        ELSE start + ceil(
          extract(epoch FROM acceptance_request_time - start) /
          extract(epoch FROM ((frequency_weekly_interval * 7) * '1 day'::interval))
        ) * (frequency_weekly_interval * 7 * '1 day'::interval)
      END AS due_date
    FROM payment_plan
    WHERE status = 'pending'
  ) due
  WHERE due_date < now() - '2 days'::interval
  GROUP BY (trainer_id, client_id)
) remind_me
JOIN trainer ON trainer.id = remind_me.trainer_id
JOIN client ON client.id = remind_me.client_id
LEFT JOIN (
  SELECT
    max(send_time) AS latest_remind_time,
    trainer_id,
    client_id
  FROM client_payment_reminder
  GROUP BY (client_id, trainer_id)
) reminder ON reminder.trainer_id = trainer.id AND reminder.client_id = client.id
WHERE extract(hour FROM timezone(trainer.timezone, NOW())) >= 8
  AND extract(hour FROM timezone(trainer.timezone, NOW())) < 20
  AND NOW() >= most_overdue + '2 days'::interval
  AND NOW() < most_overdue + '15 days'::interval
  AND (
    NOW() > latest_remind_time + '47 hours'::interval
    OR latest_remind_time IS NULL
  );

CREATE OR REPLACE VIEW public.vw_session_reminder_details AS
SELECT
  session.id AS session_id,
  trainer.id AS trainer_id,
  r.reminder_slot AS reminder_slot,
  r.reminder_type AS reminder_type,
  r.reminder_interval AS reminder_interval,
  r.reminder_checked_at AS reminder_checked_at,
  uuid_generate_v1mc() AS mail_id,
  COALESCE(
    trainer.online_bookings_business_name,
    trainer.business_name,
    trainer.first_name || COALESCE(' ' || trainer.last_name, '')
  ) AS service_provider_name,
  trainer.email AS service_provider_email,
  trainer.brand_color AS brand_color,
  trainer.business_logo_url AS business_logo_url,
  trainer.user_id AS user_id,
  sms_credit_checkout_id AS sms_credit_checkout_id,
  sms_balance.credit_balance AS sms_credit_balance,
  (vw_legacy_trainer.subscription->>'status' = 'trialling')
    OR (vw_legacy_trainer.subscription->>'status' = 'subscribed') AS client_reminders_enabled,
  country.alpha_2_code AS country,
  session.start AS starts_at,
  session.start + session.duration AS ends_at,
  session.timezone AS timezone,
  session.location AS location,
  session.address AS address,
  CASE
    WHEN session.geo IS NOT NULL THEN json_build_object('lat', session.geo[0], 'lng', session.geo[1])
    ELSE NULL
  END AS geo,
  session.google_place_id AS google_place_id,
  trainer.locale AS locale,
  COALESCE(
    session_series.event_type = 'single_session'
      AND (SELECT state = 'cancelled' FROM client_session WHERE session.id = client_session.session_id LIMIT 1),
    FALSE
  ) AS cancelled,
  COALESCE(session_series.name, 'Appointment') AS name,
  COALESCE(trainer.online_bookings_contact_email, trainer.email) AS contact_email,
  CASE
    WHEN trainer.online_bookings_show_contact_number THEN
      COALESCE(trainer.online_bookings_contact_number, trainer.phone_number)
    ELSE NULL
  END AS contact_number,
  (
    SELECT COALESCE(json_agg(c), '[]')
    FROM (
      SELECT
        client.id,
        client.first_name AS first_name,
        client.last_name AS last_name,
        client.email,
        client.mobile_number AS mobile_number,
        uuid_generate_v1mc() AS mail_id,
        client_session.id AS client_session_id,
        client_session.booking_id AS booking_id
      FROM client
      JOIN client_session ON client_session.client_id = client.id
      JOIN (VALUES ('maybe'), ('invited'), ('confirmed'), ('accepted')) vals(v) ON vals.v = client_session.state
      WHERE client_session.session_id = session.id
    ) c
  ) AS clients
FROM session
JOIN session_series ON session_series.id = session.session_series_id
JOIN trainer ON session.trainer_id = trainer.id
JOIN vw_legacy_trainer ON vw_legacy_trainer.id = trainer.id
JOIN country ON country.id = trainer.country_id
JOIN sms_balance ON sms_balance.trainer_id = trainer.id
CROSS JOIN LATERAL (
  VALUES
    (
      'service_provider_reminder_1',
      session.service_provider_reminder_1_type || 'ServiceProvider',
      session.service_provider_reminder_1,
      session.service_provider_reminder_1_checked_at
    ),
    (
      'service_provider_reminder_2',
      session.service_provider_reminder_2_type || 'ServiceProvider',
      session.service_provider_reminder_2,
      session.service_provider_reminder_2_checked_at
    ),
    (
      'client_reminder_1',
      session.client_reminder_1_type || 'Client',
      session.client_reminder_1,
      session.client_reminder_1_checked_at
    ),
    (
      'client_reminder_2',
      session.client_reminder_2_type || 'Client',
      session.client_reminder_2,
      session.client_reminder_2_checked_at
    )
) r(reminder_slot, reminder_type, reminder_interval, reminder_checked_at)
WHERE r.reminder_interval IS NOT NULL;

CREATE OR REPLACE VIEW public.vw_due_session_reminder_slots AS
SELECT
  session_id,
  trainer_id,
  reminder_slot,
  reminder_type
FROM public.vw_session_reminder_details
WHERE reminder_checked_at IS NULL
  AND NOW() <@ tstzrange(starts_at - reminder_interval, starts_at + '10 minutes'::interval);
-- migrate:down
