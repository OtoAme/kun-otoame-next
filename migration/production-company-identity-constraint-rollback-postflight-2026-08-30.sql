-- Independent read-only verification after an emergency Phase B rollback.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'normalized_name_column' AS check_type,
  data_type,
  character_maximum_length,
  is_nullable,
  CASE
    WHEN data_type = 'character varying'
      AND character_maximum_length = 107
      AND is_nullable = 'YES'
      THEN 'ok'
    ELSE 'definition_mismatch'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch_company'
  AND column_name = 'normalized_name';

WITH target_indexes(index_name, expected_unique) AS (
  VALUES
    ('patch_company_normalized_name_idx', false),
    ('patch_company_external_id_source_external_id_idx', false),
    ('patch_company_normalized_name_key', true),
    ('patch_company_external_id_source_external_id_key', true)
)
SELECT
  'identity_index' AS check_type,
  target.index_name,
  target.expected_unique,
  CASE
    WHEN to_regclass(format('public.%I', target.index_name)) IS NULL THEN 'missing'
    ELSE 'present_definition_checked_below'
  END AS status,
  pg_get_indexdef(to_regclass(format('public.%I', target.index_name))) AS definition
FROM target_indexes target
ORDER BY target.index_name;

DO $postflight$
DECLARE
  mismatch_count integer;
  index_contract record;
  constraint_contract record;
