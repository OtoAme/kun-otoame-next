-- Read-only preflight for the console's lookup indexes (decision 10, §10.4).
-- Reports the target tables, any object already holding a target name, and
-- row counts so the operator can judge build time. Nothing here writes.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

WITH target(index_name, table_name, definition) AS (
  VALUES
    ('admin_log_user_id_created_idx', 'admin_log',
     'CREATE INDEX admin_log_user_id_created_idx ON public.admin_log USING btree (user_id, created)'),
    ('admin_log_created_id_idx', 'admin_log',
     'CREATE INDEX admin_log_created_id_idx ON public.admin_log USING btree (created DESC, id DESC)'),
    ('user_created_idx', 'user',
     'CREATE INDEX user_created_idx ON public."user" USING btree (created)'),
    ('patch_company_name_identity_kind_origin_value_idx', 'patch_company_name_identity',
     'CREATE INDEX patch_company_name_identity_kind_origin_value_idx ON public.patch_company_name_identity USING btree (kind, origin, value)')
)
SELECT
  target.index_name,
  CASE
    WHEN to_regclass(format('public.%I', target.table_name)) IS NULL THEN 'table_missing'
    WHEN existing.oid IS NULL THEN 'to_create'
    WHEN existing.relkind NOT IN ('i', 'I') THEN 'name_taken_by_non_index'
    WHEN NOT (index_row.indisready AND index_row.indisvalid AND index_row.indislive) THEN 'invalid_will_rebuild'
    WHEN pg_get_indexdef(existing.oid) = target.definition THEN 'already_ok'
    ELSE 'incompatible_definition'
  END AS status,
  CASE WHEN existing.oid IS NOT NULL THEN pg_get_indexdef(existing.oid) END AS current_definition
FROM target
LEFT JOIN pg_class existing
  ON existing.relnamespace = 'public'::regnamespace
 AND existing.relname = target.index_name
LEFT JOIN pg_index index_row ON index_row.indexrelid = existing.oid
ORDER BY target.index_name;

-- Column shapes the definitions rely on.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('admin_log', 'user_id'), ('admin_log', 'created'), ('admin_log', 'id'),
    ('user', 'created'),
    ('patch_company_name_identity', 'kind'),
    ('patch_company_name_identity', 'origin'),
    ('patch_company_name_identity', 'value')
  )
ORDER BY table_name, column_name;

-- Approximate sizes; building takes roughly a few seconds per million rows.
SELECT relname AS table_name, reltuples::bigint AS approx_rows,
       pg_size_pretty(pg_relation_size(oid)) AS heap_size
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('admin_log', 'user', 'patch_company_name_identity')
ORDER BY relname;

COMMIT;
