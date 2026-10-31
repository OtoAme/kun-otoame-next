-- Adds the console's lookup indexes (decision 10, §10.4). Run the matching
-- preflight first. Indexes only: no data is read or changed.
--
-- Run outside an explicit transaction block: CREATE INDEX CONCURRENTLY cannot
-- run inside one. Each index is handled on its own and the file is safe to
-- run again:
--   - missing                         -> created concurrently
--   - left invalid by an interrupted build -> dropped and rebuilt
--   - valid with the target definition -> kept
--   - anything else under the name     -> the run stops; review by hand

\set ON_ERROR_STOP on

DO $tables$
BEGIN
  IF to_regclass('public.admin_log') IS NULL
    OR to_regclass('public."user"') IS NULL
    OR to_regclass('public.patch_company_name_identity') IS NULL THEN
    RAISE EXCEPTION 'A target table is missing; run the preflight';
  END IF;
END
$tables$;

-- Returns name_exists / is_valid_target / needs_rebuild for one index name.
CREATE OR REPLACE FUNCTION pg_temp.index_state(target_name text, target_definition text)
RETURNS TABLE (name_exists boolean, is_valid_target boolean, needs_rebuild boolean)
LANGUAGE sql AS $fn$
  SELECT
    existing.oid IS NOT NULL,
    COALESCE(
      existing.relkind IN ('i', 'I')
        AND index_row.indisready AND index_row.indisvalid AND index_row.indislive
        AND pg_get_indexdef(existing.oid) = target_definition,
      false),
    COALESCE(
      existing.relkind IN ('i', 'I')
        AND NOT (index_row.indisready AND index_row.indisvalid AND index_row.indislive)
        AND pg_get_indexdef(existing.oid) = target_definition,
      false)
  FROM (SELECT 1) seed
  LEFT JOIN pg_class existing
    ON existing.relnamespace = 'public'::regnamespace
   AND existing.relname = target_name
  LEFT JOIN pg_index index_row ON index_row.indexrelid = existing.oid
$fn$;

-- 1. admin_log (user_id, created): today's processed count.
SELECT * FROM pg_temp.index_state('admin_log_user_id_created_idx',
  'CREATE INDEX admin_log_user_id_created_idx ON public.admin_log USING btree (user_id, created)')
\gset log_user_
\if :log_user_needs_rebuild
  DROP INDEX CONCURRENTLY public.admin_log_user_id_created_idx;
  CREATE INDEX CONCURRENTLY admin_log_user_id_created_idx ON public.admin_log (user_id, created);
\elif :log_user_is_valid_target
  \echo 'admin_log_user_id_created_idx already present'
\elif :log_user_name_exists
  \echo 'admin_log_user_id_created_idx exists with an incompatible definition'
  SELECT 1 / 0 AS dashboard_index_migration_aborted;
\else
  CREATE INDEX CONCURRENTLY admin_log_user_id_created_idx ON public.admin_log (user_id, created);
\endif

-- 2. admin_log (created DESC, id DESC): log page and recent operations.
SELECT * FROM pg_temp.index_state('admin_log_created_id_idx',
  'CREATE INDEX admin_log_created_id_idx ON public.admin_log USING btree (created DESC, id DESC)')
\gset log_time_
\if :log_time_needs_rebuild
  DROP INDEX CONCURRENTLY public.admin_log_created_id_idx;
  CREATE INDEX CONCURRENTLY admin_log_created_id_idx ON public.admin_log (created DESC, id DESC);
\elif :log_time_is_valid_target
  \echo 'admin_log_created_id_idx already present'
\elif :log_time_name_exists
  \echo 'admin_log_created_id_idx exists with an incompatible definition'
  SELECT 1 / 0 AS dashboard_index_migration_aborted;
\else
  CREATE INDEX CONCURRENTLY admin_log_created_id_idx ON public.admin_log (created DESC, id DESC);
\endif

-- 3. user (created): new registrations per day.
SELECT * FROM pg_temp.index_state('user_created_idx',
  'CREATE INDEX user_created_idx ON public."user" USING btree (created)')
\gset user_time_
\if :user_time_needs_rebuild
  DROP INDEX CONCURRENTLY public.user_created_idx;
  CREATE INDEX CONCURRENTLY user_created_idx ON public."user" (created);
\elif :user_time_is_valid_target
  \echo 'user_created_idx already present'
\elif :user_time_name_exists
  \echo 'user_created_idx exists with an incompatible definition'
  SELECT 1 / 0 AS dashboard_index_migration_aborted;
\else
  CREATE INDEX CONCURRENTLY user_created_idx ON public."user" (created);
\endif

-- 4. patch_company_name_identity (kind, origin, value): legacy alias lookup.
SELECT * FROM pg_temp.index_state('patch_company_name_identity_kind_origin_value_idx',
  'CREATE INDEX patch_company_name_identity_kind_origin_value_idx ON public.patch_company_name_identity USING btree (kind, origin, value)')
\gset alias_
\if :alias_needs_rebuild
  DROP INDEX CONCURRENTLY public.patch_company_name_identity_kind_origin_value_idx;
  CREATE INDEX CONCURRENTLY patch_company_name_identity_kind_origin_value_idx
    ON public.patch_company_name_identity (kind, origin, value);
\elif :alias_is_valid_target
  \echo 'patch_company_name_identity_kind_origin_value_idx already present'
\elif :alias_name_exists
  \echo 'patch_company_name_identity_kind_origin_value_idx exists with an incompatible definition'
  SELECT 1 / 0 AS dashboard_index_migration_aborted;
\else
  CREATE INDEX CONCURRENTLY patch_company_name_identity_kind_origin_value_idx
    ON public.patch_company_name_identity (kind, origin, value);
\endif

-- Postflight: all four present, valid and with the target definition.
DO $postflight$
DECLARE
  ok_count integer;
BEGIN
  SELECT count(*) INTO ok_count
  FROM (VALUES
    ('admin_log_user_id_created_idx',
     'CREATE INDEX admin_log_user_id_created_idx ON public.admin_log USING btree (user_id, created)'),
    ('admin_log_created_id_idx',
     'CREATE INDEX admin_log_created_id_idx ON public.admin_log USING btree (created DESC, id DESC)'),
    ('user_created_idx',
     'CREATE INDEX user_created_idx ON public."user" USING btree (created)'),
    ('patch_company_name_identity_kind_origin_value_idx',
     'CREATE INDEX patch_company_name_identity_kind_origin_value_idx ON public.patch_company_name_identity USING btree (kind, origin, value)')
  ) target(index_name, definition)
  JOIN pg_class existing
    ON existing.relnamespace = 'public'::regnamespace
   AND existing.relname = target.index_name
  JOIN pg_index index_row ON index_row.indexrelid = existing.oid
  WHERE index_row.indisready AND index_row.indisvalid AND index_row.indislive
    AND pg_get_indexdef(existing.oid) = target.definition;

  IF ok_count <> 4 THEN
    RAISE EXCEPTION 'dashboard index postflight failed: % of 4 indexes valid', ok_count;
  END IF;
END
$postflight$;
