-- Re-runnable production sync for resource-level access grants.
-- Run only with psql, without -1/--single-transaction, after draining legacy
-- access writers and capturing one fixed cutoff/cutover snapshot.

\set ON_ERROR_STOP on

\if :{?legacy_max_id}
\else
  \echo 'missing required psql variable: legacy_max_id'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

\if :{?legacy_cutover_at}
\else
  \echo 'missing required psql variable: legacy_cutover_at'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

SELECT
  :'legacy_cutover_at' ~* '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' AS legacy_cutover_has_timezone
\gset
\if :legacy_cutover_has_timezone
\else
  \echo 'legacy_cutover_at must include Z or an explicit UTC offset'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

SELECT :'legacy_max_id' ~ '^(0|[1-9][0-9]*)$' AS legacy_max_id_valid
\gset
\if :legacy_max_id_valid
\else
  \echo 'legacy_max_id must be a non-negative integer'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

-- These casts and the live cutoff check must all succeed before any DDL/DML.
SELECT :'legacy_max_id'::bigint AS validated_legacy_max_id;

SELECT
  :'legacy_cutover_at'::timestamptz AS validated_legacy_cutover_at,
  :'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC' AS legacy_cutover_at_utc;

SELECT
  COALESCE(MAX(id), 0) = :'legacy_max_id'::bigint AS legacy_cutoff_matches
FROM public.patch_resource_access
\gset
\if :legacy_cutoff_matches
\else
  \echo 'legacy_max_id is stale; drain old writers and capture a new cutoff'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

-- A ready/valid same-name index with the wrong definition must fail before
-- schema or backfill writes. Missing or invalid/not-ready indexes are allowed
-- through here and are handled by top-level concurrent statements later.
WITH expected(index_name, index_definition) AS (
  VALUES
    (
      'resource_access_grant_expires_idx',
      'CREATE INDEX resource_access_grant_expires_idx ON public.patch_resource_access_grant USING btree (expires)'
    ),
    (
      'resource_access_visitor_kind_created_idx',
      'CREATE INDEX resource_access_visitor_kind_created_idx ON public.patch_resource_access USING btree (actor_type, visitor_token, section, access_kind, created DESC)'
    )
), actual AS (
  SELECT
    expected.*,
    index_class.oid,
    index_class.relkind,
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
)
SELECT
  COUNT(*) FILTER (
    WHERE oid IS NOT NULL AND relkind NOT IN ('i', 'I')
  ) = 0 AS index_names_are_indexes,
  COUNT(*) FILTER (
    WHERE relkind IN ('i', 'I')
      AND indisready
      AND indisvalid
      AND indislive
      AND actual_definition IS DISTINCT FROM index_definition
  ) = 0 AS ready_valid_index_definitions_match
FROM actual
\gset index_shape_preflight_

\if :index_shape_preflight_index_names_are_indexes
\else
  \echo 'a required index name exists but is not an index'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

\if :index_shape_preflight_ready_valid_index_definitions_match
\else
  \echo 'a ready/valid required index has an incompatible definition'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

-- IF NOT EXISTS may only cover absence. Any existing same-name object must
-- already have the exact target shape or this sync fails before changing data.
DO $shape_preflight$
DECLARE
  access_relation oid := to_regclass('public.patch_resource_access');
  resource_relation oid := to_regclass('public.patch_resource');
  grant_relation oid := to_regclass('public.patch_resource_access_grant');
  relation_kind "char";
  access_kind_count integer;
  access_kind_type text;
  access_kind_not_null boolean;
  access_kind_default text;
  access_kind_generated "char";
  access_kind_identity "char";
  grant_column_count integer;
  grant_matching_column_count integer;
  primary_key_count integer;
  matching_primary_key_count integer;
  foreign_key_count integer;
  matching_foreign_key_count integer;
