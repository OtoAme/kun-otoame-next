-- Read-only inventory for the company merge suggestion queue (stage D1).
-- Run this file before the matching sync file and review every result.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'target_table' AS check_type,
  CASE
    WHEN to_regclass('public.company_merge_suggestion') IS NULL
      THEN 'ready_to_create'
    ELSE 'present_review_definition'
  END AS status;

SELECT
  'target_column' AS check_type,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  character_maximum_length,
  datetime_precision,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'company_merge_suggestion'
ORDER BY ordinal_position;

SELECT
  'target_index' AS check_type,
  indexname AS index_name,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'company_merge_suggestion'
ORDER BY indexname;

DO $preflight_guard$
DECLARE
  mismatch_count integer;
BEGIN
  IF to_regclass('public.company_merge_suggestion') IS NULL THEN
    RETURN;
  END IF;

  -- Array columns report data_type 'ARRAY', so udt_name is what separates
  -- integer[] from text[] here.
  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('id', 'integer', 'int4', 'NO', NULL::integer, NULL::integer),
    ('kind', 'character varying', 'varchar', 'NO', 32, NULL::integer),
    ('status', 'character varying', 'varchar', 'NO', 16, NULL::integer),
    ('folded_key', 'character varying', 'varchar', 'NO', 107, NULL::integer),
    ('target_company_id', 'integer', 'int4', 'NO', NULL::integer, NULL::integer),
    ('source_company_ids', 'ARRAY', '_int4', 'YES', NULL::integer, NULL::integer),
    ('names', 'ARRAY', '_text', 'YES', NULL::integer, NULL::integer),
    ('evidence', 'jsonb', 'jsonb', 'NO', NULL::integer, NULL::integer),
    ('detected_at', 'timestamp without time zone', 'timestamp', 'NO', NULL::integer, 3),
    ('resolved_at', 'timestamp without time zone', 'timestamp', 'YES', NULL::integer, 3),
    ('resolved_by_user_id', 'integer', 'int4', 'YES', NULL::integer, NULL::integer),
    ('created', 'timestamp without time zone', 'timestamp', 'NO', NULL::integer, 3),
    ('updated', 'timestamp without time zone', 'timestamp', 'NO', NULL::integer, 3)
  ) AS expected(column_name, data_type, udt_name, is_nullable, character_maximum_length, datetime_precision)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'company_merge_suggestion'
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.data_type <> expected.data_type
     OR actual.udt_name <> expected.udt_name
     OR actual.is_nullable <> expected.is_nullable
     OR actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length
     OR actual.datetime_precision IS DISTINCT FROM expected.datetime_precision;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'company merge suggestion preflight failed: existing table is partial or has incompatible columns';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('company_merge_suggestion_pkey'),
    ('company_merge_suggestion_status_detected_at_idx'),
    ('company_merge_suggestion_kind_folded_key_status_idx')
  ) AS expected(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_index actual ON actual.indexrelid = index_class.oid
    WHERE index_class.relnamespace = 'public'::regnamespace
      AND index_class.relname = expected.index_name
      AND actual.indrelid = 'public.company_merge_suggestion'::regclass
      AND actual.indisvalid
      AND actual.indisready
      AND actual.indislive
  );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'company merge suggestion preflight failed: existing table is missing or has unusable named indexes';
  END IF;
END
$preflight_guard$;

COMMIT;
