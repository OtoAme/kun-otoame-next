-- Read-only preflight for the M03-6 / M03-7 case schema delta:
-- ops_case.reminded_revision (D22) and ops_case_message_image (D11).
--
-- Order: the 2026-09-13 case preflight/sync/postflight run first and once.
-- Their exact column contracts describe the base tables only, so they are not
-- re-run after this delta; use this preflight/sync/postflight trio instead.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $base_tables$
BEGIN
  IF to_regclass('public.ops_case') IS NULL
     OR to_regclass('public.ops_case_message') IS NULL THEN
    RAISE EXCEPTION
      'case feedback preflight failed: run the 2026-09-13 case migration first';
  END IF;
END
$base_tables$;

SELECT
  'ops_case.reminded_revision' AS target,
  CASE
    WHEN column_row.column_name IS NULL THEN 'ready_to_create'
    WHEN column_row.data_type = 'integer'
         AND column_row.is_nullable = 'YES'
         AND column_row.column_default IS NULL THEN 'present'
    ELSE 'definition_mismatch'
  END AS state
FROM (SELECT 1) AS anchor
LEFT JOIN information_schema.columns column_row
  ON column_row.table_schema = 'public'
 AND column_row.table_name = 'ops_case'
 AND column_row.column_name = 'reminded_revision';

SELECT
  'ops_case_message_image' AS target,
  CASE
    WHEN to_regclass('public.ops_case_message_image') IS NULL THEN 'ready_to_create'
    WHEN (
      SELECT relkind FROM pg_class
      WHERE oid = to_regclass('public.ops_case_message_image')
    ) <> 'r' THEN 'definition_mismatch'
    ELSE 'present'
  END AS state;

-- Column contract of an existing image table. Rows only appear when the table
-- already exists; every row must read `match`.
SELECT
  required.column_name,
  CASE
    WHEN existing.column_name IS NULL THEN 'missing'
    WHEN existing.data_type <> required.expected_type
      OR existing.is_nullable <> required.expected_nullable
      OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
      OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
      OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL)
      OR (required.default_policy = 'sequence' AND lower(COALESCE(existing.column_default, '')) !~ $$^nextval\($$)
      OR (required.default_policy = 'current_timestamp' AND upper(COALESCE(existing.column_default, '')) !~ $$^CURRENT_TIMESTAMP$$)
      THEN 'definition_mismatch'
    ELSE 'match'
  END AS state
FROM (VALUES
  ('id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
  ('message_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
  ('storage_key', 'character varying', 'NO', 1007, NULL::integer, 'forbidden'),
  ('sort', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
  ('created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp')
) AS required(column_name, expected_type, expected_nullable, expected_length, expected_precision, default_policy)
LEFT JOIN information_schema.columns existing
  ON existing.table_schema = 'public'
 AND existing.table_name = 'ops_case_message_image'
 AND existing.column_name = required.column_name
WHERE to_regclass('public.ops_case_message_image') IS NOT NULL;

SELECT
  'ops_case_message_image_message_id_sort_key' AS target,
  CASE
    WHEN object_row.oid IS NULL THEN 'ready_to_create'
    WHEN object_row.relkind <> 'i'
      OR index_actual.indrelid IS DISTINCT FROM to_regclass('public.ops_case_message_image')
      OR NOT index_actual.indisunique
      OR index_actual.indisprimary
      OR index_actual.indnullsnotdistinct IS NOT FALSE
      OR NOT index_actual.indisvalid
      OR index_actual.indpred IS NOT NULL
      OR index_actual.indexprs IS NOT NULL
      OR pg_get_indexdef(index_actual.indexrelid) !~ $$\(\s*message_id\s*,\s*sort\s*\)$$
      THEN 'definition_mismatch'
    ELSE 'present'
  END AS state
FROM (SELECT 1) AS anchor
LEFT JOIN pg_class object_row
  ON object_row.relnamespace = 'public'::regnamespace
 AND object_row.relname = 'ops_case_message_image_message_id_sort_key'
LEFT JOIN pg_index index_actual ON index_actual.indexrelid = object_row.oid;

SELECT
  'ops_case_message_image_message_id_fkey' AS target,
  CASE
    WHEN constraint_actual.oid IS NULL THEN 'ready_to_create'
    WHEN constraint_actual.contype <> 'f'
      OR constraint_actual.convalidated IS NOT TRUE
      OR constraint_actual.confrelid IS DISTINCT FROM to_regclass('public.ops_case_message')
      OR constraint_actual.confdeltype::text <> 'c'
      OR constraint_actual.confupdtype::text <> 'a'
      THEN 'definition_mismatch'
    ELSE 'present'
  END AS state
FROM (SELECT 1) AS anchor
LEFT JOIN pg_constraint constraint_actual
  ON constraint_actual.conname = 'ops_case_message_image_message_id_fkey'
 AND constraint_actual.conrelid = to_regclass('public.ops_case_message_image');

COMMIT;
