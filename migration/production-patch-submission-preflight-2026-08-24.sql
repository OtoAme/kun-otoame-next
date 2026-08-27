-- Production preflight for the user submission domain (patch_submission and
-- patch_submission_gallery). Read-only: review the inventory before applying the
-- matching sync.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

WITH required_tables(table_name) AS (
  VALUES
    ('patch_submission'),
    ('patch_submission_gallery')
), existing_tables AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
)
SELECT
  'required_table' AS check_type,
  required_tables.table_name,
  CASE WHEN existing_tables.table_name IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_tables
LEFT JOIN existing_tables USING (table_name)
ORDER BY required_tables.table_name;

WITH required_columns(table_name, column_name, expected_type) AS (
  VALUES
    ('patch_submission', 'user_id', 'integer'),
    ('patch_submission', 'status', 'character varying'),
    ('patch_submission', 'payload', 'jsonb'),
    ('patch_submission', 'payload_version', 'integer'),
    ('patch_submission', 'external_source', 'character varying'),
    ('patch_submission', 'external_fetched_at', 'timestamp without time zone'),
    ('patch_submission', 'name', 'character varying'),
    ('patch_submission', 'vndb_relation_id', 'character varying'),
    ('patch_submission', 'revision', 'integer'),
    ('patch_submission', 'role_at_creation', 'integer'),
    ('patch_submission', 'held_amount', 'integer'),
    ('patch_submission', 'reservation_id', 'integer'),
    ('patch_submission', 'reviewed_by_id', 'integer'),
    ('patch_submission', 'review_reason', 'character varying'),
    ('patch_submission', 'patch_id', 'integer'),
    ('patch_submission', 'hidden_by_user', 'boolean'),
    ('patch_submission', 'submitted_at', 'timestamp without time zone'),
    ('patch_submission', 'settled_at', 'timestamp without time zone'),
    ('patch_submission', 'created', 'timestamp without time zone'),
    ('patch_submission', 'updated', 'timestamp without time zone'),
    ('patch_submission_gallery', 'submission_id', 'integer'),
    ('patch_submission_gallery', 'client_asset_id', 'character varying'),
    ('patch_submission_gallery', 'upload_status', 'character varying'),
    ('patch_submission_gallery', 'file_fingerprint', 'character varying'),
    ('patch_submission_gallery', 'declared_bytes', 'integer'),
    ('patch_submission_gallery', 'status_changed_at', 'timestamp without time zone'),
    ('patch_submission_gallery', 'created', 'timestamp without time zone'),
    ('patch_submission_gallery', 'updated', 'timestamp without time zone')
), existing_columns AS (
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'required_column' AS check_type,
  required_columns.table_name,
  required_columns.column_name,
  required_columns.expected_type,
  COALESCE(existing_columns.data_type, 'missing') AS actual_type,
  CASE
    WHEN existing_columns.data_type IS NULL THEN 'missing'
    WHEN existing_columns.data_type <> required_columns.expected_type THEN 'type_mismatch'
    ELSE 'ok'
  END AS status
FROM required_columns
LEFT JOIN existing_columns USING (table_name, column_name)
ORDER BY required_columns.table_name, required_columns.column_name;

-- Prisma @updatedAt columns are application-managed and must not have a
-- database default. A default here is real drift, not the known index exception.
WITH required_updated_columns(table_name, column_name) AS (
  VALUES
    ('patch_submission', 'updated'),
    ('patch_submission_gallery', 'updated')
), existing_columns AS (
  SELECT table_name, column_name, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'updated_default' AS check_type,
  required_updated_columns.table_name,
  required_updated_columns.column_name,
  existing_columns.column_default AS actual_default,
  CASE
    WHEN existing_columns.column_name IS NULL THEN 'missing'
    WHEN existing_columns.column_default IS NULL THEN 'ok'
    ELSE 'unexpected_default'
  END AS status
FROM required_updated_columns
LEFT JOIN existing_columns USING (table_name, column_name)
ORDER BY required_updated_columns.table_name;

WITH required_indexes(index_name) AS (
  VALUES
    ('patch_submission_user_id_status_created_idx'),
    ('patch_submission_status_submitted_at_idx'),
    ('patch_submission_reservation_id_key'),
    ('patch_submission_patch_id_key'),
    ('patch_submission_gallery_submission_id_client_asset_id_key'),
    ('patch_submission_gallery_submission_id_upload_status_idx')
)
SELECT
  'required_index' AS check_type,
  required_indexes.index_name,
  CASE WHEN pg_indexes.indexname IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_indexes
LEFT JOIN pg_indexes
  ON pg_indexes.schemaname = 'public'
 AND pg_indexes.indexname = required_indexes.index_name
ORDER BY required_indexes.index_name;

WITH required_constraints(constraint_name) AS (
  VALUES
    ('patch_submission_status_valid'),
    ('patch_submission_held_amount_nonnegative'),
    ('patch_submission_revision_positive'),
    ('patch_submission_gallery_upload_status_valid'),
    ('patch_submission_gallery_declared_bytes_nonnegative')
)
SELECT
  'required_constraint' AS check_type,
  required_constraints.constraint_name,
  CASE WHEN pg_constraint.conname IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_constraints
LEFT JOIN pg_constraint
  ON pg_constraint.conname = required_constraints.constraint_name
 AND pg_constraint.contype = 'c'
ORDER BY required_constraints.constraint_name;

SELECT
  to_regclass('public.patch_submission') IS NOT NULL
    AS patch_submission_exists,
  to_regclass('public.patch_submission_gallery') IS NOT NULL
    AS patch_submission_gallery_exists
\gset

-- Rows the sync's CHECK constraints would reject. Non-zero means the data has to
-- be reconciled before the sync can run. A first deployment may not have either
-- table yet, so guard each table independently for partially applied rollouts.
\if :patch_submission_exists
SELECT 'invalid_status_rows' AS check_type, count(*) AS row_count
FROM public.patch_submission
WHERE status NOT IN (
  'draft', 'pending', 'changes_requested',
  'rejected', 'published', 'violation', 'deleted'
)
UNION ALL
SELECT 'negative_held_amount_rows', count(*)
FROM public.patch_submission
WHERE held_amount < 0
UNION ALL
SELECT 'non_positive_revision_rows', count(*)
FROM public.patch_submission
WHERE revision < 1;
\else
SELECT
  'submission_data_checks' AS check_type,
  0::bigint AS row_count,
  'skipped_missing_table' AS status;
\endif

\if :patch_submission_gallery_exists
SELECT 'invalid_gallery_status_rows' AS check_type, count(*) AS row_count
FROM public.patch_submission_gallery
WHERE upload_status NOT IN ('uploading', 'ready', 'failed')
UNION ALL
SELECT 'negative_declared_bytes_rows', count(*)
FROM public.patch_submission_gallery
WHERE declared_bytes < 0;
\else
SELECT
  'submission_gallery_data_checks' AS check_type,
  0::bigint AS row_count,
  'skipped_missing_table' AS status;
\endif

-- patch.status must still be unused: submissions never write to it.
SELECT
  'patch_status_values' AS check_type,
  status,
  count(*) AS row_count
FROM patch
GROUP BY status
ORDER BY status;

COMMIT;
