-- Module 06 official-mirror sync. One transaction: add nullable attached_at,
-- backfill only rows that are still null, validate the explicit stamp
-- decisions, then set the default and NOT NULL. Any error rolls the whole
-- transaction back.
--
-- Required psql variables:
--   stamp_confirmed      `none` or comma-separated `YYYY-MM-DD HH24:MI:SS.MS`
--   stamp_rejected       `none` or the same timestamp format
--   small_stamp_review   `acknowledged`
--
-- A timestamp is filled from the card created time only when it is listed in
-- stamp_confirmed. Groups of more than 50 links are candidates and must be
-- listed in exactly one of the two variables. Smaller groups are not migration
-- stamps unless they are also listed in stamp_confirmed. Omitting a decision
-- aborts; this file never infers a stamp from the count alone.
--
-- Rows that were null are inserted into patch_resource_link_attached_at_fill.
-- Re-running with the same decisions changes nothing. A different decision set
-- aborts without changing values already written; use the correction file for
-- that case. New module tables are created empty and are not refilled.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('otoame.stamp_confirmed', :'stamp_confirmed', true);
SELECT set_config('otoame.stamp_rejected', :'stamp_rejected', true);
SELECT set_config('otoame.small_stamp_review', :'small_stamp_review', true);

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.patch_resource IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_resource_link IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.patch_resource
  ADD COLUMN IF NOT EXISTS publisher_left_at TIMESTAMP(3) WITHOUT TIME ZONE;

ALTER TABLE public.patch_resource_link
  ADD COLUMN IF NOT EXISTS attached_at TIMESTAMP(3) WITHOUT TIME ZONE;

ALTER TABLE public.patch_resource_link
  ADD COLUMN IF NOT EXISTS click INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.patch_resource_backup_state (
  resource_id INTEGER NOT NULL,
  ignored_at TIMESTAMP(3) WITHOUT TIME ZONE,
  ignored_by_user_id INTEGER,
  ignore_reason VARCHAR(500),
  rebackup_dismissed_at TIMESTAMP(3) WITHOUT TIME ZONE,
  CONSTRAINT patch_resource_backup_state_pkey PRIMARY KEY (resource_id),
  CONSTRAINT patch_resource_backup_state_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES public.patch_resource(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.patch_resource_merge_record (
  id SERIAL PRIMARY KEY,
  user_resource_id INTEGER NOT NULL,
  staff_resource_id INTEGER NOT NULL,
  patch_id INTEGER NOT NULL,
  section VARCHAR(107) NOT NULL,
  status VARCHAR(16) NOT NULL,
  handled_at TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  handled_by_user_id INTEGER NOT NULL,
  detail JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS patch_resource_merge_record_pair_key
  ON public.patch_resource_merge_record (user_resource_id, staff_resource_id);

CREATE INDEX IF NOT EXISTS patch_resource_merge_record_staff_status_idx
  ON public.patch_resource_merge_record (staff_resource_id, status);

CREATE TABLE IF NOT EXISTS public.patch_resource_file_cleanup (
  id SERIAL PRIMARY KEY,
  object_key VARCHAR(1007) NOT NULL,
  resource_id INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL,
  failure_category VARCHAR(64),
  created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS patch_resource_file_cleanup_object_key_key
  ON public.patch_resource_file_cleanup (object_key);

CREATE INDEX IF NOT EXISTS patch_resource_file_cleanup_replay_idx
  ON public.patch_resource_file_cleanup (status, created, id);

CREATE TABLE IF NOT EXISTS public.patch_resource_link_attached_at_fill (
  link_id INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  link_created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  resource_created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  fill_source VARCHAR(32) NOT NULL,
  filled_value TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patch_resource_link_attached_at_fill_pkey PRIMARY KEY (link_id),
  CONSTRAINT patch_resource_link_attached_at_fill_link_id_fkey
    FOREIGN KEY (link_id) REFERENCES public.patch_resource_link(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

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

INSERT INTO public.patch_resource_link_attached_at_fill (
  link_id,
  resource_id,
  link_created,
  resource_created,
  fill_source,
  filled_value
)
SELECT
  link.id,
  link.resource_id,
  link.created,
  resource.created,
  CASE
    WHEN decision.created IS NOT NULL THEN 'resource_created'
    ELSE 'greatest'
  END,
  CASE
    WHEN decision.created IS NOT NULL THEN resource.created
    ELSE GREATEST(link.created, resource.created)
  END
FROM public.patch_resource_link AS link
JOIN public.patch_resource AS resource ON resource.id = link.resource_id
LEFT JOIN otoame_stamp_decision AS decision
  ON decision.decision = 'confirm' AND decision.created = link.created
WHERE link.attached_at IS NULL
ON CONFLICT (link_id) DO NOTHING;

UPDATE public.patch_resource_link AS link
SET attached_at = fill.filled_value
FROM public.patch_resource_link_attached_at_fill AS fill
WHERE link.id = fill.link_id
  AND link.attached_at IS NULL;

DO $validate$
DECLARE
  orphan_nulls integer;
  remaining_nulls integer;
  undecided integer;
  unknown_decision integer;
  mismatch integer;
BEGIN
  SELECT count(*)
  INTO orphan_nulls
  FROM public.patch_resource_link AS link
  WHERE link.attached_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.patch_resource AS resource WHERE resource.id = link.resource_id
    );
  IF orphan_nulls <> 0 THEN
    RAISE EXCEPTION
      'attached_at backfill found % null links without a resource', orphan_nulls;
  END IF;

  SELECT count(*)
  INTO remaining_nulls
  FROM public.patch_resource_link
  WHERE attached_at IS NULL;
  IF remaining_nulls <> 0 THEN
    RAISE EXCEPTION 'attached_at backfill left % null rows', remaining_nulls;
  END IF;

  SELECT count(*)
  INTO undecided
  FROM (
    SELECT created
    FROM public.patch_resource_link
    GROUP BY created
    HAVING count(*) > 50
  ) AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM otoame_stamp_decision AS decision
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
    SELECT 1
    FROM public.patch_resource_link AS link
    WHERE link.created = decision.created
  );
  IF unknown_decision <> 0 THEN
    RAISE EXCEPTION
      '% stamp decisions match no link created value', unknown_decision;
  END IF;

  SELECT count(*)
  INTO mismatch
  FROM public.patch_resource_link_attached_at_fill AS fill
  JOIN public.patch_resource_link AS link ON link.id = fill.link_id
  JOIN public.patch_resource AS resource ON resource.id = link.resource_id
  WHERE link.attached_at IS DISTINCT FROM fill.filled_value
     OR fill.filled_value IS DISTINCT FROM (
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM otoame_stamp_decision AS decision
           WHERE decision.decision = 'confirm'
             AND decision.created = link.created
         ) THEN resource.created
         ELSE GREATEST(link.created, resource.created)
       END
     )
     OR fill.fill_source IS DISTINCT FROM (
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM otoame_stamp_decision AS decision
           WHERE decision.decision = 'confirm'
             AND decision.created = link.created
         ) THEN 'resource_created'
         ELSE 'greatest'
       END
     );
  IF mismatch <> 0 THEN
    RAISE EXCEPTION
      'attached_at manifest does not match the explicit stamp decisions (% rows)',
      mismatch;
  END IF;
END
$validate$;

ALTER TABLE public.patch_resource_link
  ALTER COLUMN attached_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.patch_resource_link
  ALTER COLUMN attached_at SET NOT NULL;

COMMIT;
