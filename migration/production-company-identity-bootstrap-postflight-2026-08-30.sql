-- Independent read-only verification for the Phase A company identity schema.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

WITH required_columns(
  table_name,
  column_name,
  expected_type,
  expected_nullable,
  expected_length,
  expected_precision,
  default_policy
) AS (
  VALUES
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
), existing AS (
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    character_maximum_length,
    datetime_precision,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'required_column' AS check_type,
  required.table_name,
  required.column_name,
  CASE
    WHEN existing.column_name IS NULL THEN 'missing'
    WHEN existing.data_type <> required.expected_type
      OR existing.is_nullable <> required.expected_nullable
      OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
      OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
      OR (required.default_policy = 'required' AND existing.column_default IS NULL)
      OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL)
      THEN CASE
        WHEN required.column_name = 'updated' AND existing.column_default IS NOT NULL
          THEN 'unexpected_updated_default'
        ELSE 'definition_mismatch'
      END
    ELSE 'ok'
  END AS status,
  existing.data_type AS actual_type,
  existing.is_nullable AS actual_nullable,
  existing.character_maximum_length AS actual_length,
  existing.datetime_precision AS actual_precision,
  existing.column_default
FROM required_columns required
LEFT JOIN existing
  ON existing.table_name = required.table_name
 AND existing.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

WITH required_indexes(index_name) AS (
  VALUES
    ('patch_company_normalized_name_idx'),
    ('patch_company_external_id_company_id_idx'),
    ('patch_company_external_id_source_external_id_idx'),
    ('patch_company_name_identity_company_id_idx'),
    ('patch_company_name_identity_confirmed_by_user_id_idx'),
    ('patch_company_name_identity_normalized_value_idx'),
    ('patch_company_name_identity_company_kind_value_key')
)
SELECT
  'required_index' AS check_type,
  required.index_name,
  CASE
    WHEN to_regclass(format('public.%I', required.index_name)) IS NULL THEN 'missing'
    ELSE 'present_definition_checked_below'
  END AS status,
  pg_get_indexdef(to_regclass(format('public.%I', required.index_name))) AS definition
FROM required_indexes required
ORDER BY required.index_name;

WITH required_constraints(constraint_name) AS (
  VALUES
    ('patch_company_external_id_pkey'),
    ('patch_company_external_id_company_id_fkey'),
    ('patch_company_name_identity_pkey'),
    ('patch_company_name_identity_company_id_fkey'),
    ('patch_company_name_identity_confirmed_by_user_id_fkey')
)
SELECT
  'required_constraint' AS check_type,
  required.constraint_name,
  CASE WHEN constraint_row.oid IS NULL THEN 'missing' ELSE 'present' END AS status,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM required_constraints required
LEFT JOIN pg_constraint constraint_row
  ON constraint_row.conname = required.constraint_name
ORDER BY required.constraint_name;

SELECT
  'phase_a_boundary' AS check_type,
  'normalized_name' AS identity,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_row.indrelid
     AND attribute_row.attname = 'normalized_name'
    WHERE index_row.indrelid = 'public.patch_company'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND index_row.indkey[0] = attribute_row.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
  ) THEN 'unexpected_global_unique' ELSE 'ok' END AS status
UNION ALL
SELECT
  'phase_a_boundary',
  'source_external_id',
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = index_row.indrelid
     AND source_attribute.attname = 'source'
    JOIN pg_attribute external_attribute
      ON external_attribute.attrelid = index_row.indrelid
     AND external_attribute.attname = 'external_id'
    WHERE index_row.indrelid = 'public.patch_company_external_id'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 2
      AND index_row.indkey[0] = source_attribute.attnum
      AND index_row.indkey[1] = external_attribute.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
  ) THEN 'unexpected_global_unique' ELSE 'ok' END;

DO $postflight$
DECLARE
  mismatch_count integer := 0;
  index_contract record;
  constraint_contract record;
BEGIN
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
    RAISE EXCEPTION 'company identity bootstrap postflight failed: column mismatches=%', mismatch_count;
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
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
        AND replace(replace(
          substring(pg_get_indexdef(index_row.indexrelid) FROM '\((.*)\)$'),
          '"', ''
        ), ' ', '') = index_contract.expected_columns
    ) THEN
      RAISE EXCEPTION 'company identity bootstrap postflight failed: index % mismatch', index_contract.index_name;
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
      RAISE EXCEPTION 'company identity bootstrap postflight failed: constraint % mismatch', constraint_contract.constraint_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_row.indrelid
     AND attribute_row.attname = 'normalized_name'
    WHERE index_row.indrelid = 'public.patch_company'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND index_row.indkey[0] = attribute_row.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = index_row.indrelid
     AND source_attribute.attname = 'source'
    JOIN pg_attribute external_attribute
      ON external_attribute.attrelid = index_row.indrelid
     AND external_attribute.attname = 'external_id'
    WHERE index_row.indrelid = 'public.patch_company_external_id'::regclass
      AND index_row.indisunique
      AND index_row.indnkeyatts = 2
      AND index_row.indkey[0] = source_attribute.attnum
      AND index_row.indkey[1] = external_attribute.attnum
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
  ) THEN
    RAISE EXCEPTION 'company identity bootstrap postflight failed: unexpected_global_unique';
  END IF;
END
$postflight$;

COMMIT;