BEGIN
  IF to_regclass('public.patch_company_external_id') IS NULL
    OR to_regclass('public.patch_company_name_identity') IS NULL THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: Phase A identity table missing';
  END IF;

  SELECT count(*)
  INTO mismatch_count
  FROM (VALUES
    ('patch_company', 'normalized_name', 'character varying', 'YES', 107, NULL::integer, 'forbidden'),
    ('patch_submission', 'company_candidates', 'jsonb', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_company_external_id', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'required'),
    ('patch_company_external_id', 'company_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_company_external_id', 'source', 'character varying', 'NO', 32, NULL::integer, 'forbidden'),
    ('patch_company_external_id', 'external_id', 'character varying', 'NO', 107, NULL::integer, 'forbidden'),
    ('patch_company_external_id', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'required'),
    ('patch_company_external_id', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden'),
    ('patch_company_name_identity', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'required'),
    ('patch_company_name_identity', 'company_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'kind', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'origin', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'value', 'character varying', 'NO', 107, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'normalized_value', 'character varying', 'NO', 107, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'confirmed_by_user_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_company_name_identity', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'required'),
    ('patch_company_name_identity', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden')
  ) AS required(table_name, column_name, expected_type, expected_nullable, expected_length, expected_precision, default_policy)
  LEFT JOIN information_schema.columns existing
    ON existing.table_schema = 'public'
   AND existing.table_name = required.table_name
   AND existing.column_name = required.column_name
  WHERE existing.column_name IS NULL
     OR existing.data_type <> required.expected_type
     OR existing.is_nullable <> required.expected_nullable
     OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
     OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
     OR (required.default_policy = 'required' AND existing.column_default IS NULL)
     OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL);

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: Phase A column mismatches=%', mismatch_count;
  END IF;

  FOR index_contract IN
    SELECT * FROM (VALUES
      ('patch_company_normalized_name_idx', 'patch_company', false, 'normalized_name'),
      ('patch_company_external_id_company_id_idx', 'patch_company_external_id', false, 'company_id'),
      ('patch_company_external_id_source_external_id_idx', 'patch_company_external_id', false, 'source,external_id'),
      ('patch_company_name_identity_company_id_idx', 'patch_company_name_identity', false, 'company_id'),
      ('patch_company_name_identity_confirmed_by_user_id_idx', 'patch_company_name_identity', false, 'confirmed_by_user_id'),
      ('patch_company_name_identity_normalized_value_idx', 'patch_company_name_identity', false, 'normalized_value'),
      ('patch_company_name_identity_company_kind_value_key', 'patch_company_name_identity', true, 'company_id,kind,normalized_value')
    ) AS contract(index_name, table_name, must_be_unique, expected_columns)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index index_row
      WHERE index_row.indexrelid = to_regclass(format('public.%I', index_contract.index_name))
        AND index_row.indrelid = to_regclass(format('public.%I', index_contract.table_name))
        AND index_row.indisunique = index_contract.must_be_unique
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
        AND replace(replace(
          substring(pg_get_indexdef(index_row.indexrelid) FROM '\((.*)\)$'),
          '"', ''
        ), ' ', '') = index_contract.expected_columns
    ) THEN
      RAISE EXCEPTION 'company identity rollback postflight failed: Phase A index % mismatch', index_contract.index_name;
    END IF;
  END LOOP;

  FOR constraint_contract IN
    SELECT * FROM (VALUES
      ('patch_company_external_id_pkey', 'patch_company_external_id', 'p', NULL::text, ' ', ' '),
      ('patch_company_external_id_company_id_fkey', 'patch_company_external_id', 'f', 'patch_company', 'c', 'a'),
      ('patch_company_name_identity_pkey', 'patch_company_name_identity', 'p', NULL::text, ' ', ' '),
      ('patch_company_name_identity_company_id_fkey', 'patch_company_name_identity', 'f', 'patch_company', 'c', 'a'),
      ('patch_company_name_identity_confirmed_by_user_id_fkey', 'patch_company_name_identity', 'f', 'user', 'n', 'a')
    ) AS contract(constraint_name, table_name, constraint_type, referenced_table, delete_action, update_action)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.conname = constraint_contract.constraint_name
        AND constraint_row.conrelid = to_regclass(format('public.%I', constraint_contract.table_name))
        AND constraint_row.contype::text = constraint_contract.constraint_type
        AND (
          constraint_contract.constraint_type <> 'f'
          OR (
            constraint_row.confrelid = to_regclass(format('public.%I', constraint_contract.referenced_table))
            AND constraint_row.confdeltype::text = constraint_contract.delete_action
            AND constraint_row.confupdtype::text = constraint_contract.update_action
          )
        )
    ) THEN
      RAISE EXCEPTION 'company identity rollback postflight failed: Phase A constraint % mismatch', constraint_contract.constraint_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_company'
      AND column_name = 'normalized_name'
      AND data_type = 'character varying'
      AND character_maximum_length = 107
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: normalized_name is not nullable VARCHAR(107)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_am access_method
      ON access_method.oid = index_relation.relam
    JOIN pg_opclass operator_class
      ON operator_class.oid = index_row.indclass[0]
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_row.indrelid
     AND attribute_row.attname = 'normalized_name'
    WHERE index_row.indexrelid = to_regclass('public.patch_company_normalized_name_idx')
      AND index_row.indrelid = 'public.patch_company'::regclass
      AND NOT index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indnkeyatts = 1
      AND index_row.indkey[0] = attribute_row.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND access_method.amname = 'btree'
      AND operator_class.opcname = 'text_ops'
  ) THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: Phase A normalized index mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_am access_method
      ON access_method.oid = index_relation.relam
    JOIN pg_opclass source_operator_class
      ON source_operator_class.oid = index_row.indclass[0]
    JOIN pg_opclass external_operator_class
      ON external_operator_class.oid = index_row.indclass[1]
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = index_row.indrelid
     AND source_attribute.attname = 'source'
    JOIN pg_attribute external_attribute
      ON external_attribute.attrelid = index_row.indrelid
     AND external_attribute.attname = 'external_id'
    WHERE index_row.indexrelid = to_regclass('public.patch_company_external_id_source_external_id_idx')
      AND index_row.indrelid = 'public.patch_company_external_id'::regclass
      AND NOT index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indnkeyatts = 2
      AND index_row.indkey[0] = source_attribute.attnum
      AND index_row.indkey[1] = external_attribute.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND access_method.amname = 'btree'
      AND source_operator_class.opcname = 'text_ops'
      AND external_operator_class.opcname = 'text_ops'
  ) THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: Phase A external index mismatch';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_key') IS NOT NULL
    OR to_regclass('public.patch_company_external_id_source_external_id_key') IS NOT NULL THEN
    RAISE EXCEPTION 'company identity rollback postflight failed: Phase B unique indexes remain';
  END IF;
END
$postflight$;

COMMIT;
