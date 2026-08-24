-- Production sync making patch.vndb_relation_id globally unique, case
-- insensitively. Run the matching preflight first: this script aborts if any
-- case-insensitive duplicate exists, and resolving those is a manual content
-- decision.
--
-- Run outside an explicit transaction block: CREATE INDEX CONCURRENTLY cannot
-- run inside one.
--
-- Uniqueness is enforced as "normalize on write + plain unique index" rather
-- than a functional index, because Prisma can express the plain unique index in
-- schema (patch.vndb_relation_id @unique) but not an expression index. The CHECK
-- constraint is what keeps the two equivalent: no row may store a value that is
-- not already lowercase and trimmed, so a plain btree comparison is exact.

\set ON_ERROR_STOP on

DO $preflight$
DECLARE
  patch_relation oid := to_regclass('public.patch');
  duplicate_groups integer;
BEGIN
  IF patch_relation IS NULL
    OR (SELECT relkind FROM pg_class WHERE oid = patch_relation) <> 'r' THEN
    RAISE EXCEPTION 'Missing required ordinary table public.patch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = patch_relation
      AND attname = 'vndb_relation_id'
      AND attnum > 0
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) = 'character varying(107)'
      AND NOT attnotnull
  ) THEN
    RAISE EXCEPTION
      'public.patch.vndb_relation_id must be nullable character varying(107)';
  END IF;

  SELECT count(*)
  INTO duplicate_groups
  FROM (
    SELECT 1
    FROM public.patch
    WHERE vndb_relation_id IS NOT NULL
      AND btrim(vndb_relation_id) <> ''
    GROUP BY lower(btrim(vndb_relation_id))
    HAVING count(*) > 1
  ) groups;

  IF duplicate_groups <> 0 THEN
    RAISE EXCEPTION
      'Release ID is duplicated in % group(s); resolve them by hand before syncing',
      duplicate_groups;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname = 'patch_vndb_relation_id_key'
      AND relkind NOT IN ('i', 'I')
  ) THEN
    RAISE EXCEPTION
      'public.patch_vndb_relation_id_key exists but is not an index';
  END IF;
END
$preflight$;

-- An empty string is not a Release ID, and several of them would collide under
-- the unique index. Normalization matches what validations/edit.ts now stores.
UPDATE public.patch
SET vndb_relation_id = NULL
WHERE vndb_relation_id IS NOT NULL
  AND btrim(vndb_relation_id) = '';

UPDATE public.patch
SET vndb_relation_id = lower(btrim(vndb_relation_id))
WHERE vndb_relation_id IS NOT NULL
  AND vndb_relation_id <> lower(btrim(vndb_relation_id));

DO $$
BEGIN
  ALTER TABLE public.patch
    ADD CONSTRAINT patch_vndb_relation_id_normalized
    CHECK (
      vndb_relation_id IS NULL
      OR vndb_relation_id = lower(btrim(vndb_relation_id))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

SELECT
  index_class.oid IS NOT NULL AS name_exists,
  COALESCE(
    index_class.relkind IN ('i', 'I')
      AND index_row.indrelid = to_regclass('public.patch')
      AND index_row.indisready
      AND index_row.indisvalid
      AND index_row.indislive
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = to_regclass('public.patch')
          AND attname = 'vndb_relation_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL,
    false
  ) AS definition_ok
FROM (SELECT 1) seed
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = 'patch_vndb_relation_id_key'
LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
\gset relation_index_

\if :relation_index_name_exists
  \if :relation_index_definition_ok
    \echo 'patch_vndb_relation_id_key already matches the target definition'
  \else
    \echo 'patch_vndb_relation_id_key exists with an incompatible definition'
    SELECT 1 / 0 AS vndb_relation_id_migration_aborted;
  \endif
\else
  CREATE UNIQUE INDEX CONCURRENTLY patch_vndb_relation_id_key
    ON public.patch (vndb_relation_id);
\endif

DO $postflight$
DECLARE
  patch_relation oid := to_regclass('public.patch');
  unique_index_count integer;
  check_constraint_count integer;
  unnormalized_rows integer;
BEGIN
  SELECT count(*)
  INTO unique_index_count
  FROM pg_class index_class
  JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
  WHERE index_class.relnamespace = 'public'::regnamespace
    AND index_class.relname = 'patch_vndb_relation_id_key'
    AND index_class.relkind IN ('i', 'I')
    AND index_row.indrelid = patch_relation
    AND index_row.indisready
    AND index_row.indisvalid
    AND index_row.indislive
    AND index_row.indisunique;

  SELECT count(*)
  INTO check_constraint_count
  FROM pg_constraint
  WHERE conrelid = patch_relation
    AND conname = 'patch_vndb_relation_id_normalized'
    AND contype = 'c';

  SELECT count(*)
  INTO unnormalized_rows
  FROM public.patch
  WHERE vndb_relation_id IS NOT NULL
    AND vndb_relation_id <> lower(btrim(vndb_relation_id));

  IF unique_index_count <> 1
    OR check_constraint_count <> 1
    OR unnormalized_rows <> 0 THEN
    RAISE EXCEPTION
      'vndb_relation_id postflight failed: unique_index=%, check=%, unnormalized=%',
      unique_index_count,
      check_constraint_count,
      unnormalized_rows;
  END IF;
END
$postflight$;
