-- Production schema preflight for private conversation per-user hide flags.
-- This script is read-only: it reports the user_conversation columns required by the current code.

WITH required_columns(table_name, column_name, expected_type, expected_nullable) AS (
  VALUES
    ('user_conversation', 'user_a_hidden', 'boolean', 'NO'),
    ('user_conversation', 'user_b_hidden', 'boolean', 'NO')
), existing_columns AS (
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
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
  ec.column_default
FROM required_columns rc
LEFT JOIN existing_columns ec
  ON ec.table_name = rc.table_name
 AND ec.column_name = rc.column_name
ORDER BY rc.table_name, rc.column_name;

SELECT
  'user_conversation_inventory' AS check_type,
  CASE
    WHEN to_regclass('public.user_conversation') IS NULL THEN 'missing'
    ELSE 'present'
  END AS status,
  CASE
    WHEN to_regclass('public.user_conversation') IS NULL THEN NULL
    ELSE (
      SELECT n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        AND relname = 'user_conversation'
    )
  END AS estimated_rows;
