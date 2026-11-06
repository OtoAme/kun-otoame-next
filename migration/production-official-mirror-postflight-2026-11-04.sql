-- Read-only postflight for module 06. Asserts structure, defaults, and that
-- attached_at has no nulls. Prints the manifest's resource_created row count;
-- that observed count is not compared with any historical sample size.
-- Business tables may contain rows written after the initial sync.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $postflight$
DECLARE
  attached_nullable text;
  attached_default text;
  attached_type text;
  attached_precision integer;
  attached_nulls bigint;
  click_nullable text;
  click_default text;
  publisher_nullable text;
  publisher_default text;
  publisher_type text;
  publisher_precision integer;
  bad_timestamps integer;
  partial_uniques integer;
  merge_fks integer;
  cleanup_fks integer;
  backup_cascades integer;
  fill_cascades integer;
  pair_index integer;
  staff_index integer;
  cleanup_unique integer;
BEGIN
  SELECT is_nullable, column_default, data_type, datetime_precision
  INTO attached_nullable, attached_default, attached_type, attached_precision
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_resource_link'
    AND column_name = 'attached_at';
  IF attached_nullable IS DISTINCT FROM 'NO'
     OR attached_default IS NULL
     OR attached_default NOT LIKE '%CURRENT_TIMESTAMP%'
     OR attached_type IS DISTINCT FROM 'timestamp without time zone'
     OR attached_precision IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'attached_at must be timestamp(3) without time zone, NOT NULL, default CURRENT_TIMESTAMP';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.patch_resource_link WHERE attached_at IS NULL'
    INTO attached_nulls;
  IF attached_nulls <> 0 THEN
    RAISE EXCEPTION 'attached_at still has % null rows', attached_nulls;
  END IF;

  SELECT is_nullable, column_default
  INTO click_nullable, click_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_resource_link'
    AND column_name = 'click';
  IF click_nullable IS DISTINCT FROM 'NO' OR click_default IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'click must be NOT NULL DEFAULT 0';
  END IF;

  SELECT is_nullable, column_default, data_type, datetime_precision
  INTO publisher_nullable, publisher_default, publisher_type, publisher_precision
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'patch_resource'
    AND column_name = 'publisher_left_at';
  IF publisher_nullable IS DISTINCT FROM 'YES'
     OR publisher_default IS NOT NULL
     OR publisher_type IS DISTINCT FROM 'timestamp without time zone'
     OR publisher_precision IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION
      'publisher_left_at must be nullable timestamp(3) without time zone and have no default';
  END IF;

  SELECT count(*)
  INTO bad_timestamps
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'patch_resource' AND column_name = 'publisher_left_at')
      OR (table_name = 'patch_resource_link' AND column_name = 'attached_at')
      OR (table_name = 'patch_resource_backup_state' AND column_name IN ('ignored_at', 'rebackup_dismissed_at'))
      OR (table_name = 'patch_resource_merge_record' AND column_name = 'handled_at')
      OR (table_name = 'patch_resource_file_cleanup' AND column_name IN ('created', 'updated'))
      OR (
        table_name = 'patch_resource_link_attached_at_fill'
        AND column_name IN ('link_created', 'resource_created', 'filled_value', 'created')
      )
    )
    AND (
      data_type IS DISTINCT FROM 'timestamp without time zone'
      OR datetime_precision IS DISTINCT FROM 3
    );
  IF bad_timestamps <> 0 THEN
    RAISE EXCEPTION
      'official mirror timestamps must be timestamp(3) without time zone';
  END IF;

  IF to_regclass('public.patch_resource_backup_state') IS NULL
     OR to_regclass('public.patch_resource_merge_record') IS NULL
     OR to_regclass('public.patch_resource_file_cleanup') IS NULL
     OR to_regclass('public.patch_resource_link_attached_at_fill') IS NULL THEN
    RAISE EXCEPTION 'official mirror tables are missing';
  END IF;

  SELECT count(*)
  INTO partial_uniques
  FROM pg_index AS index_metadata
  JOIN pg_class AS indexed_table ON indexed_table.oid = index_metadata.indrelid
  JOIN pg_namespace AS namespace ON namespace.oid = indexed_table.relnamespace
  WHERE namespace.nspname = 'public'
    AND indexed_table.relname IN (
      'patch_resource_backup_state',
      'patch_resource_merge_record',
      'patch_resource_file_cleanup',
      'patch_resource_link_attached_at_fill'
    )
    AND index_metadata.indisunique
    AND index_metadata.indpred IS NOT NULL;
  IF partial_uniques <> 0 THEN
    RAISE EXCEPTION 'official mirror tables must not use partial unique indexes';
  END IF;

  SELECT count(*)
  INTO merge_fks
  FROM pg_constraint
  WHERE conrelid = 'public.patch_resource_merge_record'::regclass
    AND contype = 'f';
  IF merge_fks <> 0 THEN
    RAISE EXCEPTION 'merge records must not reference resources with a foreign key';
  END IF;

  SELECT count(*)
  INTO cleanup_fks
  FROM pg_constraint
  WHERE conrelid = 'public.patch_resource_file_cleanup'::regclass
    AND contype = 'f';
  IF cleanup_fks <> 0 THEN
    RAISE EXCEPTION 'file cleanup rows must not cascade with the resource';
  END IF;

  SELECT count(*)
  INTO backup_cascades
  FROM pg_constraint
  WHERE conrelid = 'public.patch_resource_backup_state'::regclass
    AND contype = 'f'
    AND confrelid = 'public.patch_resource'::regclass
    AND confdeltype = 'c';
  IF backup_cascades <> 1 THEN
    RAISE EXCEPTION 'backup state must cascade from its resource';
  END IF;

  SELECT count(*)
  INTO fill_cascades
  FROM pg_constraint
  WHERE conrelid = 'public.patch_resource_link_attached_at_fill'::regclass
    AND contype = 'f'
    AND confrelid = 'public.patch_resource_link'::regclass
    AND confdeltype = 'c';
  IF fill_cascades <> 1 THEN
    RAISE EXCEPTION 'attached_at fill rows must follow their link';
  END IF;

  SELECT count(*)
  INTO pair_index
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'patch_resource_merge_record_pair_key';
  SELECT count(*)
  INTO staff_index
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'patch_resource_merge_record_staff_status_idx';
  SELECT count(*)
  INTO cleanup_unique
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'patch_resource_file_cleanup_object_key_key';
  IF pair_index <> 1 OR staff_index <> 1 OR cleanup_unique <> 1 THEN
    RAISE EXCEPTION 'official mirror indexes are missing';
  END IF;
END
$postflight$;

SELECT count(*)::bigint AS confirmed_stamp_links
FROM public.patch_resource_link_attached_at_fill
WHERE fill_source = 'resource_created';

SELECT 'patch_resource_backup_state' AS table_name, count(*)::bigint AS row_count
FROM public.patch_resource_backup_state
UNION ALL
SELECT 'patch_resource_merge_record', count(*)::bigint
FROM public.patch_resource_merge_record
UNION ALL
SELECT 'patch_resource_file_cleanup', count(*)::bigint
FROM public.patch_resource_file_cleanup
UNION ALL
SELECT 'patch_resource_link_attached_at_fill', count(*)::bigint
FROM public.patch_resource_link_attached_at_fill
ORDER BY table_name;

COMMIT;
