-- Production schema sync for allowing multiple patches to share one Steam App ID.
-- This removes the old unique constraint/index on patch.steam_id and replaces it
-- with a normal lookup index for duplicate checks.
-- Run this file outside an explicit transaction because CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block.

DO $$
DECLARE
  unique_constraint_name text;
BEGIN
  IF to_regclass('public.patch') IS NULL THEN
    RAISE EXCEPTION 'Missing required table public.patch';
  END IF;

  FOR unique_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'patch'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) ILIKE '%steam_id%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.patch DROP CONSTRAINT %I',
      unique_constraint_name
    );
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.patch_steam_id_key;

CREATE INDEX CONCURRENTLY IF NOT EXISTS patch_steam_id_idx
  ON public.patch (steam_id);
