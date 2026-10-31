-- Adds user_daily_active (decision 10, §10.5). Add-only and idempotent: run
-- the read-only preflight first. Creating an empty table takes a brief lock on
-- "user" for the foreign key; lock_timeout makes the run stop rather than
-- wait behind traffic, and a rerun picks up where it stopped.
--
-- Rows start accumulating once the matching application version is live.
-- Earlier days cannot be reconstructed and stay empty in the chart.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  actual text;
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    RAISE EXCEPTION 'user_daily_active sync failed: public."user" is missing';
  END IF;

  IF to_regclass('public.user_daily_active') IS NOT NULL THEN
    IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.user_daily_active')) <> 'r' THEN
      RAISE EXCEPTION 'user_daily_active sync refused: the name is taken by a non-table';
    END IF;
    SELECT string_agg(format('%s %s %s', column_name, data_type, is_nullable), ', ' ORDER BY ordinal_position)
    INTO actual
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_daily_active';
    IF actual IS DISTINCT FROM 'day date NO, user_id integer NO' THEN
      RAISE EXCEPTION 'user_daily_active sync refused: existing columns are %', actual;
    END IF;
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.user_daily_active (
  day     DATE    NOT NULL,
  user_id INTEGER NOT NULL,
  CONSTRAINT user_daily_active_pkey PRIMARY KEY (day, user_id)
);

DO $foreign_key$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_daily_active_user_id_fkey'
      AND conrelid = 'public.user_daily_active'::regclass
  ) THEN
    ALTER TABLE public.user_daily_active
      ADD CONSTRAINT user_daily_active_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public."user"(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END
$foreign_key$;

-- Postflight inside the same transaction: the shape the application expects.
DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_daily_active'::regclass
      AND conname = 'user_daily_active_pkey'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (day, user_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_daily_active'::regclass
      AND conname = 'user_daily_active_user_id_fkey'
      AND pg_get_constraintdef(oid) =
        'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE'
  ) THEN
    RAISE EXCEPTION 'user_daily_active postflight failed: key or foreign key differs';
  END IF;
END
$postflight$;

COMMIT;
