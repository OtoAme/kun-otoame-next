-- sync-b: backfill member_key and safe source-pair candidate_key (2026-09-22).
-- Run sync-a first. Columns are still nullable. This file does not create
-- company_merge_pending_key and does not SET NOT NULL.
--
-- Resume point: re-running recomputes member_key from the company ids (same
-- rule as toMemberKey) and fills candidate_key only when evidence is
-- source-pair with a numeric patchId and a non-empty upstreamIds array.
-- Rows missing those evidence fields keep candidate_key unchanged (null on
-- the first run). Overlong candidate keys are left null; they are not
-- truncated. Illegal member keys raise and roll this transaction back.
--
-- Upstream ids are sorted by UTF-8 bytes so the string matches
-- toCandidateKey's code-unit order for BMP ids.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $sync_b_guard$
DECLARE
  bad_rows text;
BEGIN
  WITH member_ids AS (
    SELECT
      suggestion.id,
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
      member_ids.has_illegal_id,
      cardinality(member_ids.ids) AS id_count,
      array_to_string(member_ids.ids, ',') AS member_key
    FROM member_ids
  )
  SELECT string_agg(
    format(
      '#%s %s [%s]',
      computed.id,
      CASE
        WHEN computed.has_illegal_id THEN 'illegal-id'
        WHEN computed.id_count < 2 OR computed.member_key = '' THEN 'too-few'
        ELSE 'too-long'
      END,
      computed.member_key
    ),
    ', ' ORDER BY computed.id
  )
  INTO bad_rows
  FROM computed
  WHERE computed.has_illegal_id
     OR computed.id_count < 2
     OR computed.member_key = ''
     OR char_length(computed.member_key) > 512;

  IF bad_rows IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset sync-b failed: illegal member_key rows: %',
      bad_rows;
  END IF;
END
$sync_b_guard$;

WITH member_ids AS (
  SELECT
    suggestion.id,
    suggestion.evidence,
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
),
candidate AS (
  SELECT
    member_ids.id,
    CASE
      WHEN member_ids.evidence->>'kind' = 'source-pair'
        AND jsonb_typeof(member_ids.evidence->'upstreamIds') = 'array'
        AND jsonb_typeof(member_ids.evidence->'patchId') = 'number'
        AND (member_ids.evidence->>'patchId') ~ '^[1-9][0-9]*$'
      THEN (
        SELECT
          CASE
            WHEN upstream.assembled IS NULL THEN NULL
            WHEN char_length(upstream.assembled) > 512 THEN NULL
            ELSE upstream.assembled
          END
        FROM (
          SELECT
            'source-pair|'
            || string_agg(
              unique_upstream.upstream_id,
              ',' ORDER BY convert_to(unique_upstream.upstream_id, 'UTF8')
            )
            || '|patch:'
            || (member_ids.evidence->>'patchId') AS assembled
          FROM (
            SELECT DISTINCT btrim(item.value) AS upstream_id
            FROM jsonb_array_elements_text(member_ids.evidence->'upstreamIds')
              AS item(value)
            WHERE btrim(item.value) <> ''
          ) AS unique_upstream
        ) AS upstream
      )
      ELSE NULL
    END AS candidate_key
  FROM member_ids
),
computed AS (
  SELECT
    member_ids.id,
    array_to_string(member_ids.ids, ',') AS member_key,
    candidate.candidate_key
  FROM member_ids
  JOIN candidate ON candidate.id = member_ids.id
)
UPDATE public.company_merge_suggestion AS suggestion
SET
  member_key = computed.member_key,
  candidate_key = COALESCE(computed.candidate_key, suggestion.candidate_key)
FROM computed
WHERE suggestion.id = computed.id
  AND (
    suggestion.member_key IS DISTINCT FROM computed.member_key
    OR (
      computed.candidate_key IS NOT NULL
      AND suggestion.candidate_key IS DISTINCT FROM computed.candidate_key
    )
  );

COMMIT;
