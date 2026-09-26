-- Independent read-only verification for the M03-6 / M03-7 case schema delta.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $case_feedback_postflight$
DECLARE
  column_row record;
  actual_count integer;
  mismatch_count integer;
  index_row record;
  constraint_row record;
BEGIN
  SELECT data_type, is_nullable, column_default
  INTO column_row
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ops_case'
    AND column_name = 'reminded_revision';

  IF NOT FOUND
     OR column_row.data_type <> 'integer'
     OR column_row.is_nullable <> 'YES'
     OR column_row.column_default IS NOT NULL THEN
    RAISE EXCEPTION
      'case feedback postflight failed: public.ops_case.reminded_revision is missing or incompatible';
  END IF;

  IF to_regclass('public.ops_case_message_image') IS NULL THEN
    RAISE EXCEPTION
      'case feedback postflight failed: public.ops_case_message_image is missing';
  END IF;

  SELECT COUNT(*)
  INTO actual_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ops_case_message_image';

  SELECT COUNT(*) FILTER (
    WHERE existing.column_name IS NULL
       OR existing.data_type <> required.expected_type
       OR existing.is_nullable <> required.expected_nullable
       OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
       OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
       OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL)
       OR (required.default_policy = 'sequence' AND lower(COALESCE(existing.column_default, '')) !~ $$^nextval\($$)
       OR (required.default_policy = 'current_timestamp' AND upper(COALESCE(existing.column_default, '')) !~ $$^CURRENT_TIMESTAMP$$)
  )
  INTO mismatch_count
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
   AND existing.column_name = required.column_name;

  IF actual_count <> 5 OR mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'case feedback postflight failed: public.ops_case_message_image columns=%, mismatches=%',
      actual_count,
      mismatch_count;
  END IF;

  FOR index_row IN
    SELECT * FROM (VALUES
      ('ops_case_message_image_pkey', TRUE, TRUE, 1, $$\(\s*id\s*\)$$),
      ('ops_case_message_image_message_id_sort_key', TRUE, FALSE, 2, $$\(\s*message_id\s*,\s*sort\s*\)$$)
    ) AS contract(index_name, must_be_unique, must_be_primary, key_count, definition_pattern)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class object_row
      JOIN pg_index index_actual ON index_actual.indexrelid = object_row.oid
      WHERE object_row.relnamespace = 'public'::regnamespace
        AND object_row.relname = index_row.index_name
        AND index_actual.indrelid = to_regclass('public.ops_case_message_image')
        AND index_actual.indisunique = index_row.must_be_unique
        AND index_actual.indisprimary = index_row.must_be_primary
        AND index_actual.indnullsnotdistinct IS FALSE
        AND index_actual.indisvalid
        AND index_actual.indisready
        AND index_actual.indislive
        AND index_actual.indpred IS NULL
        AND index_actual.indexprs IS NULL
        AND index_actual.indnkeyatts = index_row.key_count
        AND index_actual.indnatts = index_actual.indnkeyatts
        AND pg_get_indexdef(index_actual.indexrelid) ~ index_row.definition_pattern
    ) THEN
      RAISE EXCEPTION
        'case feedback postflight failed: index % is missing or its definition/state mismatches',
        index_row.index_name;
    END IF;
  END LOOP;

  SELECT
    constraint_actual.contype,
    constraint_actual.convalidated,
    constraint_actual.condeferrable,
    constraint_actual.condeferred,
    constraint_actual.confmatchtype,
    constraint_actual.confrelid,
    constraint_actual.confdeltype,
    constraint_actual.confupdtype
  INTO constraint_row
  FROM pg_constraint constraint_actual
  WHERE constraint_actual.conname = 'ops_case_message_image_message_id_fkey'
    AND constraint_actual.conrelid = to_regclass('public.ops_case_message_image');

  IF NOT FOUND
     OR constraint_row.contype <> 'f'
     OR constraint_row.convalidated IS NOT TRUE
     OR constraint_row.condeferrable
     OR constraint_row.condeferred
     OR constraint_row.confmatchtype <> 's'
     OR constraint_row.confrelid IS DISTINCT FROM to_regclass('public.ops_case_message')
     OR constraint_row.confdeltype::text <> 'c'
     OR constraint_row.confupdtype::text <> 'a' THEN
    RAISE EXCEPTION
      'case feedback postflight failed: FK ops_case_message_image_message_id_fkey is missing or mismatched';
  END IF;
END
$case_feedback_postflight$;

SELECT 'case feedback postflight passed' AS result;

COMMIT;
