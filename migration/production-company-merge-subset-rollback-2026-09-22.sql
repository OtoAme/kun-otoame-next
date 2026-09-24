-- Rollback for the 2026-09-22 company-merge subset rollout.
-- Inverse order: sync-c (table, indexes, NOT NULL), then the sync-b values
-- disappear with the sync-a columns. Run only when abandoning the subset
-- columns. This deletes every backfilled member_key, candidate_key, subset
-- result, and pending-key row.
--
-- Resume point: each step is conditional. Re-run after an interrupt. If
-- member_key is already gone, the NOT NULL and column drops are skipped.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.company_merge_pending_key;

DROP INDEX IF EXISTS public.company_merge_suggestion_member_key_status_idx;
DROP INDEX IF EXISTS public.company_merge_suggestion_candidate_key_status_idx;

DO $rollback_subset_columns$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'member_key'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion ALTER COLUMN member_key DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'selected_company_ids'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN selected_company_ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'applied_source_company_ids'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN applied_source_company_ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'applied_target_company_id'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN applied_target_company_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'member_key'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN member_key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'candidate_key'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN candidate_key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'resolution_source'
  ) THEN
    EXECUTE
      'ALTER TABLE public.company_merge_suggestion DROP COLUMN resolution_source';
  END IF;
END
$rollback_subset_columns$;

COMMIT;