BEGIN
  IF access_relation IS NULL THEN
    RAISE EXCEPTION 'Missing required table public.patch_resource_access';
  END IF;
  IF resource_relation IS NULL THEN
    RAISE EXCEPTION 'Missing required table public.patch_resource';
  END IF;

  SELECT relkind INTO relation_kind FROM pg_class WHERE oid = access_relation;
  IF relation_kind <> 'r' THEN
    RAISE EXCEPTION 'public.patch_resource_access must be an ordinary table, found relkind %', relation_kind;
  END IF;

  SELECT COUNT(*)
  INTO access_kind_count
  FROM pg_attribute
  WHERE attrelid = access_relation
    AND attname = 'access_kind'
    AND attnum > 0
    AND NOT attisdropped;

  IF access_kind_count = 1 THEN
    SELECT
      format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull,
      pg_get_expr(attribute_default.adbin, attribute_default.adrelid),
      attribute.attgenerated,
      attribute.attidentity
    INTO
      access_kind_type,
      access_kind_not_null,
      access_kind_default,
      access_kind_generated,
      access_kind_identity
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef attribute_default
      ON attribute_default.adrelid = attribute.attrelid
     AND attribute_default.adnum = attribute.attnum
    WHERE attribute.attrelid = access_relation
      AND attribute.attname = 'access_kind'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF access_kind_type <> 'character varying(20)'
      OR NOT access_kind_not_null
      OR access_kind_default IS DISTINCT FROM '''link_reveal''::character varying'
      OR access_kind_generated <> ''
      OR access_kind_identity <> '' THEN
      RAISE EXCEPTION
        'Existing patch_resource_access.access_kind has incompatible shape: type=%, not_null=%, default=%, generated=%, identity=%',
        access_kind_type,
        access_kind_not_null,
        access_kind_default,
        access_kind_generated,
        access_kind_identity;
    END IF;
  ELSIF access_kind_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected duplicate access_kind catalog entries';
  END IF;

  IF grant_relation IS NULL THEN
    RETURN;
  END IF;

  SELECT relkind INTO relation_kind FROM pg_class WHERE oid = grant_relation;
  IF relation_kind <> 'r' THEN
    RAISE EXCEPTION 'public.patch_resource_access_grant must be an ordinary table, found relkind %', relation_kind;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE attribute.attnotnull
        AND attribute.attidentity = ''
        AND attribute.attgenerated = ''
        AND attribute_default.oid IS NULL
        AND (
          (attribute.attname = 'actor_key' AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(80)')
          OR (attribute.attname = 'resource_id' AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer')
          OR (attribute.attname = 'expires' AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone')
        )
    )
  INTO grant_column_count, grant_matching_column_count
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = grant_relation
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF grant_column_count <> 3 OR grant_matching_column_count <> 3 THEN
    RAISE EXCEPTION
      'Existing patch_resource_access_grant columns are incompatible: total=%, matching=%',
      grant_column_count,
      grant_matching_column_count;
  END IF;

  WITH primary_keys AS (
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
      ) AS key_columns
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = grant_relation
      AND constraint_row.contype = 'p'
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE conname = 'patch_resource_access_grant_pkey'
        AND convalidated
        AND NOT condeferrable
        AND key_columns = ARRAY['actor_key', 'resource_id']::text[]
    )
  INTO primary_key_count, matching_primary_key_count
  FROM primary_keys;

  IF primary_key_count <> 1 OR matching_primary_key_count <> 1 THEN
    RAISE EXCEPTION
      'Existing patch_resource_access_grant primary key is incompatible: total=%, matching=%',
      primary_key_count,
      matching_primary_key_count;
  END IF;

  WITH foreign_keys AS (
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
      ) AS referenced_columns
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = grant_relation
      AND constraint_row.contype = 'f'
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE conname = 'patch_resource_access_grant_resource_id_fkey'
        AND convalidated
        AND NOT condeferrable
        AND NOT condeferred
        AND confmatchtype = 's'
        AND confupdtype = 'a'
        AND confdeltype = 'c'
        AND confrelid = resource_relation
        AND key_columns = ARRAY['resource_id']::text[]
        AND referenced_columns = ARRAY['id']::text[]
    )
  INTO foreign_key_count, matching_foreign_key_count
  FROM foreign_keys;

  IF foreign_key_count <> 1 OR matching_foreign_key_count <> 1 THEN
    RAISE EXCEPTION
      'Existing patch_resource_access_grant foreign key is incompatible: total=%, matching=%',
      foreign_key_count,
      matching_foreign_key_count;
  END IF;
END
$shape_preflight$;

ALTER TABLE public.patch_resource_access
  ADD COLUMN IF NOT EXISTS access_kind VARCHAR(20) NOT NULL DEFAULT 'link_reveal';

CREATE TABLE IF NOT EXISTS public.patch_resource_access_grant (
  actor_key VARCHAR(80) NOT NULL,
  resource_id INTEGER NOT NULL REFERENCES public.patch_resource(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  expires TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (actor_key, resource_id)
);

-- Reassert the complete table/column/constraint shape after creation.
DO $shape_postflight$
DECLARE
  access_relation oid := to_regclass('public.patch_resource_access');
  grant_relation oid := to_regclass('public.patch_resource_access_grant');
  resource_relation oid := to_regclass('public.patch_resource');
  mismatch_count integer;
BEGIN
  SELECT COUNT(*)
  INTO mismatch_count
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = access_relation
    AND attribute.attname = 'access_kind'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(20)'
    AND attribute.attnotnull
    AND attribute.attgenerated = ''
    AND attribute.attidentity = ''
    AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''link_reveal''::character varying';

  IF mismatch_count <> 1 THEN
    RAISE EXCEPTION 'Postflight failed for patch_resource_access.access_kind';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = grant_relation
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attnotnull
    AND attribute.attidentity = ''
    AND attribute.attgenerated = ''
    AND attribute_default.oid IS NULL
    AND (
      (attribute.attname = 'actor_key' AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(80)')
      OR (attribute.attname = 'resource_id' AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer')
      OR (attribute.attname = 'expires' AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone')
    );

  IF mismatch_count <> 3 OR (
    SELECT COUNT(*)
    FROM pg_attribute
    WHERE attrelid = grant_relation
      AND attnum > 0
      AND NOT attisdropped
  ) <> 3 THEN
    RAISE EXCEPTION 'Postflight failed for patch_resource_access_grant columns';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = grant_relation
    AND constraint_row.contype = 'p'
    AND constraint_row.conname = 'patch_resource_access_grant_pkey'
    AND constraint_row.convalidated
    AND NOT constraint_row.condeferrable
    AND ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) = ARRAY['actor_key', 'resource_id']::text[];

  IF mismatch_count <> 1 OR (
    SELECT COUNT(*) FROM pg_constraint
    WHERE conrelid = grant_relation AND contype = 'p'
  ) <> 1 THEN
    RAISE EXCEPTION 'Postflight failed for patch_resource_access_grant primary key';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = grant_relation
    AND constraint_row.contype = 'f'
    AND constraint_row.conname = 'patch_resource_access_grant_resource_id_fkey'
    AND constraint_row.convalidated
    AND NOT constraint_row.condeferrable
    AND NOT constraint_row.condeferred
    AND constraint_row.confmatchtype = 's'
    AND constraint_row.confupdtype = 'a'
    AND constraint_row.confdeltype = 'c'
    AND constraint_row.confrelid = resource_relation
    AND ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) = ARRAY['resource_id']::text[]
    AND ARRAY(
      SELECT attribute.attname::text
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinal_position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.confrelid
       AND attribute.attnum = key_column.attnum
      ORDER BY key_column.ordinal_position
    ) = ARRAY['id']::text[];

  IF mismatch_count <> 1 OR (
    SELECT COUNT(*) FROM pg_constraint
    WHERE conrelid = grant_relation AND contype = 'f'
  ) <> 1 THEN
    RAISE EXCEPTION 'Postflight failed for patch_resource_access_grant foreign key';
  END IF;
END
$shape_postflight$;

WITH active_access AS (
  SELECT DISTINCT ON (
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END,
    resource_id
  )
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END AS actor_key,
    resource_id,
    expires
  FROM public.patch_resource_access
  WHERE id <= :'legacy_max_id'::bigint
    AND expires > (:'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
    AND (
      (actor_type = 'user' AND user_id IS NOT NULL AND visitor_token = '')
      OR (
        actor_type = 'visitor'
        AND user_id IS NULL
        AND visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
  ORDER BY
    CASE
      WHEN actor_type = 'user' THEN 'user:' || user_id::text
      WHEN actor_type = 'visitor' THEN 'visitor:' || visitor_token
    END,
    resource_id,
    expires DESC,
    id DESC
)
INSERT INTO public.patch_resource_access_grant (actor_key, resource_id, expires)
SELECT actor_key, resource_id, expires
FROM active_access
ON CONFLICT (actor_key, resource_id)
DO UPDATE SET expires = EXCLUDED.expires
WHERE patch_resource_access_grant.expires < EXCLUDED.expires;

-- Extend exactly one deterministic legacy event per actor/resource/link. Other
-- duplicate audit rows remain byte-for-byte historical records.
WITH canonical_legacy_event AS (
  SELECT DISTINCT ON (actor_key, resource_id, link_id)
    id,
    grant_expires
  FROM (
    SELECT
      access.id,
      CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END AS actor_key,
      access.resource_id,
      access.link_id,
      access.expires,
      resource_grant.expires AS grant_expires
    FROM public.patch_resource_access access
    JOIN public.patch_resource_access_grant resource_grant
      ON resource_grant.actor_key = CASE
        WHEN access.actor_type = 'user' THEN 'user:' || access.user_id::text
        WHEN access.actor_type = 'visitor' THEN 'visitor:' || access.visitor_token
      END
     AND resource_grant.resource_id = access.resource_id
    WHERE access.id <= :'legacy_max_id'::bigint
      AND access.expires > (:'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
      AND (
        (access.actor_type = 'user' AND access.user_id IS NOT NULL AND access.visitor_token = '')
        OR (
          access.actor_type = 'visitor'
          AND access.user_id IS NULL
          AND access.visitor_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
  ) eligible
  ORDER BY actor_key, resource_id, link_id, expires DESC, id DESC
)
UPDATE public.patch_resource_access access
SET
  expires = canonical.grant_expires,
  updated = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM canonical_legacy_event canonical
WHERE access.id = canonical.id
  AND access.expires < canonical.grant_expires;

-- Invalid/not-ready indexes are the only same-name indexes repaired in place.
-- DROP INDEX CONCURRENTLY stays at psql top level; a ready/valid definition
-- mismatch fails closed instead of being hidden by IF NOT EXISTS.
SELECT
  index_class.oid IS NOT NULL AS name_exists,
  COALESCE(index_class.relkind IN ('i', 'I'), false) AS is_index,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND (NOT index_row.indisready OR NOT index_row.indisvalid OR NOT index_row.indislive),
    false
  ) AS needs_drop,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND pg_get_indexdef(index_class.oid) =
        'CREATE INDEX resource_access_grant_expires_idx ON public.patch_resource_access_grant USING btree (expires)',
    false
  ) AS definition_ok
FROM (SELECT 1) seed
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = 'resource_access_grant_expires_idx'
LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
\gset grant_index_

\if :grant_index_name_exists
  \if :grant_index_is_index
    \if :grant_index_needs_drop
      DROP INDEX CONCURRENTLY public.resource_access_grant_expires_idx;
    \else
      \if :grant_index_definition_ok
      \else
        \echo 'existing ready/valid resource_access_grant_expires_idx has an incompatible definition'
        SELECT 1 / 0 AS resource_access_migration_aborted;
      \endif
    \endif
  \else
    \echo 'public.resource_access_grant_expires_idx exists but is not an index'
    SELECT 1 / 0 AS resource_access_migration_aborted;
  \endif
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_access_grant_expires_idx
  ON public.patch_resource_access_grant (expires);

SELECT
  index_class.oid IS NOT NULL AS name_exists,
  COALESCE(index_class.relkind IN ('i', 'I'), false) AS is_index,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND (NOT index_row.indisready OR NOT index_row.indisvalid OR NOT index_row.indislive),
    false
  ) AS needs_drop,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND pg_get_indexdef(index_class.oid) =
        'CREATE INDEX resource_access_visitor_kind_created_idx ON public.patch_resource_access USING btree (actor_type, visitor_token, section, access_kind, created DESC)',
    false
  ) AS definition_ok
FROM (SELECT 1) seed
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = 'resource_access_visitor_kind_created_idx'
LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
\gset visitor_index_

\if :visitor_index_name_exists
  \if :visitor_index_is_index
    \if :visitor_index_needs_drop
      DROP INDEX CONCURRENTLY public.resource_access_visitor_kind_created_idx;
    \else
      \if :visitor_index_definition_ok
      \else
        \echo 'existing ready/valid resource_access_visitor_kind_created_idx has an incompatible definition'
        SELECT 1 / 0 AS resource_access_migration_aborted;
      \endif
    \endif
  \else
    \echo 'public.resource_access_visitor_kind_created_idx exists but is not an index'
    SELECT 1 / 0 AS resource_access_migration_aborted;
  \endif
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_access_visitor_kind_created_idx
  ON public.patch_resource_access (
    actor_type,
    visitor_token,
    section,
    access_kind,
    created DESC
  );

-- Fail the sync if its fixed snapshot is not fully covered. The same query is
-- also exposed with counts by the preflight file for operator postflight.
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
  WHERE access.id <= :'legacy_max_id'::bigint
    AND access.expires > (:'legacy_cutover_at'::timestamptz AT TIME ZONE 'UTC')
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
), grant_summary AS (
  SELECT
    COUNT(*) FILTER (WHERE resource_grant.actor_key IS NULL) AS missing_grants,
    COUNT(*) FILTER (
      WHERE resource_grant.actor_key IS NOT NULL
        AND resource_grant.expires < historical.historical_expires
    ) AS short_grants
  FROM historical_grants historical
  LEFT JOIN public.patch_resource_access_grant resource_grant
    ON resource_grant.actor_key = historical.actor_key
   AND resource_grant.resource_id = historical.resource_id
), canonical_summary AS (
  SELECT COUNT(*) AS unaligned_events
  FROM link_groups link_group
  LEFT JOIN public.patch_resource_access_grant resource_grant
    ON resource_grant.actor_key = link_group.actor_key
   AND resource_grant.resource_id = link_group.resource_id
  WHERE resource_grant.actor_key IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM eligible event
      WHERE event.actor_key = link_group.actor_key
        AND event.resource_id = link_group.resource_id
        AND event.link_id = link_group.link_id
        AND event.expires = resource_grant.expires
    )
)
SELECT
  grant_summary.missing_grants = 0 AS grants_present,
  grant_summary.short_grants = 0 AS grants_long_enough,
  canonical_summary.unaligned_events = 0 AS canonical_events_aligned,
  grant_summary.missing_grants,
  grant_summary.short_grants,
  canonical_summary.unaligned_events
FROM grant_summary
CROSS JOIN canonical_summary
\gset data_postflight_

\echo 'postflight missing grants:' :data_postflight_missing_grants
\echo 'postflight short grants:' :data_postflight_short_grants
\echo 'postflight unaligned canonical events:' :data_postflight_unaligned_events

\if :data_postflight_grants_present
\else
  \echo 'grant postflight failed: missing grants remain'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif
\if :data_postflight_grants_long_enough
\else
  \echo 'grant postflight failed: short grants remain'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif
\if :data_postflight_canonical_events_aligned
\else
  \echo 'canonical event postflight failed: unaligned groups remain'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif

WITH expected(index_name, index_definition) AS (
  VALUES
    (
      'resource_access_grant_expires_idx',
      'CREATE INDEX resource_access_grant_expires_idx ON public.patch_resource_access_grant USING btree (expires)'
    ),
    (
      'resource_access_visitor_kind_created_idx',
      'CREATE INDEX resource_access_visitor_kind_created_idx ON public.patch_resource_access USING btree (actor_type, visitor_token, section, access_kind, created DESC)'
    )
), checked AS (
  SELECT
    expected.index_name,
    index_class.relkind IN ('i', 'I')
      AND index_row.indisready
      AND index_row.indisvalid
      AND index_row.indislive
      AND pg_get_indexdef(index_class.oid) = expected.index_definition AS is_ok
  FROM expected
  LEFT JOIN pg_class index_class
    ON index_class.relnamespace = 'public'::regnamespace
   AND index_class.relname = expected.index_name
  LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
)
SELECT
  COUNT(*) = 2
    AND COALESCE(BOOL_AND(COALESCE(is_ok, false)), false) AS indexes_ok
FROM checked
\gset index_postflight_

\if :index_postflight_indexes_ok
\else
  \echo 'index postflight failed: definition/readiness/validity mismatch'
  SELECT 1 / 0 AS resource_access_migration_aborted;
\endif
