-- Read-only preflight for module 06 official-mirror structures and attached_at
-- stamp candidates. A created value shared by more than 50 links is only a
-- candidate. This file does not classify any group as the link-split migration.
-- Historical sample sizes are not acceptance constants.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.patch_resource') IS NULL
     OR to_regclass('public.patch_resource_link') IS NULL THEN
    RAISE EXCEPTION
      'official mirror preflight: patch_resource and patch_resource_link must already exist';
  END IF;
END $$;

SELECT
  'patch_resource' AS table_name,
  column_name,
  is_nullable,
  column_default,
  data_type,
  datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch_resource'
  AND column_name IN ('id', 'user_id', 'created', 'publisher_left_at')
UNION ALL
SELECT
  'patch_resource_link',
  column_name,
  is_nullable,
  column_default,
  data_type,
  datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patch_resource_link'
  AND column_name IN ('id', 'resource_id', 'created', 'download', 'attached_at', 'click')
ORDER BY 1, 2;

SELECT
  required.table_name,
  to_regclass(format('public.%I', required.table_name)) IS NOT NULL AS present
FROM (VALUES
  ('patch_resource_backup_state'),
  ('patch_resource_merge_record'),
  ('patch_resource_file_cleanup'),
  ('patch_resource_link_attached_at_fill')
) AS required(table_name)
ORDER BY required.table_name;

-- Every distinct link created value, including groups at or below the candidate
-- threshold. stamp_candidate is true only when the group has more than 50 links.
SELECT
  to_char(created, 'YYYY-MM-DD HH24:MI:SS.MS') AS created_text,
  count(*)::bigint AS link_count,
  count(*) > 50 AS stamp_candidate
FROM public.patch_resource_link
GROUP BY created
ORDER BY link_count DESC, created;

DO $$
DECLARE
  null_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_resource_link'
      AND column_name = 'attached_at'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.patch_resource_link WHERE attached_at IS NULL'
      INTO null_count;
    RAISE NOTICE 'attached_at null rows: %', null_count;
  ELSE
    RAISE NOTICE 'attached_at column: absent';
  END IF;
END $$;

COMMIT;
