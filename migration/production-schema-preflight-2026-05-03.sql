-- Production schema preflight for upstream sync 2026-05-03.
-- This script is read-only: it reports schema objects required by the current code.

WITH required_columns(table_name, column_name, expected_type, expected_nullable) AS (
  VALUES
    ('patch_report', 'id', 'integer', 'NO'),
    ('patch_report', 'target_type', 'character varying', 'NO'),
    ('patch_report', 'status', 'integer', 'NO'),
    ('patch_report', 'reason', 'character varying', 'NO'),
    ('patch_report', 'handler_reply', 'character varying', 'NO'),
    ('patch_report', 'handled_at', 'timestamp without time zone', 'YES'),
    ('patch_report', 'sender_id', 'integer', 'NO'),
    ('patch_report', 'reported_user_id', 'integer', 'NO'),
    ('patch_report', 'handler_id', 'integer', 'YES'),
    ('patch_report', 'patch_id', 'integer', 'NO'),
    ('patch_report', 'comment_id', 'integer', 'YES'),
    ('patch_report', 'rating_id', 'integer', 'YES'),
    ('patch_report', 'created', 'timestamp without time zone', 'NO'),
    ('patch_report', 'updated', 'timestamp without time zone', 'NO'),
    ('patch', 'favorite_count', 'integer', 'NO'),
    ('patch', 'resource_count', 'integer', 'NO'),
    ('patch', 'comment_count', 'integer', 'NO'),
    ('patch_resource', 'storage', 'character varying', 'NO'),
    ('patch_resource', 'section', 'character varying', 'NO'),
    ('patch_resource', 'name', 'character varying', 'NO'),
    ('patch_resource', 'size', 'character varying', 'NO'),
    ('patch_resource', 'code', 'character varying', 'NO'),
    ('patch_resource', 'password', 'character varying', 'NO'),
    ('patch_resource', 'note', 'character varying', 'NO'),
    ('patch_resource', 'hash', 'text', 'NO'),
    ('patch_resource', 'content', 'text', 'NO'),
    ('patch_resource', 'type', 'ARRAY', 'NO'),
    ('patch_resource', 'language', 'ARRAY', 'NO'),
    ('patch_resource', 'platform', 'ARRAY', 'NO'),
    ('patch_resource', 'download', 'integer', 'NO'),
    ('patch_resource', 'status', 'integer', 'NO')
), existing_columns AS (
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    character_maximum_length,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'required_column' AS check_type,
  rc.table_name,
  rc.column_name,
  CASE
    WHEN ec.column_name IS NULL THEN 'missing'
    WHEN ec.data_type <> rc.expected_type THEN 'type_mismatch'
    WHEN ec.is_nullable <> rc.expected_nullable THEN 'nullability_mismatch'
    ELSE 'ok'
  END AS status,
  rc.expected_type,
  ec.data_type AS actual_type,
  rc.expected_nullable,
  ec.is_nullable AS actual_nullable,
  ec.character_maximum_length,
  ec.column_default
FROM required_columns rc
LEFT JOIN existing_columns ec
  ON ec.table_name = rc.table_name
 AND ec.column_name = rc.column_name
ORDER BY rc.table_name, rc.column_name;

WITH required_indexes(table_name, index_name) AS (
  VALUES
    ('patch_report', 'patch_report_status_target_type_created_idx'),
    ('patch_report', 'patch_report_target_type_comment_id_status_idx'),
    ('patch_report', 'patch_report_target_type_rating_id_status_idx'),
    ('patch_report', 'patch_report_sender_id_idx'),
    ('patch_report', 'patch_report_reported_user_id_idx'),
    ('patch_report', 'patch_report_patch_id_idx'),
    ('patch', 'patch_favorite_count_idx'),
    ('user_patch_resource_like_relation', 'user_patch_resource_like_relation_user_id_resource_id_key')
), existing_indexes AS (
  SELECT tablename AS table_name, indexname AS index_name, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
)
SELECT
  'required_index' AS check_type,
  ri.table_name,
  ri.index_name,
  CASE WHEN ei.index_name IS NULL THEN 'missing' ELSE 'ok' END AS status,
  ei.indexdef
FROM required_indexes ri
LEFT JOIN existing_indexes ei
  ON ei.table_name = ri.table_name
 AND ei.index_name = ri.index_name
ORDER BY ri.table_name, ri.index_name;

WITH required_constraints(table_name, constraint_name) AS (
  VALUES
    ('patch_report', 'patch_report_sender_id_fkey'),
    ('patch_report', 'patch_report_reported_user_id_fkey'),
    ('patch_report', 'patch_report_handler_id_fkey'),
    ('patch_report', 'patch_report_patch_id_fkey'),
    ('patch_report', 'patch_report_comment_id_fkey'),
    ('patch_report', 'patch_report_rating_id_fkey'),
    ('patch_resource', 'patch_resource_user_id_fkey'),
    ('patch_resource', 'patch_resource_patch_id_fkey')
), existing_constraints AS (
  SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    rc.update_rule,
    rc.delete_rule
  FROM information_schema.table_constraints tc
  LEFT JOIN information_schema.referential_constraints rc
    ON rc.constraint_schema = tc.constraint_schema
   AND rc.constraint_name = tc.constraint_name
  WHERE tc.table_schema = 'public'
)
SELECT
  'required_constraint' AS check_type,
  r.table_name,
  r.constraint_name,
  CASE WHEN e.constraint_name IS NULL THEN 'missing' ELSE 'ok' END AS status,
  e.constraint_type,
  e.update_rule,
  e.delete_rule
FROM required_constraints r
LEFT JOIN existing_constraints e
  ON e.table_name = r.table_name
 AND e.constraint_name = r.constraint_name
ORDER BY r.table_name, r.constraint_name;

WITH tracked_tables(table_name) AS (
  VALUES
    ('patch_report'),
    ('patch_resource'),
    ('patch_resource_link'),
    ('patch_tag'),
    ('user')
)
SELECT
  'tracked_table_row_count' AS check_type,
  t.table_name,
  CASE WHEN c.relid IS NULL THEN 'missing' ELSE 'ok' END AS status,
  c.n_live_tup AS estimated_rows
FROM tracked_tables t
LEFT JOIN pg_stat_user_tables c
  ON c.schemaname = 'public'
 AND c.relname = t.table_name
ORDER BY t.table_name;

WITH tracked_legacy_columns(table_name, column_name) AS (
  VALUES
    ('patch_tag', 'source'),
    ('user', 'allow_private_message'),
    ('user', 'blocked_tag_ids')
)
SELECT
  'legacy_column_inventory' AS check_type,
  t.table_name,
  t.column_name,
  CASE WHEN c.column_name IS NULL THEN 'missing' ELSE 'present' END AS status,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM tracked_legacy_columns t
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = t.table_name
 AND c.column_name = t.column_name
ORDER BY t.table_name, t.column_name;

SELECT
  'patch_resource_link_inventory' AS check_type,
  CASE WHEN to_regclass('public.patch_resource_link') IS NULL THEN 'missing' ELSE 'present' END AS status,
  CASE
    WHEN to_regclass('public.patch_resource_link') IS NULL THEN NULL
    ELSE (SELECT n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname = 'patch_resource_link')
  END AS estimated_rows;
