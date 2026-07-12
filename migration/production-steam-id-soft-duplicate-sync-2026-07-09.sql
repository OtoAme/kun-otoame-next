-- Production schema sync for allowing multiple patches to share one Steam App ID.
-- This removes the old unique constraint/index on patch.steam_id and replaces it
-- with a normal lookup index for duplicate checks.
-- Run this file outside an explicit transaction because CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block.

\set ON_ERROR_STOP on

DO $object_preflight$
DECLARE
  patch_relation oid := to_regclass('public.patch');
  steam_attnum smallint;
  unknown_index_count integer;
BEGIN
  IF patch_relation IS NULL
    OR (SELECT relkind FROM pg_class WHERE oid = patch_relation) <> 'r' THEN
    RAISE EXCEPTION 'Missing required ordinary table public.patch';
  END IF;

  SELECT attnum
  INTO steam_attnum
  FROM pg_attribute
  WHERE attrelid = patch_relation
    AND attname = 'steam_id'
    AND attnum > 0
    AND NOT attisdropped
    AND format_type(atttypid, atttypmod) = 'integer'
    AND NOT attnotnull;

  IF steam_attnum IS NULL THEN
    RAISE EXCEPTION 'public.patch.steam_id must be nullable integer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('patch_steam_id_key', 'patch_steam_id_idx')
      AND relkind NOT IN ('i', 'I')
  ) THEN
    RAISE EXCEPTION 'A Steam index name exists but is not an index';
  END IF;

  SELECT COUNT(*)
  INTO unknown_index_count
  FROM pg_index index_row
  JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
  WHERE index_row.indrelid = patch_relation
    AND steam_attnum = ANY(index_row.indkey)
    AND index_class.relname NOT IN ('patch_steam_id_key', 'patch_steam_id_idx')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.conindid = index_row.indexrelid
    );

  IF unknown_index_count <> 0 THEN
    RAISE EXCEPTION 'Unknown standalone steam_id indexes must be reviewed before sync';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.relnamespace = 'public'::regnamespace
      AND index_class.relname = 'patch_steam_id_key'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        WHERE constraint_row.conindid = index_class.oid
      )
      AND pg_get_indexdef(index_class.oid) <>
        'CREATE UNIQUE INDEX patch_steam_id_key ON public.patch USING btree (steam_id)'
  ) THEN
    RAISE EXCEPTION 'Unknown standalone patch_steam_id_key definition';
  END IF;
END
$object_preflight$;

SELECT
  index_class.oid IS NOT NULL AS name_exists,
  COALESCE(index_class.relkind IN ('i', 'I'), false) AS is_index,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND index_row.indrelid = to_regclass('public.patch')
      AND NOT index_row.indisunique
      AND NOT index_row.indisprimary
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = to_regclass('public.patch')
          AND attname = 'steam_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND pg_get_indexdef(index_class.oid) =
        'CREATE INDEX patch_steam_id_idx ON public.patch USING btree (steam_id)'
      AND (NOT index_row.indisready OR NOT index_row.indisvalid OR NOT index_row.indislive),
    false
  ) AS needs_drop,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND index_row.indrelid = to_regclass('public.patch')
      AND index_row.indisready
      AND index_row.indisvalid
      AND index_row.indislive
      AND NOT index_row.indisunique
      AND NOT index_row.indisprimary
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = to_regclass('public.patch')
          AND attname = 'steam_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND pg_get_indexdef(index_class.oid) =
        'CREATE INDEX patch_steam_id_idx ON public.patch USING btree (steam_id)',
    false
  ) AS definition_ok
FROM (SELECT 1) seed
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = 'patch_steam_id_idx'
LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
\gset steam_index_

\if :steam_index_name_exists
  \if :steam_index_is_index
    \if :steam_index_needs_drop
      DROP INDEX CONCURRENTLY public.patch_steam_id_idx;
      \set steam_index_create_required true
    \else
      \if :steam_index_definition_ok
        \set steam_index_create_required false
      \else
        \echo 'existing ready/valid patch_steam_id_idx has an incompatible definition'
        SELECT 1 / 0 AS steam_id_migration_aborted;
      \endif
    \endif
  \else
    \echo 'public.patch_steam_id_idx exists but is not an index'
    SELECT 1 / 0 AS steam_id_migration_aborted;
  \endif
\else
  \set steam_index_create_required true
\endif

DO $$
DECLARE
  unique_constraint_name text;
  steam_attnum smallint;
BEGIN
  IF to_regclass('public.patch') IS NULL THEN
    RAISE EXCEPTION 'Missing required table public.patch';
  END IF;

  SELECT attnum INTO steam_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.patch'::regclass
    AND attname = 'steam_id'
    AND attnum > 0
    AND NOT attisdropped;

  FOR unique_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'patch'
      AND con.contype = 'u'
      AND con.conkey = ARRAY[steam_attnum]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.patch DROP CONSTRAINT %I',
      unique_constraint_name
    );
  END LOOP;
END $$;

SELECT EXISTS (
  SELECT 1
  FROM pg_class index_class
  WHERE index_class.relnamespace = 'public'::regnamespace
    AND index_class.relname = 'patch_steam_id_key'
    AND index_class.relkind IN ('i', 'I')
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_row
      WHERE constraint_row.conindid = index_class.oid
    )
) AS standalone_exists
\gset legacy_steam_index_

\if :legacy_steam_index_standalone_exists
  DROP INDEX CONCURRENTLY public.patch_steam_id_key;
\endif

\if :steam_index_create_required
  CREATE INDEX CONCURRENTLY patch_steam_id_idx
    ON public.patch (steam_id);
\endif

DO $postflight$
DECLARE
  patch_relation oid := to_regclass('public.patch');
  target_index_count integer;
  incompatible_index_count integer;
  unique_constraint_count integer;
BEGIN
  SELECT COUNT(*)
  INTO target_index_count
  FROM pg_class index_class
  JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
  WHERE index_class.relnamespace = 'public'::regnamespace
    AND index_class.relname = 'patch_steam_id_idx'
    AND index_class.relkind IN ('i', 'I')
    AND index_row.indrelid = patch_relation
    AND index_row.indisready
    AND index_row.indisvalid
    AND index_row.indislive
    AND NOT index_row.indisunique
    AND NOT index_row.indisprimary
    AND index_row.indpred IS NULL
    AND index_row.indexprs IS NULL
    AND pg_get_indexdef(index_class.oid) =
      'CREATE INDEX patch_steam_id_idx ON public.patch USING btree (steam_id)';

  SELECT COUNT(*)
  INTO incompatible_index_count
  FROM pg_index index_row
  JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
  WHERE index_row.indrelid = patch_relation
    AND pg_get_indexdef(index_row.indexrelid) ILIKE '%steam_id%'
    AND index_class.relname <> 'patch_steam_id_idx'
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint constraint_row
      WHERE constraint_row.conindid = index_row.indexrelid
    );

  SELECT COUNT(*)
  INTO unique_constraint_count
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = patch_relation
    AND constraint_row.contype = 'u'
    AND constraint_row.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = patch_relation
         AND attname = 'steam_id'
         AND attnum > 0
         AND NOT attisdropped)
    ]::smallint[];

  IF target_index_count <> 1
    OR incompatible_index_count <> 0
    OR unique_constraint_count <> 0 THEN
    RAISE EXCEPTION
      'steam_id index postflight failed: target=%, incompatible_indexes=%, unique_constraints=%',
      target_index_count,
      incompatible_index_count,
      unique_constraint_count;
  END IF;
END
$postflight$;
