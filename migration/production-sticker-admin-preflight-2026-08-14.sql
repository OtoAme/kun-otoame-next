-- Read-only preflight for the admin Sticker management schema.
-- Run after production-private-chat-stickers-preflight/sync and review every
-- non-ok result before applying the matching sync script.

WITH required_columns(table_name, column_name, expected_type, expected_nullable) AS (
  VALUES
    ('sticker_pack', 'cover_storage_key', 'character varying', 'YES'),
    ('sticker_pack', 'cover_sticker_id', 'character varying', 'YES'),
    ('sticker', 'asset_url', 'character varying', 'YES'),
    ('sticker', 'status', 'integer', 'NO'),
    ('sticker', 'content_hash', 'character', 'YES')
), existing_columns AS (
  SELECT table_name, column_name, data_type, is_nullable
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
  ec.is_nullable AS actual_nullable
FROM required_columns rc
LEFT JOIN existing_columns ec
  ON ec.table_name = rc.table_name
 AND ec.column_name = rc.column_name
ORDER BY rc.table_name, rc.column_name;

WITH required_indexes(table_name, index_name) AS (
  VALUES
    ('sticker_pack', 'sticker_pack_cover_sticker_id_idx'),
    ('sticker', 'sticker_pack_id_content_hash_key'),
    ('sticker', 'sticker_content_hash_idx'),
    ('sticker', 'sticker_pack_id_status_sort_order_idx')
), existing_indexes AS (
  SELECT tablename AS table_name, indexname AS index_name
  FROM pg_indexes
  WHERE schemaname = 'public'
)
SELECT
  'required_index' AS check_type,
  ri.table_name,
  ri.index_name,
  CASE WHEN ei.index_name IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_indexes ri
LEFT JOIN existing_indexes ei
  ON ei.table_name = ri.table_name
 AND ei.index_name = ri.index_name
ORDER BY ri.table_name, ri.index_name;

WITH required_foreign_keys(table_name, constraint_name, expected_actions) AS (
  VALUES
    ('sticker_pack', 'sticker_pack_cover_sticker_id_fkey', 'ON DELETE SET NULL ON UPDATE CASCADE')
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

SELECT
  'duplicate_content_hash' AS check_type,
  s.pack_id,
  to_jsonb(s)->>'content_hash' AS content_hash,
  COUNT(*) AS duplicate_count,
  'must be empty before the unique index is created' AS status
FROM public.sticker
  AS s
WHERE to_jsonb(s) ? 'content_hash'
  AND to_jsonb(s)->>'content_hash' IS NOT NULL
GROUP BY s.pack_id, to_jsonb(s)->>'content_hash'
HAVING COUNT(*) > 1
ORDER BY s.pack_id, content_hash;

SELECT
  'invalid_cover_reference' AS check_type,
  pack.id AS pack_id,
  to_jsonb(pack)->>'cover_sticker_id' AS cover_sticker_id,
  CASE
    WHEN to_jsonb(pack)->>'cover_sticker_id' IS NULL THEN 'ok'
    WHEN sticker.id IS NULL THEN 'missing_sticker'
    WHEN sticker.pack_id <> pack.id THEN 'wrong_pack'
    WHEN (to_jsonb(sticker)->>'status')::integer <> 1 THEN 'disabled_sticker'
    ELSE 'ok'
  END AS status
FROM public.sticker_pack pack
LEFT JOIN public.sticker sticker
  ON sticker.id = to_jsonb(pack)->>'cover_sticker_id'
WHERE to_jsonb(pack)->>'cover_sticker_id' IS NOT NULL
  AND (
    sticker.id IS NULL
    OR sticker.pack_id <> pack.id
    OR (to_jsonb(sticker)->>'status')::integer <> 1
  )
ORDER BY pack.id;
