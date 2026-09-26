-- Idempotent M03-6 / M03-7 case schema delta: ops_case.reminded_revision (D22)
-- and ops_case_message_image (D11). Add-only; run the read-only preflight
-- first and the matching postflight afterwards. Requires the 2026-09-13 case
-- tables, whose own sync is not re-run after this delta.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $base_table_guard$
BEGIN
  IF to_regclass('public.ops_case') IS NULL
     OR to_regclass('public.ops_case_message') IS NULL THEN
    RAISE EXCEPTION
      'case feedback sync failed: run the 2026-09-13 case migration first';
  END IF;
END
$base_table_guard$;

-- Validate already-present target objects before the IF NOT EXISTS statements
-- below could silently keep them. Missing objects are created; compatible ones
-- are retained; anything else stops the sync without writes.
DO $existing_target_guard$
DECLARE
  column_row record;
  actual_count integer;
  mismatch_count integer;
  relation_kind "char";
  index_actual record;
  constraint_actual record;
BEGIN
  SELECT data_type, is_nullable, column_default
  INTO column_row
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ops_case'
    AND column_name = 'reminded_revision';

  IF FOUND AND (
    column_row.data_type <> 'integer'
    OR column_row.is_nullable <> 'YES'
    OR column_row.column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'case feedback sync refused: public.ops_case.reminded_revision is incompatible';
  END IF;

  IF to_regclass('public.ops_case_message_image') IS NOT NULL THEN
    SELECT relkind
    INTO relation_kind
    FROM pg_class
    WHERE oid = to_regclass('public.ops_case_message_image');

    IF relation_kind <> 'r' THEN
      RAISE EXCEPTION
        'case feedback sync refused: public.ops_case_message_image is not an ordinary table (relkind=%)',
        relation_kind;
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
        'case feedback sync refused: public.ops_case_message_image is partial or incompatible (columns=%, mismatches=%)',
        actual_count,
        mismatch_count;
    END IF;
  END IF;

  SELECT
    object_row.oid,
    object_row.relkind,
    index_row.indexrelid,
    index_row.indrelid,
    index_row.indisunique,
    index_row.indisprimary,
    index_row.indnullsnotdistinct,
    index_row.indisvalid,
    index_row.indisready,
    index_row.indislive,
    index_row.indpred,
    index_row.indexprs,
    index_row.indnkeyatts,
    index_row.indnatts
  INTO index_actual
  FROM pg_class object_row
  LEFT JOIN pg_index index_row ON index_row.indexrelid = object_row.oid
  WHERE object_row.relnamespace = 'public'::regnamespace
    AND object_row.relname = 'ops_case_message_image_message_id_sort_key';

  IF index_actual.oid IS NOT NULL AND (
    index_actual.relkind <> 'i'
    OR index_actual.indexrelid IS NULL
    OR index_actual.indrelid IS DISTINCT FROM to_regclass('public.ops_case_message_image')
    OR NOT index_actual.indisunique
    OR index_actual.indisprimary
    OR index_actual.indnullsnotdistinct IS NOT FALSE
    OR NOT index_actual.indisvalid
    OR NOT index_actual.indisready
    OR NOT index_actual.indislive
    OR index_actual.indpred IS NOT NULL
    OR index_actual.indexprs IS NOT NULL
    OR index_actual.indnkeyatts <> 2
    OR index_actual.indnatts <> index_actual.indnkeyatts
    OR pg_get_indexdef(index_actual.indexrelid) !~ $$\(\s*message_id\s*,\s*sort\s*\)$$
  ) THEN
    RAISE EXCEPTION
      'case feedback sync refused: index ops_case_message_image_message_id_sort_key definition/state mismatch';
  END IF;

  SELECT
    constraint_row.oid,
    constraint_row.contype,
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    constraint_row.confmatchtype,
    constraint_row.confrelid,
    constraint_row.confdeltype,
    constraint_row.confupdtype
  INTO constraint_actual
  FROM pg_constraint constraint_row
  WHERE constraint_row.conname = 'ops_case_message_image_message_id_fkey'
    AND constraint_row.conrelid = to_regclass('public.ops_case_message_image');

  IF constraint_actual.oid IS NOT NULL AND (
    constraint_actual.contype <> 'f'
    OR constraint_actual.convalidated IS NOT TRUE
    OR constraint_actual.condeferrable
    OR constraint_actual.condeferred
    OR constraint_actual.confmatchtype <> 's'
    OR constraint_actual.confrelid IS DISTINCT FROM to_regclass('public.ops_case_message')
    OR constraint_actual.confdeltype::text <> 'c'
    OR constraint_actual.confupdtype::text <> 'a'
  ) THEN
    RAISE EXCEPTION
      'case feedback sync refused: FK ops_case_message_image_message_id_fkey definition/action mismatch';
  END IF;
END
$existing_target_guard$;

ALTER TABLE public.ops_case
  ADD COLUMN IF NOT EXISTS reminded_revision INTEGER;

CREATE TABLE IF NOT EXISTS public.ops_case_message_image (
  id          SERIAL PRIMARY KEY,
  message_id  INTEGER NOT NULL,
  storage_key VARCHAR(1007) NOT NULL,
  sort        INTEGER NOT NULL,
  created     TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $image_foreign_key$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_message_image_message_id_fkey'
      AND conrelid = 'public.ops_case_message_image'::regclass
  ) THEN
    ALTER TABLE public.ops_case_message_image
      ADD CONSTRAINT ops_case_message_image_message_id_fkey
      FOREIGN KEY (message_id) REFERENCES public.ops_case_message(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END
$image_foreign_key$;

CREATE UNIQUE INDEX IF NOT EXISTS ops_case_message_image_message_id_sort_key
  ON public.ops_case_message_image (message_id, sort);

COMMIT;
