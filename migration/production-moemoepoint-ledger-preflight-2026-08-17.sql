-- Production schema preflight for the moemoepoint ledger and reservations.
-- This script is read-only. Review the inventory before applying the matching sync.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

WITH required_tables(table_name) AS (
  VALUES
    ('user_moemoepoint_ledger'),
    ('user_moemoepoint_reservation')
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
    ('user', 'moemoepoint_reserved', 'integer'),
    ('user_moemoepoint_ledger', 'user_id', 'integer'),
    ('user_moemoepoint_ledger', 'kind', 'character varying'),
    ('user_moemoepoint_ledger', 'balance_delta', 'integer'),
    ('user_moemoepoint_ledger', 'reserved_delta', 'integer'),
    ('user_moemoepoint_ledger', 'balance_after', 'integer'),
    ('user_moemoepoint_ledger', 'reserved_after', 'integer'),
    ('user_moemoepoint_ledger', 'reason_code', 'character varying'),
    ('user_moemoepoint_reservation', 'user_id', 'integer'),
    ('user_moemoepoint_reservation', 'amount', 'integer'),
    ('user_moemoepoint_reservation', 'status', 'character varying')
), existing_columns AS (
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'required_column' AS check_type,
  required_columns.table_name,
  required_columns.column_name,
  CASE
    WHEN existing_columns.column_name IS NULL THEN 'missing'
    WHEN existing_columns.data_type <> required_columns.expected_type THEN 'type_mismatch'
    ELSE 'ok'
  END AS status,
  required_columns.expected_type,
  existing_columns.data_type AS actual_type
FROM required_columns
LEFT JOIN existing_columns
  ON existing_columns.table_name = required_columns.table_name
 AND existing_columns.column_name = required_columns.column_name
ORDER BY required_columns.table_name, required_columns.column_name;

SELECT
  'user_balance_inventory' AS check_type,
  COUNT(*) AS users,
  COUNT(*) FILTER (WHERE moemoepoint < 0) AS negative_total_users,
  MIN(moemoepoint) AS minimum_total,
  MAX(moemoepoint) AS maximum_total
FROM public."user";

SELECT
  'ledger_inventory' AS check_type,
  (
    SELECT n_live_tup::bigint
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND relname = 'user_moemoepoint_ledger'
  ) AS estimated_ledger_rows,
  (
    SELECT n_live_tup::bigint
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND relname = 'user_moemoepoint_reservation'
  ) AS estimated_reservation_rows,
  pg_size_pretty(
    pg_total_relation_size(to_regclass('public.user_moemoepoint_ledger'))
  ) AS ledger_table_and_indexes_size,
  pg_size_pretty(
    pg_total_relation_size(to_regclass('public.user_moemoepoint_reservation'))
  ) AS reservation_table_and_indexes_size;

COMMIT;
