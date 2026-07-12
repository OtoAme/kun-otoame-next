-- Production schema preflight for allowing multiple patches to share one Steam App ID.
-- This script is read-only: it reports the current steam_id column, constraints, indexes,
-- and any duplicate Steam IDs that will be allowed after the sync script runs.

\set ON_ERROR_STOP on

SELECT
  'patch_table' AS check_type,
  CASE
    WHEN to_regclass('public.patch') IS NULL THEN 'missing'
    ELSE 'present'
  END AS status;

SELECT
  'steam_id_column' AS check_type,
  CASE
    WHEN c.column_name IS NULL THEN 'missing'
    WHEN c.data_type <> 'integer' THEN 'type_mismatch'
    ELSE 'ok'
  END AS status,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM (
  SELECT 1
) seed
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'patch'
 AND c.column_name = 'steam_id';

SELECT
  'steam_id_constraint' AS check_type,
  con.conname AS name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'patch'
  AND pg_get_constraintdef(con.oid) ILIKE '%steam_id%'
ORDER BY con.conname;

SELECT
  'steam_id_index' AS check_type,
  idx.relname AS name,
  ix.indisunique AS is_unique,
  ix.indisready,
  ix.indisvalid,
  ix.indislive,
  access_method.amname AS access_method,
  pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
  pg_get_expr(ix.indexprs, ix.indrelid) AS expression,
  pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class tbl ON tbl.oid = ix.indrelid
JOIN pg_namespace nsp ON nsp.oid = tbl.relnamespace
JOIN pg_class idx ON idx.oid = ix.indexrelid
JOIN pg_am access_method ON access_method.oid = idx.relam
WHERE nsp.nspname = 'public'
  AND tbl.relname = 'patch'
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%steam_id%'
ORDER BY idx.relname;

SELECT
  'duplicate_steam_id_preview' AS check_type,
  steam_id,
  COUNT(*) AS patch_count,
  ARRAY_AGG(unique_id ORDER BY id) AS patch_unique_ids
FROM public.patch
WHERE steam_id IS NOT NULL
GROUP BY steam_id
HAVING COUNT(*) > 1
ORDER BY patch_count DESC, steam_id
LIMIT 50;
