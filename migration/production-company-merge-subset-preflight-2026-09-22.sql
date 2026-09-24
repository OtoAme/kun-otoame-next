-- Read-only preflight for company-merge subset columns (2026-09-22).
-- Run this BEFORE sync-a. The pending-key table does not exist yet; this file
-- only reads company_merge_suggestion and computes the member_key sync-b would
-- write. It does not add columns, backfill, or delete rows.
--
-- Resume point: this script never writes. Re-run it as many times as needed.
-- Stop the rollout if it raises. Do not continue to sync-a.
--
-- member_key matches validations/companyMerges.ts toMemberKey: distinct
-- positive ids, numeric ascending, comma-joined. Empty, illegal, too-short,
-- and over-512 keys fail and are listed. Duplicate pending keys fail and are
-- listed. Nothing is deleted or truncated.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $preflight_member_key$
DECLARE
  bad_rows text;
  duplicate_keys text;
BEGIN
  IF to_regclass('public.company_merge_suggestion') IS NULL THEN
    RAISE EXCEPTION
      'company merge subset preflight failed: public.company_merge_suggestion does not exist; run the 2026-09-17 sync first';
  END IF;

  WITH member_ids AS (
    SELECT
      suggestion.id,
      suggestion.status,
      ARRAY(
        SELECT DISTINCT id_value
        FROM unnest(
          ARRAY[suggestion.target_company_id]
          || COALESCE(suggestion.source_company_ids, ARRAY[]::integer[])
        ) AS id_value
        WHERE id_value IS NOT NULL
          AND id_value > 0
        ORDER BY id_value
      ) AS ids,
      EXISTS (
        SELECT 1
        FROM unnest(
          ARRAY[suggestion.target_company_id]
          || COALESCE(suggestion.source_company_ids, ARRAY[]::integer[])
        ) AS id_value
        WHERE id_value IS NULL
          OR id_value <= 0
      ) AS has_illegal_id
    FROM public.company_merge_suggestion AS suggestion
  ),
  computed AS (
    SELECT
      member_ids.id,
      member_ids.status,
      member_ids.has_illegal_id,
      cardinality(member_ids.ids) AS id_count,
      array_to_string(member_ids.ids, ',') AS member_key
    FROM member_ids
  ),
  illegal AS (
    SELECT
      computed.id,
      CASE
        WHEN computed.has_illegal_id THEN 'illegal-id'
        WHEN computed.id_count < 2 OR computed.member_key = '' THEN 'too-few'
        WHEN char_length(computed.member_key) > 512 THEN 'too-long'
        ELSE 'ok'
      END AS reason,
      computed.member_key
    FROM computed
  )
  SELECT string_agg(
    format('#%s %s [%s]', illegal.id, illegal.reason, illegal.member_key),
    ', ' ORDER BY illegal.id
  )
  INTO bad_rows
  FROM illegal
  WHERE illegal.reason <> 'ok';

  IF bad_rows IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset preflight failed: illegal member_key rows: %',
      bad_rows;
  END IF;

  WITH member_ids AS (
    SELECT
      suggestion.id,
      suggestion.status,
      ARRAY(
        SELECT DISTINCT id_value
        FROM unnest(
          ARRAY[suggestion.target_company_id]
          || COALESCE(suggestion.source_company_ids, ARRAY[]::integer[])
        ) AS id_value
        WHERE id_value IS NOT NULL
          AND id_value > 0
        ORDER BY id_value
      ) AS ids
    FROM public.company_merge_suggestion AS suggestion
    WHERE suggestion.status = 'pending'
  ),
  computed AS (
    SELECT array_to_string(member_ids.ids, ',') AS member_key
    FROM member_ids
  )
  SELECT string_agg(duplicate.member_key, ', ' ORDER BY duplicate.member_key)
  INTO duplicate_keys
  FROM (
    SELECT computed.member_key
    FROM computed
    GROUP BY computed.member_key
    HAVING COUNT(*) > 1
  ) AS duplicate;

  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset preflight failed: duplicate pending member_key: %',
      duplicate_keys;
  END IF;
END
$preflight_member_key$;

COMMIT;
