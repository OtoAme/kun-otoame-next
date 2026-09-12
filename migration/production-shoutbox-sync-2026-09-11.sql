-- Idempotent M02 shoutbox schema sync.
-- Run the read-only preflight first and the matching postflight afterwards.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.shoutbox (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  request_id       VARCHAR(64) NOT NULL,
  content          VARCHAR(500) NOT NULL,
  link             VARCHAR(1000) NOT NULL DEFAULT '',
  official         BOOLEAN NOT NULL DEFAULT FALSE,
  level            VARCHAR(16) NOT NULL DEFAULT 'normal',
  status           INTEGER NOT NULL DEFAULT 0,
  cost             INTEGER NOT NULL DEFAULT 0,
  patch_id         INTEGER,
  effective_from   TIMESTAMP(3) WITHOUT TIME ZONE,
  effective_to     TIMESTAMP(3) WITHOUT TIME ZONE,
  edited_at        TIMESTAMP(3) WITHOUT TIME ZONE,
  hidden_at        TIMESTAMP(3) WITHOUT TIME ZONE,
  refunded_at      TIMESTAMP(3) WITHOUT TIME ZONE,
  created          TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated          TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  CONSTRAINT shoutbox_status_check
    CHECK (status IN (0, 1, 2, 3)),
  CONSTRAINT shoutbox_level_check
    CHECK (level IN ('normal', 'important')),
  CONSTRAINT shoutbox_cost_check
    CHECK (cost >= 0),
  CONSTRAINT shoutbox_shape_check
    CHECK (
      (
        official = TRUE
        AND effective_from IS NOT NULL
        AND effective_to IS NOT NULL
        AND effective_to > effective_from
      )
      OR (
        official = FALSE
        AND level = 'normal'
        AND effective_from IS NULL
        AND effective_to IS NULL
        AND link = ''
      )
    ),
  CONSTRAINT shoutbox_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT shoutbox_patch_id_fkey
    FOREIGN KEY (patch_id) REFERENCES public.patch(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);

-- A present shoutbox table must have passed the read-only preflight. This sync
-- creates a missing table and the intended patch_report additions; it does not
-- try to repair a partial or incompatible shoutbox table in place.
DO $existing_shoutbox$
DECLARE
  table_exists boolean := to_regclass('public.shoutbox') IS NOT NULL;
  mismatch_count integer;
BEGIN
  IF NOT table_exists THEN
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('id', 'integer', 'NO', NULL::integer, NULL::integer),
    ('user_id', 'integer', 'NO', NULL::integer, NULL::integer),
    ('request_id', 'character varying', 'NO', 64, NULL::integer),
    ('content', 'character varying', 'NO', 500, NULL::integer),
    ('link', 'character varying', 'NO', 1000, NULL::integer),
    ('official', 'boolean', 'NO', NULL::integer, NULL::integer),
    ('level', 'character varying', 'NO', 16, NULL::integer),
    ('status', 'integer', 'NO', NULL::integer, NULL::integer),
    ('cost', 'integer', 'NO', NULL::integer, NULL::integer),
    ('patch_id', 'integer', 'YES', NULL::integer, NULL::integer),
    ('effective_from', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('effective_to', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('edited_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('refunded_at', 'timestamp without time zone', 'YES', NULL::integer, 3),
    ('created', 'timestamp without time zone', 'NO', NULL::integer, 3),
    ('updated', 'timestamp without time zone', 'NO', NULL::integer, 3)
  ) AS expected(column_name, data_type, is_nullable, character_maximum_length, datetime_precision)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'shoutbox'
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.data_type <> expected.data_type
     OR actual.is_nullable <> expected.is_nullable
     OR actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length
     OR actual.datetime_precision IS DISTINCT FROM expected.datetime_precision;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'shoutbox sync refused: existing table is partial or incompatible; rerun preflight and review it';
  END IF;
END
$existing_shoutbox$;

ALTER TABLE public.patch_report
  ADD COLUMN IF NOT EXISTS shoutbox_id INTEGER,
  ALTER COLUMN patch_id DROP NOT NULL;

DO $report_foreign_key$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patch_report_shoutbox_id_fkey'
      AND conrelid = 'public.patch_report'::regclass
  ) THEN
    ALTER TABLE public.patch_report
      ADD CONSTRAINT patch_report_shoutbox_id_fkey
      FOREIGN KEY (shoutbox_id) REFERENCES public.shoutbox(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$report_foreign_key$;

CREATE UNIQUE INDEX IF NOT EXISTS shoutbox_user_id_request_id_key
  ON public.shoutbox (user_id, request_id);
CREATE INDEX IF NOT EXISTS shoutbox_status_created_id_idx
  ON public.shoutbox (status, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS shoutbox_patch_id_status_created_idx
  ON public.shoutbox (patch_id, status, created DESC);
CREATE INDEX IF NOT EXISTS shoutbox_user_id_created_id_idx
  ON public.shoutbox (user_id, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS shoutbox_official_status_effective_to_idx
  ON public.shoutbox (official, status, effective_to);
CREATE INDEX IF NOT EXISTS patch_report_target_type_shoutbox_id_status_idx
  ON public.patch_report (target_type, shoutbox_id, status);

COMMIT;
