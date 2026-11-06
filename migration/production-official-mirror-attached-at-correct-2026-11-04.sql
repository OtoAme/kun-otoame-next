-- Limited attached_at correction. Changes only rows recorded in
-- patch_resource_link_attached_at_fill whose current attached_at is still the
-- value written for that row. Rows edited after the backfill are counted and
-- left untouched. The same decision variables as the sync are required.
-- A group larger than 50 still needs an explicit confirm or reject. This does
-- not clear attached_at and does not rewrite rows outside the manifest.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('otoame.stamp_confirmed', :'stamp_confirmed', true);
SELECT set_config('otoame.stamp_rejected', :'stamp_rejected', true);
SELECT set_config('otoame.small_stamp_review', :'small_stamp_review', true);

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.patch_resource IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_resource_link IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_resource_link_attached_at_fill IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE otoame_stamp_decision (
  created TIMESTAMP(3) WITHOUT TIME ZONE PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('confirm', 'reject'))
) ON COMMIT DROP;

DO $decisions$
DECLARE
  confirmed text := current_setting('otoame.stamp_confirmed', true);
  rejected text := current_setting('otoame.stamp_rejected', true);
  review text := current_setting('otoame.small_stamp_review', true);
BEGIN
  IF confirmed IS NULL OR btrim(confirmed) = ''
     OR rejected IS NULL OR btrim(rejected) = ''
     OR review IS DISTINCT FROM 'acknowledged' THEN
    RAISE EXCEPTION
      'stamp_confirmed, stamp_rejected, and small_stamp_review=acknowledged are required';
  END IF;

  INSERT INTO otoame_stamp_decision (created, decision)
  SELECT btrim(token)::timestamp(3) without time zone, decision
  FROM (
    SELECT token, 'confirm' AS decision
    FROM unnest(string_to_array(confirmed, ',')) AS token
    UNION ALL
    SELECT token, 'reject'
    FROM unnest(string_to_array(rejected, ',')) AS token
  ) AS listed
  WHERE btrim(token) <> '' AND lower(btrim(token)) <> 'none';
END
$decisions$;

DO $known$
DECLARE
  undecided integer;
  unknown_decision integer;
BEGIN
  SELECT count(*)
  INTO undecided
  FROM (
    SELECT created
    FROM public.patch_resource_link
    GROUP BY created
    HAVING count(*) > 50
  ) AS candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM otoame_stamp_decision AS decision
    WHERE decision.created = candidate.created
  );
  IF undecided <> 0 THEN
    RAISE EXCEPTION
      '% link created groups have more than 50 rows and no explicit stamp decision',
      undecided;
  END IF;

  SELECT count(*)
  INTO unknown_decision
  FROM otoame_stamp_decision AS decision
  WHERE NOT EXISTS (
    SELECT 1 FROM public.patch_resource_link AS link
    WHERE link.created = decision.created
  );
  IF unknown_decision <> 0 THEN
    RAISE EXCEPTION
      '% stamp decisions match no link created value', unknown_decision;
  END IF;
END
$known$;

WITH desired AS (
  SELECT
    fill.link_id,
    fill.filled_value AS previous_value,
    link.attached_at,
    CASE
      WHEN decision.created IS NOT NULL THEN resource.created
      ELSE GREATEST(link.created, resource.created)
    END AS filled_value,
    CASE
      WHEN decision.created IS NOT NULL THEN 'resource_created'
      ELSE 'greatest'
    END AS fill_source
  FROM public.patch_resource_link_attached_at_fill AS fill
  JOIN public.patch_resource_link AS link ON link.id = fill.link_id
  JOIN public.patch_resource AS resource ON resource.id = fill.resource_id
  LEFT JOIN otoame_stamp_decision AS decision
    ON decision.decision = 'confirm' AND decision.created = link.created
),
eligible AS (
  SELECT link_id, previous_value, filled_value, fill_source
  FROM desired
  WHERE attached_at = previous_value
    AND attached_at IS DISTINCT FROM filled_value
),
updated_links AS (
  UPDATE public.patch_resource_link AS link
  SET attached_at = eligible.filled_value
  FROM eligible
  WHERE link.id = eligible.link_id
    AND link.attached_at = eligible.previous_value
  RETURNING link.id
),
updated_fill AS (
  UPDATE public.patch_resource_link_attached_at_fill AS fill
  SET fill_source = eligible.fill_source,
      filled_value = eligible.filled_value
  FROM eligible
  JOIN updated_links ON updated_links.id = eligible.link_id
  WHERE fill.link_id = eligible.link_id
  RETURNING fill.link_id
)
SELECT
  (SELECT count(*) FROM updated_fill) AS corrected_rows,
  (
    SELECT count(*)
    FROM desired
    WHERE attached_at IS DISTINCT FROM previous_value
  ) AS skipped_changed_rows;

COMMIT;
