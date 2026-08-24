-- Production preflight for making patch.vndb_relation_id globally unique.
-- This script is read-only. Review every section before applying the matching
-- sync; a non-zero ci_duplicate_groups count means the sync MUST NOT be run
-- until the duplicates are resolved by hand. Do not merge rows automatically:
-- two patches sharing a Release ID is a content decision, not a data glitch.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. The column has to exist with the shape the sync expects.
SELECT
  'column_shape' AS check_type,
  column_name,
  data_type,
  is_nullable,
  CASE
    WHEN data_type = 'character varying' AND is_nullable = 'YES' THEN 'ok'
    ELSE 'unexpected'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch'
  AND column_name = 'vndb_relation_id';

-- 2. Rows that would collide once comparison becomes case insensitive.
--    Any output here blocks the sync.
SELECT
  'ci_duplicate_group' AS check_type,
  lower(btrim(vndb_relation_id)) AS normalized_relation_id,
  count(*) AS row_count,
  string_agg(unique_id, ', ' ORDER BY id) AS patch_unique_ids
FROM patch
WHERE vndb_relation_id IS NOT NULL
  AND btrim(vndb_relation_id) <> ''
GROUP BY lower(btrim(vndb_relation_id))
HAVING count(*) > 1
ORDER BY normalized_relation_id;

-- 3. Counters the sync will act on: values needing normalization, and empty
--    strings that have to become NULL so they do not collide with each other
--    under the unique index.
SELECT 'total_non_null' AS check_type, count(*) AS row_count
FROM patch
WHERE vndb_relation_id IS NOT NULL AND btrim(vndb_relation_id) <> ''
UNION ALL
SELECT 'needs_normalizing', count(*)
FROM patch
WHERE vndb_relation_id IS NOT NULL
  AND vndb_relation_id <> lower(btrim(vndb_relation_id))
UNION ALL
SELECT 'empty_string_rows', count(*)
FROM patch
WHERE vndb_relation_id IS NOT NULL AND btrim(vndb_relation_id) = ''
UNION ALL
SELECT 'ci_duplicate_groups', count(*)
FROM (
  SELECT 1
  FROM patch
  WHERE vndb_relation_id IS NOT NULL AND btrim(vndb_relation_id) <> ''
  GROUP BY lower(btrim(vndb_relation_id))
  HAVING count(*) > 1
) duplicate_groups;

-- 4. Objects the sync creates, so a rerun can tell what is already in place.
SELECT
  'existing_object' AS check_type,
  object_name,
  object_kind,
  CASE WHEN present THEN 'present' ELSE 'missing' END AS status
FROM (
  SELECT
    'patch_vndb_relation_id_key' AS object_name,
    'unique index' AS object_kind,
    EXISTS (
      SELECT 1
      FROM pg_class index_class
      WHERE index_class.relnamespace = 'public'::regnamespace
        AND index_class.relname = 'patch_vndb_relation_id_key'
    ) AS present
  UNION ALL
  SELECT
    'patch_vndb_relation_id_normalized',
    'check constraint',
    EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.patch')
        AND conname = 'patch_vndb_relation_id_normalized'
    )
) objects
ORDER BY object_name;

-- 5. Every unique index touching the column. The composite
--    (vndb_id, vndb_relation_id) one that exists today stays: uniqueness on the
--    Release ID alone already implies it, and dropping it is out of scope.
--    Prisma creates it as a bare unique index, not a table constraint, so this
--    reads pg_index rather than pg_constraint.
SELECT
  'unique_index' AS check_type,
  index_class.relname AS index_name,
  pg_get_indexdef(index_class.oid) AS definition
FROM pg_index index_row
JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
WHERE index_row.indrelid = to_regclass('public.patch')
  AND index_row.indisunique
  AND pg_get_indexdef(index_class.oid) ILIKE '%vndb_relation_id%'
ORDER BY index_class.relname;

COMMIT;
