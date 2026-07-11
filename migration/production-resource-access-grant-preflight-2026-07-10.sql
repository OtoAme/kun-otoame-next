-- Read-only production preflight/postflight for resource-level access grants.
-- First run without rollout variables to capture the candidates. Re-run with the
-- exact fixed snapshot after sync:
--   psql -X -v ON_ERROR_STOP=1 \
--     -v legacy_max_id=... -v legacy_cutover_at=... "$KUN_DATABASE_URL" -f this-file.sql

\set ON_ERROR_STOP on

SELECT current_setting('TimeZone') AS session_timezone;

SELECT to_regclass('public.patch_resource_access') IS NOT NULL AS access_table_present
\gset
\if :access_table_present
\else
  \echo 'missing required table: public.patch_resource_access'
  \quit 3
\endif

-- Freeze one snapshot for every data check in this run. Supplying only one
-- rollout variable is always an operator error.
\if :{?legacy_max_id}
  \if :{?legacy_cutover_at}
    SELECT :'legacy_max_id' ~ '^(0|[1-9][0-9]*)$' AS legacy_max_id_valid
    \gset
    \if :legacy_max_id_valid
    \else
      \echo 'legacy_max_id must be a non-negative integer'
      \quit 3
    \endif

    SELECT
      :'legacy_cutover_at' ~* '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' AS legacy_cutover_has_timezone
    \gset
    \if :legacy_cutover_has_timezone
    \else
      \echo 'legacy_cutover_at must include Z or an explicit UTC offset'
      \quit 3
    \endif

    SELECT
      :'legacy_max_id'::bigint::text AS effective_legacy_max_id,
      :'legacy_cutover_at'::timestamptz::text AS effective_legacy_cutover_at
    \gset
  \else
    \echo 'legacy_cutover_at is required when legacy_max_id is provided'
    \quit 3
  \endif
\else
  \if :{?legacy_cutover_at}
    \echo 'legacy_max_id is required when legacy_cutover_at is provided'
    \quit 3
  \endif

  SELECT
    COALESCE(MAX(id), 0)::text AS effective_legacy_max_id,
    CURRENT_TIMESTAMP::text AS effective_legacy_cutover_at
  FROM public.patch_resource_access
  \gset
\endif

