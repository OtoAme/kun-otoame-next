-- Read-only production preflight for the durable patch-submission orphan
-- cleanup outbox. Run this before the matching sync and review every result.

\set ON_ERROR_STOP on

SELECT
  'table_inventory' AS check_type,
  CASE
    WHEN to_regclass('public.patch_submission_orphan_cleanup') IS NULL
      THEN 'missing'
    ELSE 'present'
  END AS status,
  COALESCE(stats.n_live_tup, 0) AS estimated_rows
FROM (VALUES (1)) AS seed(value)
LEFT JOIN pg_stat_user_tables stats
  ON stats.schemaname = 'public'
 AND stats.relname = 'patch_submission_orphan_cleanup';

WITH required_columns(column_name, expected_type, expected_nullable) AS (
  VALUES
    ('id', 'integer', 'NO'),
    ('object_key', 'character varying', 'NO'),
    ('purge_urls', 'jsonb', 'NO'),
    ('source', 'character varying', 'NO'),
    ('attempts', 'integer', 'NO'),
    ('last_error', 'character varying', 'YES'),
    ('created', 'timestamp without time zone', 'NO'),
    ('updated', 'timestamp without time zone', 'NO')
), existing_columns AS (
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_submission_orphan_cleanup'
)
SELECT
  'required_column' AS check_type,
  required.column_name,
  CASE
    WHEN existing.column_name IS NULL THEN 'missing'
    WHEN existing.data_type <> required.expected_type THEN 'type_mismatch'
    WHEN existing.is_nullable <> required.expected_nullable
      THEN 'nullability_mismatch'
    ELSE 'ok'
  END AS status,
  required.expected_type,
  existing.data_type AS actual_type,
  required.expected_nullable,
  existing.is_nullable AS actual_nullable,
  existing.column_default
FROM required_columns required
LEFT JOIN existing_columns existing USING (column_name)
ORDER BY required.column_name;

WITH required_indexes(index_name) AS (
  VALUES
    ('patch_submission_orphan_cleanup_object_key_key'),
    ('patch_submission_orphan_cleanup_created_id_idx')
)
SELECT
  'required_index' AS check_type,
  required.index_name,
  CASE WHEN indexes.indexname IS NULL THEN 'missing' ELSE 'present' END AS status,
  indexes.indexdef
FROM required_indexes required
LEFT JOIN pg_indexes indexes
  ON indexes.schemaname = 'public'
 AND indexes.indexname = required.index_name
ORDER BY required.index_name;

WITH required_constraints(constraint_name) AS (
  VALUES
    ('patch_submission_orphan_cleanup_key_prefix'),
    ('patch_submission_orphan_cleanup_attempts_nonnegative'),
    ('patch_submission_orphan_cleanup_purge_urls_array')
)
SELECT
  'required_constraint' AS check_type,
  required.constraint_name,
  CASE WHEN constraints.conname IS NULL THEN 'missing' ELSE 'present' END AS status,
  pg_get_constraintdef(constraints.oid) AS definition
FROM required_constraints required
LEFT JOIN pg_constraint constraints
  ON constraints.conname = required.constraint_name
ORDER BY required.constraint_name;
