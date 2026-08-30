-- Phase B company identity constraints. Run only after the final maintenance
-- inventory is clean and company-relation writes are paused.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

DO $ready$
DECLARE
  blocker_count integer;
BEGIN
  IF to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_company_external_id') IS NULL THEN
    RAISE EXCEPTION 'company identity constraint sync requires Phase A tables';
  END IF;

  SELECT COUNT(*)
  INTO blocker_count
  FROM public.patch_company
  WHERE normalized_name IS NULL OR btrim(normalized_name) = '';
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'company identity constraint sync blocked: missing normalized names=%; run the identity backfill first', blocker_count;
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
    RAISE EXCEPTION 'company identity constraint sync blocked: normalized name collision groups=%', blocker_count;
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
    RAISE EXCEPTION 'company identity constraint sync blocked: external identity collision groups=%', blocker_count;
  END IF;
END
$ready$;

ALTER TABLE public.patch_company
  ALTER COLUMN normalized_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patch_company_normalized_name_key
  ON public.patch_company (normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_key
  ON public.patch_company_external_id (source, external_id);

DROP INDEX IF EXISTS public.patch_company_normalized_name_idx;
DROP INDEX IF EXISTS public.patch_company_external_id_source_external_id_idx;

DO $postcondition$
BEGIN
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
    RAISE EXCEPTION 'company identity constraint sync failed: normalized name unique index mismatch';
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
    RAISE EXCEPTION 'company identity constraint sync failed: external identity unique index mismatch';
  END IF;
END
$postcondition$;

COMMIT;
