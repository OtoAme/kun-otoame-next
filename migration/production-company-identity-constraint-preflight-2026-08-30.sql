-- Read-only Phase B inventory. Blocking data must be resolved while writes are
-- paused; cross-company shared aliases are warnings and remain representable.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'normalized_name_column' AS check_type,
  required.column_name,
  existing.data_type,
  existing.character_maximum_length,
  existing.is_nullable,
  CASE
    WHEN existing.column_name IS NULL THEN 'missing'
    WHEN existing.data_type <> 'character varying'
      OR existing.character_maximum_length <> 107
      THEN 'definition_mismatch'
    WHEN existing.is_nullable = 'YES' THEN 'ready_for_not_null'
    ELSE 'not_null_present'
  END AS status
FROM (VALUES ('normalized_name')) required(column_name)
LEFT JOIN information_schema.columns existing
  ON existing.table_schema = 'public'
 AND existing.table_name = 'patch_company'
 AND existing.column_name = required.column_name;

SELECT
  'missing_normalized_name' AS check_type,
  COUNT(*) AS row_count,
  CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'blocking' END AS status
FROM public.patch_company
WHERE normalized_name IS NULL OR btrim(normalized_name) = '';

SELECT
  'normalized_name_collision' AS check_type,
  normalized_name,
  COUNT(*) AS row_count,
  array_agg(id ORDER BY id) AS company_ids,
  array_agg(name ORDER BY id) AS company_names,
  'blocking' AS status
FROM public.patch_company
WHERE normalized_name IS NOT NULL
GROUP BY normalized_name
HAVING COUNT(*) > 1
ORDER BY normalized_name;

SELECT
  'external_identity_collision' AS check_type,
  source,
  external_id,
  COUNT(*) AS row_count,
  array_agg(company_id ORDER BY company_id) AS company_ids,
  'blocking' AS status
FROM public.patch_company_external_id
GROUP BY source, external_id
HAVING COUNT(*) > 1
ORDER BY source, external_id;

SELECT
  'shared_alias' AS check_type,
  normalized_value,
  COUNT(DISTINCT company_id) AS company_count,
  array_agg(DISTINCT company_id ORDER BY company_id) AS company_ids,
  'warning' AS status
FROM public.patch_company_name_identity
WHERE kind = 'alias'
GROUP BY normalized_value
HAVING COUNT(DISTINCT company_id) > 1
ORDER BY normalized_value;

WITH target_indexes(index_name) AS (
  VALUES
    ('patch_company_normalized_name_key'),
    ('patch_company_external_id_source_external_id_key'),
    ('patch_company_normalized_name_idx'),
    ('patch_company_external_id_source_external_id_idx')
)
SELECT
  'identity_index' AS check_type,
  target.index_name,
  CASE
    WHEN to_regclass(format('public.%I', target.index_name)) IS NULL THEN 'missing'
    ELSE 'present_definition_checked_below'
  END AS status,
  pg_get_indexdef(to_regclass(format('public.%I', target.index_name))) AS definition
FROM target_indexes target
ORDER BY target.index_name;

DO $preflight$
DECLARE
  blocker_count integer;
BEGIN
  IF to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_company_external_id') IS NULL
    OR to_regclass('public.patch_company_name_identity') IS NULL THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: Phase A table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_company'
      AND column_name = 'normalized_name'
      AND data_type = 'character varying'
      AND character_maximum_length = 107
  ) THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: normalized_name column mismatch';
  END IF;

  SELECT COUNT(*)
  INTO blocker_count
  FROM public.patch_company
  WHERE normalized_name IS NULL OR btrim(normalized_name) = '';
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'company identity constraint preflight blocked: missing normalized names=%', blocker_count;
  END IF;

  SELECT COUNT(*)
  INTO blocker_count
  FROM (
    SELECT normalized_name
    FROM public.patch_company
    GROUP BY normalized_name
    HAVING COUNT(*) > 1
  ) collisions;
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'company identity constraint preflight blocked: normalized name collision groups=%', blocker_count;
  END IF;

  SELECT COUNT(*)
  INTO blocker_count
  FROM (
    SELECT source, external_id
    FROM public.patch_company_external_id
    GROUP BY source, external_id
    HAVING COUNT(*) > 1
  ) collisions;
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'company identity constraint preflight blocked: external identity collision groups=%', blocker_count;
  END IF;

  IF to_regclass('public.patch_company_normalized_name_key') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_row
      JOIN pg_attribute attribute_row
        ON attribute_row.attrelid = index_row.indrelid
       AND attribute_row.attname = 'normalized_name'
      WHERE index_row.indexrelid = to_regclass('public.patch_company_normalized_name_key')
        AND index_row.indrelid = 'public.patch_company'::regclass
        AND index_row.indisunique
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indnkeyatts = 1
        AND index_row.indkey[0] = attribute_row.attnum
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
    ) THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: normalized name target index mismatch';
  END IF;

  IF to_regclass('public.patch_company_external_id_source_external_id_key') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_row
      JOIN pg_attribute source_attribute
        ON source_attribute.attrelid = index_row.indrelid
       AND source_attribute.attname = 'source'
      JOIN pg_attribute external_attribute
        ON external_attribute.attrelid = index_row.indrelid
       AND external_attribute.attname = 'external_id'
      WHERE index_row.indexrelid = to_regclass('public.patch_company_external_id_source_external_id_key')
        AND index_row.indrelid = 'public.patch_company_external_id'::regclass
        AND index_row.indisunique
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indnkeyatts = 2
        AND index_row.indkey[0] = source_attribute.attnum
        AND index_row.indkey[1] = external_attribute.attnum
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
    ) THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: external identity target index mismatch';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_idx') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_row
      JOIN pg_attribute attribute_row
        ON attribute_row.attrelid = index_row.indrelid
       AND attribute_row.attname = 'normalized_name'
      WHERE index_row.indexrelid = to_regclass('public.patch_company_normalized_name_idx')
        AND index_row.indrelid = 'public.patch_company'::regclass
        AND NOT index_row.indisunique
        AND index_row.indnkeyatts = 1
        AND index_row.indkey[0] = attribute_row.attnum
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
    ) THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: Phase A normalized index cannot be safely removed';
  END IF;

  IF to_regclass('public.patch_company_external_id_source_external_id_idx') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index index_row
      JOIN pg_attribute source_attribute
        ON source_attribute.attrelid = index_row.indrelid
       AND source_attribute.attname = 'source'
      JOIN pg_attribute external_attribute
        ON external_attribute.attrelid = index_row.indrelid
       AND external_attribute.attname = 'external_id'
      WHERE index_row.indexrelid = to_regclass('public.patch_company_external_id_source_external_id_idx')
        AND index_row.indrelid = 'public.patch_company_external_id'::regclass
        AND NOT index_row.indisunique
        AND index_row.indnkeyatts = 2
        AND index_row.indkey[0] = source_attribute.attnum
        AND index_row.indkey[1] = external_attribute.attnum
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
    ) THEN
    RAISE EXCEPTION 'company identity constraint preflight failed: Phase A external index cannot be safely removed';
  END IF;
END
$preflight$;

COMMIT;
