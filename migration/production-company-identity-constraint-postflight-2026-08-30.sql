-- Independent read-only verification for Phase B company identity constraints.

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
      AND is_nullable = 'NO'
      THEN 'ok'
    ELSE 'definition_mismatch'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch_company'
  AND column_name = 'normalized_name';

WITH target_indexes(index_name) AS (
  VALUES
    ('patch_company_normalized_name_key'),
    ('patch_company_external_id_source_external_id_key')
)
SELECT
  'required_unique_index' AS check_type,
  target.index_name,
  CASE
    WHEN to_regclass(format('public.%I', target.index_name)) IS NULL THEN 'missing'
    ELSE 'present_definition_checked_below'
  END AS status,
  pg_get_indexdef(to_regclass(format('public.%I', target.index_name))) AS definition
FROM target_indexes target
ORDER BY target.index_name;

WITH blockers AS (
  SELECT
    (SELECT COUNT(*)
     FROM public.patch_company
     WHERE normalized_name IS NULL OR btrim(normalized_name) = '') AS missing_names,
    (SELECT COUNT(*)
     FROM (
       SELECT normalized_name
       FROM public.patch_company
       GROUP BY normalized_name
       HAVING COUNT(*) > 1
     ) collisions) AS name_collision_groups,
    (SELECT COUNT(*)
     FROM (
       SELECT source, external_id
       FROM public.patch_company_external_id
       GROUP BY source, external_id
       HAVING COUNT(*) > 1
     ) collisions) AS external_collision_groups
)
SELECT
  'blocking_inventory' AS check_type,
  missing_names,
  name_collision_groups,
  external_collision_groups,
  CASE
    WHEN missing_names = 0
      AND name_collision_groups = 0
      AND external_collision_groups = 0
      THEN 'ok'
    ELSE 'blocking'
  END AS status
FROM blockers;

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

DO $postflight$
DECLARE
  blocker_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_company'
      AND column_name = 'normalized_name'
      AND data_type = 'character varying'
      AND character_maximum_length = 107
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'company identity constraint postflight failed: normalized_name is not VARCHAR(107) NOT NULL';
  END IF;

  IF NOT EXISTS (
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
    RAISE EXCEPTION 'company identity constraint postflight failed: normalized name unique index mismatch';
  END IF;

  IF NOT EXISTS (
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
    RAISE EXCEPTION 'company identity constraint postflight failed: external identity unique index mismatch';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_idx') IS NOT NULL
    OR to_regclass('public.patch_company_external_id_source_external_id_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'company identity constraint postflight failed: Phase A indexes still exist';
  END IF;

  SELECT COUNT(*)
  INTO blocker_count
  FROM public.patch_company
  WHERE normalized_name IS NULL OR btrim(normalized_name) = '';
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'company identity constraint postflight failed: missing normalized names=%', blocker_count;
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
    RAISE EXCEPTION 'company identity constraint postflight failed: normalized name collision groups=%', blocker_count;
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
    RAISE EXCEPTION 'company identity constraint postflight failed: external identity collision groups=%', blocker_count;
  END IF;
END
$postflight$;

COMMIT;
