-- Read-only inventory for the M02 shoutbox schema change.
-- Run this file before the matching sync file and review every result.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'patch_report_snapshot' AS check_type,
  COUNT(*)::bigint AS report_count,
  COUNT(*) FILTER (WHERE patch_id IS NULL)::bigint AS null_patch_id_count
FROM public.patch_report;

SELECT
  'patch_report_target_type' AS check_type,
  target_type,
  COUNT(*)::bigint AS row_count
FROM public.patch_report
GROUP BY target_type
ORDER BY target_type;

SELECT
  'target_table' AS check_type,
  table_name,
  CASE
    WHEN to_regclass(format('public.%I', table_name)) IS NULL
      THEN 'ready_to_create'
    ELSE 'present_review_definition'
  END AS status
FROM (VALUES ('shoutbox'), ('patch_report')) AS required(table_name)
ORDER BY table_name;

SELECT
  'target_column' AS check_type,
  table_name,
  column_name,
  data_type,
  is_nullable,
  character_maximum_length,
  datetime_precision,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name = 'shoutbox'
    OR (table_name = 'patch_report' AND column_name IN ('patch_id', 'shoutbox_id'))
  )
ORDER BY table_name, ordinal_position;

SELECT
  'target_index' AS check_type,
  tablename AS table_name,
  indexname AS index_name,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    tablename = 'shoutbox'
    OR (tablename = 'patch_report' AND indexname LIKE '%shoutbox%')
  )
ORDER BY tablename, indexname;

SELECT
  'target_constraint' AS check_type,
  table_class.relname AS table_name,
  constraint_row.conname AS constraint_name,
  constraint_row.contype,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_constraint AS constraint_row
JOIN pg_class AS table_class ON table_class.oid = constraint_row.conrelid
JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
WHERE table_namespace.nspname = 'public'
  AND (
    table_class.relname = 'shoutbox'
    OR (table_class.relname = 'patch_report' AND constraint_row.conname LIKE '%shoutbox%')
  )
ORDER BY table_class.relname, constraint_row.conname;

DO $preflight_guard$
DECLARE
  mismatch_count integer;
BEGIN
  IF to_regclass('public.patch_report') IS NULL
     OR to_regclass('public."user"') IS NULL
     OR to_regclass('public.patch') IS NULL THEN
    RAISE EXCEPTION
      'shoutbox preflight failed: required base table is missing';
  END IF;

  IF to_regclass('public.shoutbox') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('id', 'integer', 'NO', NULL::integer, NULL::integer),
    ('user_id', 'integer', 'NO', NULL::integer, NULL::integer),
    ('request_id', 'character varying', 'NO', 64, NULL::integer),
    ('content', 'character varying', 'NO', 500, NULL::integer),
    ('link', 'character varying', 'NO', 1000, NULL::integer),
    ('official', 'boolean', 'NO', NULL::integer, NULL::integer),
    ('level', 'character varying', 'NO', 16, NULL::integer),
    ('status', 'integer', 'NO', NULL::integer, NULL::integer),
    ('cost', 'integer', 'NO', NULL::integer, NULL::integer),
    ('patch_id', 'integer', 'YES', NULL::integer, NULL::integer),
    ('effective_from', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('effective_to', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('edited_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('refunded_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('created', 'timestamp without time zone', 'NO', NULL::integer, 3),
    ('updated', 'timestamp without time zone', 'NO', NULL::integer, 3)
  ) AS expected(column_name, data_type, is_nullable, character_maximum_length, datetime_precision)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'shoutbox'
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.data_type <> expected.data_type
     OR actual.is_nullable <> expected.is_nullable
     OR actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length
     OR actual.datetime_precision IS DISTINCT FROM expected.datetime_precision;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'shoutbox preflight failed: existing table is partial or has incompatible columns';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('shoutbox_pkey'),
    ('shoutbox_status_check'),
    ('shoutbox_level_check'),
    ('shoutbox_cost_check'),
    ('shoutbox_shape_check'),
    ('shoutbox_user_id_fkey'),
    ('shoutbox_patch_id_fkey')
  ) AS expected(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint actual
    WHERE actual.conname = expected.constraint_name
      AND actual.conrelid = 'public.shoutbox'::regclass
  );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'shoutbox preflight failed: existing table is missing named constraints';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('shoutbox_pkey'),
    ('shoutbox_user_id_request_id_key'),
    ('shoutbox_status_created_id_idx'),
    ('shoutbox_patch_id_status_created_idx'),
    ('shoutbox_user_id_created_id_idx'),
    ('shoutbox_official_status_effective_to_idx')
  ) AS expected(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_index actual ON actual.indexrelid = index_class.oid
    WHERE index_class.relnamespace = 'public'::regnamespace
      AND index_class.relname = expected.index_name
      AND actual.indrelid = 'public.shoutbox'::regclass
      AND actual.indisvalid
      AND actual.indisready
      AND actual.indislive
  );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'shoutbox preflight failed: existing table is missing or has unusable named indexes';
  END IF;
END
$preflight_guard$;

COMMIT;
