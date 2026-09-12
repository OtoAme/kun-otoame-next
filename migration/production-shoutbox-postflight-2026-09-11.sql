-- Independent read-only verification for the M02 shoutbox schema sync.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $required_tables$
BEGIN
  IF to_regclass('public.shoutbox') IS NULL
     OR to_regclass('public.patch_report') IS NULL THEN
    RAISE EXCEPTION
      'shoutbox postflight failed: shoutbox and patch_report must both exist';
  END IF;
END
$required_tables$;

SELECT
  'shoutbox_rows' AS check_type,
  COUNT(*)::bigint AS shoutbox_count
FROM public.shoutbox;

SELECT
  'patch_report_rows' AS check_type,
  COUNT(*)::bigint AS report_count,
  COUNT(*) FILTER (WHERE patch_id IS NULL)::bigint AS null_patch_id_count
FROM public.patch_report;

WITH required_columns(
  table_name,
  column_name,
  expected_type,
  expected_nullable,
  expected_length,
  expected_precision,
  default_policy
) AS (
  VALUES
    ('shoutbox', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
    ('shoutbox', 'user_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('shoutbox', 'request_id', 'character varying', 'NO', 64, NULL::integer, 'forbidden'),
    ('shoutbox', 'content', 'character varying', 'NO', 500, NULL::integer, 'forbidden'),
    ('shoutbox', 'link', 'character varying', 'NO', 1000, NULL::integer, 'empty_string'),
    ('shoutbox', 'official', 'boolean', 'NO', NULL::integer, NULL::integer, 'false'),
    ('shoutbox', 'level', 'character varying', 'NO', 16, NULL::integer, 'normal'),
    ('shoutbox', 'status', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('shoutbox', 'cost', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('shoutbox', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('shoutbox', 'effective_from', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'effective_to', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'edited_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'refunded_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('shoutbox', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden'),
    ('patch_report', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_report', 'shoutbox_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden')
), existing AS (
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    character_maximum_length,
    datetime_precision,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
)
SELECT
  'required_column' AS check_type,
  required.table_name,
  required.column_name,
  CASE
    WHEN existing.column_name IS NULL THEN 'missing'
    WHEN existing.data_type <> required.expected_type
      OR existing.is_nullable <> required.expected_nullable
      OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
      OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
      THEN 'definition_mismatch'
    WHEN required.default_policy = 'forbidden'
      AND existing.column_default IS NOT NULL THEN 'default_mismatch'
    WHEN required.default_policy = 'sequence'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^nextval\($$ THEN 'default_mismatch'
    WHEN required.default_policy = 'empty_string'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^''::character varying$$ THEN 'default_mismatch'
    WHEN required.default_policy = 'false'
      AND lower(COALESCE(existing.column_default, '')) <> 'false' THEN 'default_mismatch'
    WHEN required.default_policy = 'normal'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^'normal'::character varying$$ THEN 'default_mismatch'
    WHEN required.default_policy = 'zero'
      AND COALESCE(existing.column_default, '') <> '0' THEN 'default_mismatch'
    WHEN required.default_policy = 'current_timestamp'
      AND upper(COALESCE(existing.column_default, '')) !~ $$^CURRENT_TIMESTAMP$$ THEN 'default_mismatch'
    ELSE 'present'
  END AS status,
  existing.data_type AS actual_type,
  existing.is_nullable AS actual_nullable,
  existing.character_maximum_length AS actual_length,
  existing.datetime_precision AS actual_precision,
  existing.column_default AS actual_default
FROM required_columns required
LEFT JOIN existing
  ON existing.table_name = required.table_name
 AND existing.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

WITH required_indexes(
  index_name,
  table_name,
  must_be_unique,
  must_be_primary,
  expected_columns,
  definition_pattern
) AS (
  VALUES
    ('shoutbox_pkey', 'shoutbox', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
    ('shoutbox_user_id_request_id_key', 'shoutbox', TRUE, FALSE, 'user_id,request_id', $$\(\s*user_id\s*,\s*request_id\s*\)$$),
    ('shoutbox_status_created_id_idx', 'shoutbox', FALSE, FALSE, 'status,created,id', $$\(\s*status\s*,\s*created DESC\s*,\s*id DESC\s*\)$$),
    ('shoutbox_patch_id_status_created_idx', 'shoutbox', FALSE, FALSE, 'patch_id,status,created', $$\(\s*patch_id\s*,\s*status\s*,\s*created DESC\s*\)$$),
    ('shoutbox_user_id_created_id_idx', 'shoutbox', FALSE, FALSE, 'user_id,created,id', $$\(\s*user_id\s*,\s*created DESC\s*,\s*id DESC\s*\)$$),
    ('shoutbox_official_status_effective_to_idx', 'shoutbox', FALSE, FALSE, 'official,status,effective_to', $$\(\s*official\s*,\s*status\s*,\s*effective_to\s*\)$$),
    ('patch_report_target_type_shoutbox_id_status_idx', 'patch_report', FALSE, FALSE, 'target_type,shoutbox_id,status', $$\(\s*target_type\s*,\s*shoutbox_id\s*,\s*status\s*\)$$)
)
SELECT
  'required_index' AS check_type,
  required.index_name,
  CASE WHEN index_row.indexrelid IS NULL THEN 'missing' ELSE 'present' END AS status,
  pg_get_indexdef(index_row.indexrelid) AS definition,
  index_row.indisunique,
  index_row.indisprimary,
  index_row.indisvalid,
  index_row.indisready,
  index_row.indislive
FROM required_indexes required
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = required.index_name
LEFT JOIN pg_index index_row
  ON index_row.indexrelid = index_class.oid
 AND index_row.indrelid = to_regclass(format('public.%I', required.table_name))
ORDER BY required.index_name;

WITH required_constraints(
  constraint_name,
  table_name,
  constraint_type,
  source_column,
  referenced_table,
  referenced_column,
  delete_action,
  update_action,
  definition_pattern
) AS (
  VALUES
    ('shoutbox_pkey', 'shoutbox', 'p', 'id', NULL::text, NULL::text, NULL::text, NULL::text, $$PRIMARY KEY$$),
    ('shoutbox_status_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$status.*0.*1.*2.*3$$),
    ('shoutbox_level_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$level.*normal.*important$$),
    ('shoutbox_cost_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$cost.*>=.*0$$),
    ('shoutbox_shape_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$official.*effective_from.*effective_to.*effective_to.*effective_from.*level.*link$$),
    ('shoutbox_user_id_fkey', 'shoutbox', 'f', 'user_id', 'user', 'id', 'c', 'a', NULL::text),
    ('shoutbox_patch_id_fkey', 'shoutbox', 'f', 'patch_id', 'patch', 'id', 'n', 'a', NULL::text),
    ('patch_report_shoutbox_id_fkey', 'patch_report', 'f', 'shoutbox_id', 'shoutbox', 'id', 'n', 'a', NULL::text)
)
SELECT
  'required_constraint' AS check_type,
  required.constraint_name,
  CASE WHEN constraint_row.oid IS NULL THEN 'missing' ELSE 'present' END AS status,
  constraint_row.contype,
  constraint_row.convalidated,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM required_constraints required
LEFT JOIN pg_constraint constraint_row
  ON constraint_row.conname = required.constraint_name
 AND constraint_row.conrelid = to_regclass(format('public.%I', required.table_name))
ORDER BY required.constraint_name;

DO $postflight$
DECLARE
  mismatch_count integer;
  index_contract record;
  index_actual record;
  actual_columns text;
  constraint_contract record;
  constraint_actual record;
BEGIN
  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('shoutbox', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
    ('shoutbox', 'user_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('shoutbox', 'request_id', 'character varying', 'NO', 64, NULL::integer, 'forbidden'),
    ('shoutbox', 'content', 'character varying', 'NO', 500, NULL::integer, 'forbidden'),
    ('shoutbox', 'link', 'character varying', 'NO', 1000, NULL::integer, 'empty_string'),
    ('shoutbox', 'official', 'boolean', 'NO', NULL::integer, NULL::integer, 'false'),
    ('shoutbox', 'level', 'character varying', 'NO', 16, NULL::integer, 'normal'),
    ('shoutbox', 'status', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('shoutbox', 'cost', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('shoutbox', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('shoutbox', 'effective_from', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'effective_to', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'edited_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'refunded_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('shoutbox', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('shoutbox', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden'),
    ('patch_report', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('patch_report', 'shoutbox_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden')
  ) AS required(table_name, column_name, expected_type, expected_nullable, expected_length, expected_precision, default_policy)
  LEFT JOIN information_schema.columns existing
    ON existing.table_schema = 'public'
   AND existing.table_name = required.table_name
   AND existing.column_name = required.column_name
  WHERE existing.column_name IS NULL
     OR existing.data_type <> required.expected_type
     OR existing.is_nullable <> required.expected_nullable
     OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
     OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
     OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL)
     OR (required.default_policy = 'sequence' AND lower(COALESCE(existing.column_default, '')) !~ $$^nextval\($$)
     OR (required.default_policy = 'empty_string' AND lower(COALESCE(existing.column_default, '')) !~ $$^''::character varying$$)
     OR (required.default_policy = 'false' AND lower(COALESCE(existing.column_default, '')) <> 'false')
     OR (required.default_policy = 'normal' AND lower(COALESCE(existing.column_default, '')) !~ $$^'normal'::character varying$$)
     OR (required.default_policy = 'zero' AND COALESCE(existing.column_default, '') <> '0')
     OR (required.default_policy = 'current_timestamp' AND upper(COALESCE(existing.column_default, '')) !~ $$^CURRENT_TIMESTAMP$$);

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'shoutbox postflight failed: column/default mismatches=%', mismatch_count;
  END IF;

  FOR index_contract IN
    SELECT * FROM (VALUES
      ('shoutbox_pkey', 'shoutbox', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('shoutbox_user_id_request_id_key', 'shoutbox', TRUE, FALSE, 'user_id,request_id', $$\(\s*user_id\s*,\s*request_id\s*\)$$),
      ('shoutbox_status_created_id_idx', 'shoutbox', FALSE, FALSE, 'status,created,id', $$\(\s*status\s*,\s*created DESC\s*,\s*id DESC\s*\)$$),
      ('shoutbox_patch_id_status_created_idx', 'shoutbox', FALSE, FALSE, 'patch_id,status,created', $$\(\s*patch_id\s*,\s*status\s*,\s*created DESC\s*\)$$),
      ('shoutbox_user_id_created_id_idx', 'shoutbox', FALSE, FALSE, 'user_id,created,id', $$\(\s*user_id\s*,\s*created DESC\s*,\s*id DESC\s*\)$$),
      ('shoutbox_official_status_effective_to_idx', 'shoutbox', FALSE, FALSE, 'official,status,effective_to', $$\(\s*official\s*,\s*status\s*,\s*effective_to\s*\)$$),
      ('patch_report_target_type_shoutbox_id_status_idx', 'patch_report', FALSE, FALSE, 'target_type,shoutbox_id,status', $$\(\s*target_type\s*,\s*shoutbox_id\s*,\s*status\s*\)$$)
    ) AS contract(index_name, table_name, must_be_unique, must_be_primary, expected_columns, definition_pattern)
  LOOP
    SELECT
      ix.indexrelid,
      ix.indrelid,
      ix.indisunique,
      ix.indisprimary,
      ix.indisvalid,
      ix.indisready,
      ix.indislive,
      ix.indpred,
      ix.indexprs,
      ix.indnkeyatts,
      ix.indnatts,
      ix.indkey
    INTO index_actual
    FROM pg_index ix
    JOIN pg_class index_class ON index_class.oid = ix.indexrelid
    WHERE index_class.relnamespace = 'public'::regnamespace
      AND index_class.relname = index_contract.index_name
      AND ix.indrelid = to_regclass(format('public.%I', index_contract.table_name));

    IF index_actual.indexrelid IS NULL
       OR index_actual.indisunique <> index_contract.must_be_unique
       OR index_actual.indisprimary <> index_contract.must_be_primary
       OR NOT index_actual.indisvalid
       OR NOT index_actual.indisready
       OR NOT index_actual.indislive
       OR index_actual.indpred IS NOT NULL
       OR index_actual.indexprs IS NOT NULL
       OR index_actual.indnkeyatts <> cardinality(string_to_array(index_contract.expected_columns, ','))
       OR index_actual.indnatts <> index_actual.indnkeyatts
       OR pg_get_indexdef(index_actual.indexrelid) !~ index_contract.definition_pattern THEN
      RAISE EXCEPTION 'shoutbox postflight failed: index % definition/state mismatch', index_contract.index_name;
    END IF;

    SELECT string_agg(attribute_row.attname, ',' ORDER BY key_row.ordinality)
    INTO actual_columns
    FROM unnest(index_actual.indkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_actual.indrelid
     AND attribute_row.attnum = key_row.attnum
    WHERE key_row.ordinality <= index_actual.indnkeyatts;

    IF actual_columns IS DISTINCT FROM index_contract.expected_columns THEN
      RAISE EXCEPTION 'shoutbox postflight failed: index % source columns mismatch', index_contract.index_name;
    END IF;
  END LOOP;

  FOR constraint_contract IN
    SELECT * FROM (VALUES
      ('shoutbox_pkey', 'shoutbox', 'p', 'id', NULL::text, NULL::text, NULL::text, NULL::text, $$PRIMARY KEY$$),
      ('shoutbox_status_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$status.*0.*1.*2.*3$$),
      ('shoutbox_level_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$level.*normal.*important$$),
      ('shoutbox_cost_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$cost.*>=.*0$$),
      ('shoutbox_shape_check', 'shoutbox', 'c', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, $$official.*effective_from.*effective_to.*effective_to.*effective_from.*level.*link$$),
      ('shoutbox_user_id_fkey', 'shoutbox', 'f', 'user_id', 'user', 'id', 'c', 'a', NULL::text),
      ('shoutbox_patch_id_fkey', 'shoutbox', 'f', 'patch_id', 'patch', 'id', 'n', 'a', NULL::text),
      ('patch_report_shoutbox_id_fkey', 'patch_report', 'f', 'shoutbox_id', 'shoutbox', 'id', 'n', 'a', NULL::text)
    ) AS contract(constraint_name, table_name, constraint_type, source_column, referenced_table, referenced_column, delete_action, update_action, definition_pattern)
  LOOP
    SELECT
      con.oid,
      con.conrelid,
      con.confrelid,
      con.contype,
      con.convalidated,
      con.confdeltype,
      con.confupdtype,
      con.conkey,
      con.confkey,
      pg_get_constraintdef(con.oid) AS definition
    INTO constraint_actual
    FROM pg_constraint con
    WHERE con.conname = constraint_contract.constraint_name
      AND con.conrelid = to_regclass(format('public.%I', constraint_contract.table_name));

    IF constraint_actual.oid IS NULL
       OR constraint_actual.contype <> constraint_contract.constraint_type
       OR constraint_actual.convalidated IS NOT TRUE THEN
      RAISE EXCEPTION 'shoutbox postflight failed: constraint % type/validation mismatch', constraint_contract.constraint_name;
    END IF;

    IF constraint_contract.constraint_type = 'c'
       AND constraint_actual.definition !~ constraint_contract.definition_pattern THEN
      RAISE EXCEPTION 'shoutbox postflight failed: CHECK constraint % definition mismatch', constraint_contract.constraint_name;
    END IF;

    IF constraint_contract.constraint_type IN ('p', 'f')
       AND NOT EXISTS (
         SELECT 1
         FROM pg_attribute source_attribute
         WHERE source_attribute.attrelid = constraint_actual.conrelid
           AND source_attribute.attname = constraint_contract.source_column
           AND source_attribute.attnum > 0
           AND constraint_actual.conkey = ARRAY[source_attribute.attnum]::smallint[]
       ) THEN
      RAISE EXCEPTION 'shoutbox postflight failed: constraint % source column mismatch', constraint_contract.constraint_name;
    END IF;

    IF constraint_contract.constraint_type = 'f'
       AND (
         constraint_actual.confrelid <> to_regclass(format('public.%I', constraint_contract.referenced_table))
         OR constraint_actual.confdeltype::text <> constraint_contract.delete_action
         OR constraint_actual.confupdtype::text <> constraint_contract.update_action
         OR NOT EXISTS (
           SELECT 1
           FROM pg_attribute referenced_attribute
           WHERE referenced_attribute.attrelid = constraint_actual.confrelid
             AND referenced_attribute.attname = constraint_contract.referenced_column
             AND referenced_attribute.attnum > 0
             AND constraint_actual.confkey = ARRAY[referenced_attribute.attnum]::smallint[]
         )
       ) THEN
      RAISE EXCEPTION 'shoutbox postflight failed: FK constraint % definition/action mismatch', constraint_contract.constraint_name;
    END IF;
  END LOOP;
END
$postflight$;

COMMIT;
