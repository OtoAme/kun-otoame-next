-- Read-only second preflight (2026-09-22), after sync-b and before sync-c.
-- If this file raises, stop. Do not SET member_key NOT NULL and do not create
-- company_merge_pending_key.
--
-- Resume point: read-only. Re-run until it commits, then run sync-c.
-- Checks empty member_key values and more than one pending row per
-- member_key. Lists the keys. Does not delete or truncate.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $preflight_2$
DECLARE
  empty_rows text;
  duplicate_keys text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_merge_suggestion'
      AND column_name = 'member_key'
  ) THEN
    RAISE EXCEPTION
      'company merge subset preflight-2 failed: member_key column is missing; run sync-a and sync-b first';
  END IF;

  SELECT string_agg(suggestion.id::text, ', ' ORDER BY suggestion.id)
  INTO empty_rows
  FROM public.company_merge_suggestion AS suggestion
  WHERE suggestion.member_key IS NULL
     OR btrim(suggestion.member_key) = ''
     OR char_length(suggestion.member_key) > 512;

  IF empty_rows IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset preflight-2 failed: empty or overlong member_key rows: %',
      empty_rows;
  END IF;

  SELECT string_agg(duplicate.member_key, ', ' ORDER BY duplicate.member_key)
  INTO duplicate_keys
  FROM (
    SELECT suggestion.member_key
    FROM public.company_merge_suggestion AS suggestion
    WHERE suggestion.status = 'pending'
    GROUP BY suggestion.member_key
    HAVING COUNT(*) > 1
  ) AS duplicate;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset preflight-2 failed: duplicate pending member_key: %',
      duplicate_keys;
  END IF;
END
$preflight_2$;

COMMIT;
