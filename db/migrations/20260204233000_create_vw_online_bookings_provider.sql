-- migrate:up

CREATE OR REPLACE VIEW vw_online_bookings_provider AS
SELECT
  CASE
    WHEN vw_legacy_trainer.subscription->>'status' IN ('subscribed', 'trialling') THEN trainer.online_bookings_enabled
    ELSE FALSE
  END AS "onlineBookingsEnabled",
  COALESCE(
    trainer.online_bookings_business_name,
    trainer.business_name,
    trainer.first_name || COALESCE(' ' || trainer.last_name, '')
  ) AS "providerName",
  trainer.online_bookings_page_url_slug AS "pageUrlSlug",
  COALESCE(trainer.online_bookings_contact_email, trainer.email) AS "contactEmail",
  CASE
    WHEN trainer.online_bookings_show_contact_number THEN COALESCE(trainer.online_bookings_contact_number, trainer.phone_number)
    ELSE NULL
  END AS "contactNumber",
  trainer.online_bookings_duration_until_booking_window_opens::text AS "durationUntilBookingWindowOpens",
  trainer.online_bookings_duration_until_booking_window_closes::text AS "durationUntilBookingWindowCloses",
  trainer.online_bookings_booking_note AS "bookingNote",
  json_build_object(
    'defaults',
    json_build_object(
      'monday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_monday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_monday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'tuesday',
      json_build_object(
        'acceptingBookings',
        online_bookings_tuesday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_tuesday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'wednesday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_wednesday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_wednesday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'thursday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_thursday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_thursday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'friday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_friday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_friday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'saturday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_saturday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_saturday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      ),
      'sunday',
      json_build_object(
        'acceptingBookings',
        trainer.online_bookings_sunday_accepting_bookings,
        'availableIntervals',
        (
          SELECT
            COALESCE(
              json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
              '[]'
            )
          FROM (
            SELECT unnest(a.online_bookings_sunday_available_intervals) intervals
            FROM trainer a
            WHERE a.id = trainer.id
          ) i
          WHERE NOT isempty(intervals)
        )
      )
    ),
    'overrides',
    (
      SELECT
        COALESCE(
          json_object_agg(
            trainer_online_booking_override.date,
            json_build_object(
              'acceptingBookings',
              trainer_online_booking_override.accepting_bookings,
              'availableIntervals',
              CASE
                WHEN trainer_online_booking_override.available_intervals IS NULL THEN NULL
                ELSE (
                  SELECT
                    COALESCE(
                      json_agg(ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]),
                      '[]'
                    )
                  FROM (SELECT unnest(trainer_online_booking_override.available_intervals) intervals) i
                  WHERE NOT isempty(intervals)
                )
              END
            )
          ),
          '{}'::json
        )
      FROM trainer_online_booking_override
      WHERE trainer_online_booking_override.trainer_id = trainer.id
    )
  ) AS availability,
  (
    SELECT
      COALESCE(json_agg(s), '[]')
    FROM (
      SELECT
        service.id,
        product.name,
        product.price,
        EXTRACT(EPOCH FROM service.duration) / 60 AS "durationMinutes",
        service.location,
        service.address,
        service.geo,
        service.google_place_id "googlePlaceId",
        product.description,
        service.booking_payment_type "bookingPaymentType",
        service.cover_image_url "coverImageUrl",
        service.icon_url "iconUrl",
        service.image_0_url "image0Url",
        service.image_1_url "image1Url",
        service.image_2_url "image2Url",
        service.image_3_url "image3Url",
        service.image_4_url "image4Url",
        service.image_5_url "image5Url",
        service.buffer_minutes_before "bufferMinutesBefore",
        service.buffer_minutes_after "bufferMinutesAfter",
        service.time_slot_frequency_minutes "timeSlotFrequencyMinutes",
        product.display_order "displayOrder",
        service.request_client_address_online "requestClientAddressOnline",
        service.booking_question "bookingQuestion",
        service.booking_question_state "bookingQuestionState"
      FROM service
      JOIN product ON service.id = product.id
      WHERE service.trainer_id = trainer.id
        AND service.bookable_online
      ORDER BY product.display_order, service.created_at
    ) s
  ) services,
  (
    SELECT
      COALESCE(json_agg(json_build_array(start_time, end_time)), '[]')
    FROM (
      SELECT
        coalesce(start_time, timezone(trainer.timezone, start_date)) start_time,
        coalesce(end_time, timezone(trainer.timezone, end_date)) end_time
      FROM busy_time
      WHERE trainer.id = busy_time.trainer_id
      UNION ALL
      SELECT
        session.start - make_interval(mins => session.buffer_minutes_before),
        session.start + session.duration + make_interval(mins => session.buffer_minutes_after)
      FROM session
      JOIN session_series ON session_series.id = session.session_series_id
      WHERE trainer.id = session.trainer_id
        AND session_series.event_type != 'single_session'
      UNION ALL
      SELECT
        session.start - make_interval(mins => session.buffer_minutes_before),
        session.start + session.duration + make_interval(mins => session.buffer_minutes_after)
      FROM session
      JOIN session_series ON session_series.id = session.session_series_id
      LEFT JOIN client_session ON client_session.session_id = session.id
      WHERE trainer.id = session.trainer_id
        AND session_series.event_type = 'single_session'
        AND client_session.state != 'cancelled'
        AND client_session.state != 'declined'
    ) u
    WHERE (u.start_time, u.end_time) OVERLAPS (
      NOW() + trainer.online_bookings_duration_until_booking_window_opens,
      NOW() + trainer.online_bookings_duration_until_booking_window_closes + '1 hour'::interval
    )
  ) unavailability,
  currency.alpha_code AS "currency",
  country.alpha_2_code AS "country",
  trainer.timezone,
  trainer.brand_color AS "brandColor",
  trainer.business_logo_url AS "businessLogoUrl",
  trainer.cover_image_url AS "coverImageUrl",
  trainer.brand_dark_mode AS "brandDarkMode",
  trainer.online_bookings_terms_and_conditions AS "termsAndConditions",
  trainer.online_bookings_cancellation_policy AS "cancellationPolicy",
  trainer.stripe_account_id AS "stripeAccountId",
  stripe.account.object->>'type' AS "stripeAccountType"
FROM trainer
JOIN country ON country.id = trainer.country_id
JOIN supported_country_currency ON country.id = supported_country_currency.country_id
JOIN currency ON currency.id = supported_country_currency.currency_id
JOIN vw_legacy_trainer ON trainer.id = vw_legacy_trainer.id
LEFT JOIN stripe.account ON stripe.account.id = trainer.stripe_account_id
WHERE trainer.online_bookings_page_url_slug IS NOT NULL;
-- migrate:down
