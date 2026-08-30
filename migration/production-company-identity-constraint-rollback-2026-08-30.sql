-- Idempotent emergency rollback from Phase B identity constraints to the
-- Phase A query-index contract. Keep relation writes paused while this runs.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

DO $precondition$
BEGIN
  IF to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_company_external_id') IS NULL
    OR to_regclass('public.patch_company_name_identity') IS NULL THEN
    RAISE EXCEPTION 'company identity constraint rollback requires the Phase A identity schema';
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
    RAISE EXCEPTION 'company identity constraint rollback failed: normalized_name column mismatch';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_key') IS NOT NULL
    AND NOT EXISTS (
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
      WHERE index_row.indexrelid = to_regclass('public.patch_company_normalized_name_key')
        AND index_row.indrelid = 'public.patch_company'::regclass
        AND index_row.indisunique
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indnkeyatts = 1
        AND index_row.indkey[0] = attribute_row.attnum
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
        AND access_method.amname = 'btree'
        AND operator_class.opcname = 'text_ops'
    ) THEN
    RAISE EXCEPTION 'company identity constraint rollback refused: normalized name unique index mismatch';
  END IF;

  IF to_regclass('public.patch_company_external_id_source_external_id_key') IS NOT NULL
    AND NOT EXISTS (
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
        AND access_method.amname = 'btree'
        AND source_operator_class.opcname = 'text_ops'
        AND external_operator_class.opcname = 'text_ops'
    ) THEN
    RAISE EXCEPTION 'company identity constraint rollback refused: external identity unique index mismatch';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_idx') IS NOT NULL
    AND NOT EXISTS (
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
    RAISE EXCEPTION 'company identity constraint rollback refused: Phase A normalized index mismatch';
  END IF;

  IF to_regclass('public.patch_company_external_id_source_external_id_idx') IS NOT NULL
    AND NOT EXISTS (
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
    RAISE EXCEPTION 'company identity constraint rollback refused: Phase A external index mismatch';
  END IF;
END
$precondition$;

CREATE INDEX IF NOT EXISTS patch_company_normalized_name_idx
  ON public.patch_company (normalized_name);

CREATE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_idx
  ON public.patch_company_external_id (source, external_id);

DROP INDEX IF EXISTS public.patch_company_normalized_name_key;
DROP INDEX IF EXISTS public.patch_company_external_id_source_external_id_key;

ALTER TABLE public.patch_company
  ALTER COLUMN normalized_name DROP NOT NULL;

DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_company'
      AND column_name = 'normalized_name'
      AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'company identity constraint rollback failed: normalized_name is still NOT NULL';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_key') IS NOT NULL
    OR to_regclass('public.patch_company_external_id_source_external_id_key') IS NOT NULL THEN
    RAISE EXCEPTION 'company identity constraint rollback failed: Phase B unique indexes remain';
  END IF;

  IF to_regclass('public.patch_company_normalized_name_idx') IS NULL
    OR to_regclass('public.patch_company_external_id_source_external_id_idx') IS NULL THEN
    RAISE EXCEPTION 'company identity constraint rollback failed: Phase A query indexes are missing';
  END IF;
END
$postcondition$;

COMMIT;
