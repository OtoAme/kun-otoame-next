-- Production schema preflight for private-chat sticker packs.
-- This script is read-only. Apply the matching sync script only after the
-- required objects have been reviewed for the target database.

WITH required_tables(table_name) AS (
  VALUES
    ('sticker_pack'),
    ('sticker'),
    ('user_sticker_pack')
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
    ('sticker_pack', 'slug', 'character varying'),
    ('sticker_pack', 'price', 'integer'),
    ('sticker_pack', 'status', 'integer'),
    ('sticker_pack', 'is_builtin', 'boolean'),
    ('sticker', 'id', 'character varying'),
    ('sticker', 'pack_id', 'integer'),
    ('sticker', 'asset_url', 'character varying'),
    ('sticker', 'thumbnail_url', 'character varying'),
    ('sticker', 'mime', 'character varying'),
    ('sticker', 'media_type', 'character varying'),
    ('sticker', 'width', 'integer'),
    ('sticker', 'height', 'integer'),
    ('sticker', 'size', 'integer'),
    ('user_sticker_pack', 'user_id', 'integer'),
    ('user_sticker_pack', 'pack_id', 'integer'),
    ('user_private_message', 'sticker_id', 'character varying'),
    ('user_private_message', 'reply_sticker_id', 'character varying')
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

WITH required_indexes(table_name, index_name) AS (
  VALUES
    ('sticker_pack', 'sticker_pack_status_sort_order_idx'),
    ('sticker', 'sticker_pack_id_sort_order_idx'),
    ('user_sticker_pack', 'user_sticker_pack_user_id_pack_id_key'),
    ('user_private_message', 'user_private_message_sticker_id_idx'),
    ('user_private_message', 'user_private_message_reply_sticker_id_idx')
), existing_indexes AS (
  SELECT tablename AS table_name, indexname AS index_name
  FROM pg_indexes
  WHERE schemaname = 'public'
)
SELECT
  'required_index' AS check_type,
  required_indexes.table_name,
  required_indexes.index_name,
  CASE WHEN existing_indexes.index_name IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_indexes
LEFT JOIN existing_indexes
  ON existing_indexes.table_name = required_indexes.table_name
 AND existing_indexes.index_name = required_indexes.index_name
ORDER BY required_indexes.table_name, required_indexes.index_name;

WITH required_foreign_keys(table_name, constraint_name, expected_actions) AS (
  VALUES
    ('sticker', 'sticker_pack_id_fkey', 'ON DELETE RESTRICT ON UPDATE CASCADE'),
    ('user_sticker_pack', 'user_sticker_pack_user_id_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'),
    ('user_sticker_pack', 'user_sticker_pack_pack_id_fkey', 'ON DELETE CASCADE ON UPDATE CASCADE'),
    ('user_private_message', 'user_private_message_sticker_id_fkey', 'ON DELETE SET NULL ON UPDATE CASCADE'),
    ('user_private_message', 'user_private_message_reply_sticker_id_fkey', 'ON DELETE SET NULL ON UPDATE CASCADE')
), existing_foreign_keys AS (
  SELECT
    table_class.relname AS table_name,
    constraint_row.conname AS constraint_name,
    pg_get_constraintdef(constraint_row.oid) AS definition
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS table_class
    ON table_class.oid = constraint_row.conrelid
  JOIN pg_namespace AS table_namespace
    ON table_namespace.oid = table_class.relnamespace
  WHERE table_namespace.nspname = 'public'
    AND constraint_row.contype = 'f'
)
SELECT
  'required_foreign_key' AS check_type,
  required_foreign_keys.table_name,
  required_foreign_keys.constraint_name,
  CASE
    WHEN existing_foreign_keys.constraint_name IS NULL THEN 'missing'
    WHEN position(
      upper(required_foreign_keys.expected_actions)
      IN upper(existing_foreign_keys.definition)
    ) > 0 THEN 'ok'
    ELSE 'definition_mismatch'
  END AS status,
  required_foreign_keys.expected_actions,
  existing_foreign_keys.definition AS actual_definition
FROM required_foreign_keys
LEFT JOIN existing_foreign_keys
  USING (table_name, constraint_name)
ORDER BY required_foreign_keys.table_name, required_foreign_keys.constraint_name;
