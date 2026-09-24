-- Read-only postflight for company-merge subset columns (2026-09-22).
-- Run after sync-c. Checks each pending-key row, not only counts.
-- member_key must be NOT NULL. Failures list the suggestion ids or keys.
--
-- Resume point: read-only. Re-run after any repair. Do not treat a count
-- match alone as success.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $postflight_subset$
DECLARE
  nullable_member_key text;
  dangling_keys text;
  mismatched_keys text;
  pending_without_key text;
  non_pending_with_key text;
  delete_action "char";
  update_action "char";
BEGIN
  SELECT columns.is_nullable
  INTO nullable_member_key
  FROM information_schema.columns AS columns
  WHERE columns.table_schema = 'public'
    AND columns.table_name = 'company_merge_suggestion'
    AND columns.column_name = 'member_key';

  IF nullable_member_key IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: member_key must be NOT NULL';
  END IF;

  IF to_regclass('public.company_merge_pending_key') IS NULL THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: company_merge_pending_key is missing';
  END IF;

  SELECT constraint_row.confdeltype, constraint_row.confupdtype
  INTO delete_action, update_action
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conname = 'company_merge_pending_key_suggestion_id_fkey'
    AND constraint_row.conrelid = 'public.company_merge_pending_key'::regclass;

  -- 'r' is ON DELETE RESTRICT. 'c' is ON UPDATE CASCADE, Prisma's default
  -- when onUpdate is omitted.
  IF delete_action IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: pending-key foreign key must use RESTRICT, got %',
      delete_action;
  END IF;

  IF update_action IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: pending-key foreign key confupdtype must be c, got %',
      update_action;
  END IF;

  SELECT string_agg(pending_key.member_key, ', ' ORDER BY pending_key.member_key)
  INTO dangling_keys
  FROM public.company_merge_pending_key AS pending_key
  LEFT JOIN public.company_merge_suggestion AS suggestion
    ON suggestion.id = pending_key.suggestion_id
  WHERE suggestion.id IS NULL;

  IF dangling_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: pending-key without a suggestion: %',
      dangling_keys;
  END IF;

  SELECT string_agg(
    format('#%s key=%s row=%s status=%s', suggestion.id, pending_key.member_key, suggestion.member_key, suggestion.status),
    ', ' ORDER BY suggestion.id
  )
  INTO mismatched_keys
  FROM public.company_merge_pending_key AS pending_key
  JOIN public.company_merge_suggestion AS suggestion
    ON suggestion.id = pending_key.suggestion_id
  WHERE suggestion.status <> 'pending'
     OR suggestion.member_key <> pending_key.member_key;

  IF mismatched_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: pending-key does not match a pending suggestion member_key: %',
      mismatched_keys;
  END IF;

  SELECT string_agg(suggestion.id::text, ', ' ORDER BY suggestion.id)
  INTO pending_without_key
  FROM public.company_merge_suggestion AS suggestion
  WHERE suggestion.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_merge_pending_key AS pending_key
      WHERE pending_key.suggestion_id = suggestion.id
        AND pending_key.member_key = suggestion.member_key
    );

  IF pending_without_key IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: pending suggestion without its pending-key: %',
      pending_without_key;
  END IF;

  SELECT string_agg(suggestion.id::text, ', ' ORDER BY suggestion.id)
  INTO non_pending_with_key
  FROM public.company_merge_suggestion AS suggestion
  JOIN public.company_merge_pending_key AS pending_key
    ON pending_key.suggestion_id = suggestion.id
  WHERE suggestion.status <> 'pending';

  IF non_pending_with_key IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: non-pending suggestion still has a pending-key: %',
      non_pending_with_key;
  END IF;

  IF EXISTS (
    SELECT pending_key.suggestion_id
    FROM public.company_merge_pending_key AS pending_key
    GROUP BY pending_key.suggestion_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'company merge subset postflight failed: a suggestion has more than one pending-key';
  END IF;
END
$postflight_subset$;

COMMIT;