WITH classified_access AS (
  SELECT
    access.*,
    CASE
      WHEN actor_type = 'visitor'
        AND user_id IS NULL
        AND visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN 'valid_visitor'
      WHEN actor_type = 'user'
        AND user_id IS NOT NULL
        AND visitor_token = ''
        THEN 'valid_user'
      WHEN actor_type = 'user'
        AND user_id IS NULL
        AND visitor_token = ''
        THEN 'deleted_user'
      ELSE 'invalid'
    END AS identity_state
  FROM public.patch_resource_access access
  WHERE id <= :'effective_legacy_max_id'::bigint
)
SELECT
  COUNT(*) FILTER (WHERE identity_state = 'invalid' AND actor_type = 'visitor') AS invalid_visitor_rows,
  COUNT(*) FILTER (WHERE identity_state = 'invalid' AND actor_type = 'user') AS invalid_user_rows,
  COUNT(*) FILTER (WHERE actor_type IS NULL OR actor_type NOT IN ('visitor', 'user')) AS invalid_actor_type_rows,
  COUNT(*) FILTER (WHERE identity_state = 'deleted_user') AS deleted_user_rows,
  COUNT(*) FILTER (
    WHERE identity_state IN ('valid_visitor', 'valid_user')
      AND expires > (:'effective_legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
  ) AS active_legacy_rows,
  :'effective_legacy_max_id'::bigint AS legacy_max_id_candidate,
  :'effective_legacy_cutover_at'::timestamptz AS legacy_cutover_at_candidate
FROM classified_access;

SELECT
  COUNT(*) AS invalid_relation_rows
FROM public.patch_resource_access access
LEFT JOIN public.patch_resource_link link ON link.id = access.link_id
LEFT JOIN public.patch_resource resource ON resource.id = access.resource_id
WHERE access.id <= :'effective_legacy_max_id'::bigint
  AND (
    link.id IS NULL
    OR resource.id IS NULL
    OR link.resource_id <> access.resource_id
    OR resource.patch_id <> access.patch_id
  );

WITH duplicate_event_groups AS (
  SELECT
    actor_type,
    CASE
      WHEN actor_type = 'user' AND user_id IS NOT NULL THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
      ELSE 'deleted-user-row:' || id::text
    END AS actor_identity,
    resource_id,
    link_id,
    expires,
    COUNT(*) AS row_count
  FROM public.patch_resource_access
  WHERE id <= :'effective_legacy_max_id'::bigint
  GROUP BY 1, 2, 3, 4, 5
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) AS historical_duplicate_event_groups,
  COALESCE(SUM(row_count - 1), 0) AS historical_extra_event_rows
FROM duplicate_event_groups;

-- Column shape: access_kind must match Prisma's required varchar(20) default.
WITH expected AS (
  SELECT
    'character varying'::text AS data_type,
    20::integer AS character_maximum_length,
    'NO'::text AS is_nullable,
    '''link_reveal''::character varying'::text AS column_default
), actual AS (
  SELECT data_type, character_maximum_length, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_resource_access'
    AND column_name = 'access_kind'
)
SELECT
  'access_kind_column_shape' AS check_type,
  CASE
    WHEN actual.data_type IS NULL THEN 'missing'
    WHEN actual.data_type <> expected.data_type THEN 'type_mismatch'
    WHEN actual.character_maximum_length <> expected.character_maximum_length THEN 'length_mismatch'
    WHEN actual.is_nullable <> expected.is_nullable THEN 'nullability_mismatch'
    WHEN actual.column_default IS DISTINCT FROM expected.column_default THEN 'default_mismatch'
    ELSE 'ok'
  END AS status,
  expected.data_type AS expected_type,
  actual.data_type AS actual_type,
  expected.character_maximum_length AS expected_length,
  actual.character_maximum_length AS actual_length,
  expected.is_nullable AS expected_nullable,
  actual.is_nullable AS actual_nullable,
  expected.column_default AS expected_default,
  actual.column_default AS actual_default
FROM expected
LEFT JOIN actual ON true;

-- Grant table must have exactly these three non-null columns and no defaults.
WITH expected(column_name, data_type, character_maximum_length, datetime_precision) AS (
  VALUES
    ('actor_key', 'character varying', 80::integer, NULL::integer),
    ('resource_id', 'integer', NULL::integer, NULL::integer),
    ('expires', 'timestamp without time zone', NULL::integer, 3::integer)
), actual AS (
  SELECT
    column_name,
    data_type,
    character_maximum_length,
    datetime_precision,
    is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_resource_access_grant'
)
SELECT
  'grant_column_shape' AS check_type,
  expected.column_name,
  CASE
    WHEN to_regclass('public.patch_resource_access_grant') IS NULL THEN 'missing_table'
    WHEN actual.column_name IS NULL THEN 'missing'
    WHEN actual.data_type <> expected.data_type THEN 'type_mismatch'
    WHEN actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length THEN 'length_mismatch'
    WHEN actual.datetime_precision IS DISTINCT FROM expected.datetime_precision THEN 'precision_mismatch'
    WHEN actual.is_nullable <> 'NO' THEN 'nullability_mismatch'
    WHEN actual.column_default IS NOT NULL THEN 'default_mismatch'
    ELSE 'ok'
  END AS status,
  expected.data_type AS expected_type,
  actual.data_type AS actual_type,
  expected.character_maximum_length AS expected_length,
  actual.character_maximum_length AS actual_length,
  expected.datetime_precision AS expected_precision,
  actual.datetime_precision AS actual_precision,
  actual.is_nullable,
  actual.column_default
FROM expected
LEFT JOIN actual USING (column_name)
ORDER BY expected.column_name;

SELECT
  'grant_column_inventory' AS check_type,
  CASE
    WHEN to_regclass('public.patch_resource_access_grant') IS NULL THEN 'missing_table'
    WHEN COUNT(*) = 3
      AND COUNT(*) FILTER (WHERE column_name IN ('actor_key', 'resource_id', 'expires')) = 3
      THEN 'ok'
    ELSE 'unexpected_columns'
  END AS status,
  COUNT(*) AS actual_column_count,
  ARRAY_AGG(column_name ORDER BY ordinal_position) AS actual_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch_resource_access_grant';

WITH actual AS (
  SELECT
    constraint_row.conname,
    constraint_row.convalidated,
    constraint_row.condeferrable,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) AS key_columns,
    pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = to_regclass('public.patch_resource_access_grant')
    AND constraint_row.contype = 'p'
)
SELECT
  'grant_primary_key_shape' AS check_type,
  CASE
    WHEN to_regclass('public.patch_resource_access_grant') IS NULL THEN 'missing_table'
    WHEN COUNT(*) = 0 THEN 'missing'
    WHEN COUNT(*) <> 1 THEN 'unexpected_count'
    WHEN COUNT(*) FILTER (
      WHERE conname = 'patch_resource_access_grant_pkey'
        AND convalidated
        AND NOT condeferrable
        AND key_columns = ARRAY['actor_key', 'resource_id']::text[]
    ) = 1 THEN 'ok'
    ELSE 'definition_mismatch'
  END AS status,
  JSONB_AGG(TO_JSONB(actual)) FILTER (WHERE conname IS NOT NULL) AS actual_constraints
FROM actual;

WITH actual AS (
  SELECT
    constraint_row.conname,
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    constraint_row.confmatchtype,
    constraint_row.confupdtype,
    constraint_row.confdeltype,
    constraint_row.confrelid,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) AS key_columns,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.confrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) AS referenced_columns,
    pg_get_constraintdef(constraint_row.oid, true) AS definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = to_regclass('public.patch_resource_access_grant')
    AND constraint_row.contype = 'f'
)
SELECT
  'grant_resource_foreign_key_shape' AS check_type,
  CASE
    WHEN to_regclass('public.patch_resource_access_grant') IS NULL THEN 'missing_table'
    WHEN COUNT(*) = 0 THEN 'missing'
    WHEN COUNT(*) <> 1 THEN 'unexpected_count'
    WHEN COUNT(*) FILTER (
      WHERE conname = 'patch_resource_access_grant_resource_id_fkey'
        AND convalidated
        AND NOT condeferrable
        AND NOT condeferred
        AND confmatchtype = 's'
        AND confupdtype = 'a'
        AND confdeltype = 'c'
        AND confrelid = to_regclass('public.patch_resource')
        AND key_columns = ARRAY['resource_id']::text[]
        AND referenced_columns = ARRAY['id']::text[]
    ) = 1 THEN 'ok'
    ELSE 'definition_mismatch'
  END AS status,
  JSONB_AGG(TO_JSONB(actual)) FILTER (WHERE conname IS NOT NULL) AS actual_constraints
FROM actual;

WITH expected(index_name, table_name, index_definition) AS (
  VALUES
    (
      'resource_access_grant_expires_idx',
      'patch_resource_access_grant',
      'CREATE INDEX resource_access_grant_expires_idx ON public.patch_resource_access_grant USING btree (expires)'
    ),
    (
      'resource_access_visitor_kind_created_idx',
      'patch_resource_access',
      'CREATE INDEX resource_access_visitor_kind_created_idx ON public.patch_resource_access USING btree (actor_type, visitor_token, section, access_kind, created DESC)'
    )
), actual AS (
  SELECT
    expected.*,
    index_class.oid,
    index_class.relkind,
    table_class.relname AS actual_table_name,
    index_row.indisready,
    index_row.indisvalid,
    index_row.indislive,
    CASE
      WHEN index_class.relkind IN ('i', 'I') THEN pg_get_indexdef(index_class.oid)
      ELSE NULL
    END AS actual_definition
  FROM expected
  LEFT JOIN pg_class index_class
    ON index_class.relnamespace = 'public'::regnamespace
   AND index_class.relname = expected.index_name
  LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
  LEFT JOIN pg_class table_class ON table_class.oid = index_row.indrelid
)
SELECT
  'required_index_shape' AS check_type,
  index_name,
  CASE
    WHEN oid IS NULL THEN 'missing'
    WHEN relkind NOT IN ('i', 'I') THEN 'unexpected_object_kind'
    WHEN actual_table_name IS DISTINCT FROM table_name
      OR actual_definition IS DISTINCT FROM index_definition THEN 'definition_mismatch'
    WHEN NOT indisready THEN 'not_ready'
    WHEN NOT indisvalid THEN 'invalid'
    WHEN NOT indislive THEN 'not_live'
    ELSE 'ok'
  END AS status,
  table_name AS expected_table_name,
  actual_table_name,
  index_definition AS expected_definition,
  actual_definition,
  indisready,
  indisvalid,
  indislive
FROM actual
ORDER BY index_name;

SELECT to_regclass('public.patch_resource_access_grant') IS NOT NULL AS grant_table_present
\gset

-- Estimate the canonical link events that sync will extend. When a grant table
-- already exists, preserve a longer existing grant exactly as sync does.
\if :grant_table_present
  WITH eligible AS (
    SELECT
      access.id,
      CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END AS actor_key,
      access.resource_id,
      access.link_id,
      access.expires
    FROM public.patch_resource_access access
    WHERE access.id <= :'effective_legacy_max_id'::bigint
      AND access.expires > (:'effective_legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
      AND (
        (access.actor_type = 'user' AND access.user_id IS NOT NULL AND access.visitor_token = '')
        OR (
          access.actor_type = 'visitor'
          AND access.user_id IS NULL
          AND access.visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ), historical_grants AS (
    SELECT actor_key, resource_id, MAX(expires) AS historical_expires
    FROM eligible
    GROUP BY actor_key, resource_id
  ), target_grants AS (
    SELECT
      historical.actor_key,
      historical.resource_id,
      GREATEST(historical.historical_expires, grant.expires) AS target_expires
    FROM historical_grants historical
    LEFT JOIN public.patch_resource_access_grant grant
      ON grant.actor_key = historical.actor_key
     AND grant.resource_id = historical.resource_id
  ), canonical_events AS (
    SELECT DISTINCT ON (actor_key, resource_id, link_id)
      actor_key, resource_id, link_id, expires
    FROM eligible
    ORDER BY actor_key, resource_id, link_id, expires DESC, id DESC
  )
  SELECT
    'canonical_event_normalization_estimate' AS check_type,
    COUNT(*) AS active_actor_resource_link_groups,
    COUNT(*) FILTER (WHERE canonical.expires < target.target_expires) AS canonical_events_to_normalize,
    COALESCE(
      MAX(target.target_expires - canonical.expires)
        FILTER (WHERE canonical.expires < target.target_expires),
      INTERVAL '0 seconds'
    ) AS maximum_extension
  FROM canonical_events canonical
  JOIN target_grants target USING (actor_key, resource_id);
\else
  WITH eligible AS (
    SELECT
      access.id,
      CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END AS actor_key,
      access.resource_id,
      access.link_id,
      access.expires
    FROM public.patch_resource_access access
    WHERE access.id <= :'effective_legacy_max_id'::bigint
      AND access.expires > (:'effective_legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
      AND (
        (access.actor_type = 'user' AND access.user_id IS NOT NULL AND access.visitor_token = '')
        OR (
          access.actor_type = 'visitor'
          AND access.user_id IS NULL
          AND access.visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ), target_grants AS (
    SELECT actor_key, resource_id, MAX(expires) AS target_expires
    FROM eligible
    GROUP BY actor_key, resource_id
  ), canonical_events AS (
    SELECT DISTINCT ON (actor_key, resource_id, link_id)
      actor_key, resource_id, link_id, expires
    FROM eligible
    ORDER BY actor_key, resource_id, link_id, expires DESC, id DESC
  )
  SELECT
    'canonical_event_normalization_estimate' AS check_type,
    COUNT(*) AS active_actor_resource_link_groups,
    COUNT(*) FILTER (WHERE canonical.expires < target.target_expires) AS canonical_events_to_normalize,
    COALESCE(
      MAX(target.target_expires - canonical.expires)
        FILTER (WHERE canonical.expires < target.target_expires),
      INTERVAL '0 seconds'
    ) AS maximum_extension
  FROM canonical_events canonical
  JOIN target_grants target USING (actor_key, resource_id);
\endif

-- Postflight coverage is meaningful only after the grant table exists.
\if :grant_table_present
  WITH eligible AS (
    SELECT
      access.id,
      CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END AS actor_key,
      access.resource_id,
      access.link_id,
      access.expires
    FROM public.patch_resource_access access
    WHERE access.id <= :'effective_legacy_max_id'::bigint
      AND access.expires > (:'effective_legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
      AND (
        (access.actor_type = 'user' AND access.user_id IS NOT NULL AND access.visitor_token = '')
        OR (
          access.actor_type = 'visitor'
          AND access.user_id IS NULL
          AND access.visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ), historical_grants AS (
    SELECT actor_key, resource_id, MAX(expires) AS historical_expires
    FROM eligible
    GROUP BY actor_key, resource_id
  ), link_groups AS (
    SELECT actor_key, resource_id, link_id
    FROM eligible
    GROUP BY actor_key, resource_id, link_id
  )
  SELECT
    'active_legacy_grant_coverage' AS check_type,
    COUNT(*) AS active_actor_resource_groups,
    COUNT(*) FILTER (WHERE grant.actor_key IS NULL) AS missing_grant_groups,
    COUNT(*) FILTER (
      WHERE grant.actor_key IS NOT NULL
        AND grant.expires < historical.historical_expires
    ) AS grant_expires_too_short_groups,
    (
      SELECT COUNT(*)
      FROM link_groups link_group
      LEFT JOIN public.patch_resource_access_grant link_grant
        ON link_grant.actor_key = link_group.actor_key
       AND link_grant.resource_id = link_group.resource_id
      WHERE link_grant.actor_key IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM eligible event
          WHERE event.actor_key = link_group.actor_key
            AND event.resource_id = link_group.resource_id
            AND event.link_id = link_group.link_id
            AND event.expires = link_grant.expires
        )
    ) AS canonical_event_unaligned_groups
  FROM historical_grants historical
  LEFT JOIN public.patch_resource_access_grant grant
    ON grant.actor_key = historical.actor_key
   AND grant.resource_id = historical.resource_id;
\else
  SELECT
    'active_legacy_grant_coverage' AS check_type,
    'missing_grant_table' AS status,
    NULL::bigint AS active_actor_resource_groups,
    NULL::bigint AS missing_grant_groups,
    NULL::bigint AS grant_expires_too_short_groups,
    NULL::bigint AS canonical_event_unaligned_groups;
\endif
