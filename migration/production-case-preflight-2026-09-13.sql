-- Read-only inventory for the M03 case schema rollout.
-- Run this file before the matching sync and review every result.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $base_table_guard$
DECLARE
  required_table text;
  relation_oid oid;
  relation_kind "char";
BEGIN
  FOREACH required_table IN ARRAY ARRAY['user', 'patch']
  LOOP
    relation_oid := to_regclass(format('public.%I', required_table));
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'case preflight failed: required base table public.% is missing', required_table;
    END IF;

    SELECT relkind
    INTO relation_kind
    FROM pg_class
    WHERE oid = relation_oid;

    IF relation_kind <> 'r' THEN
      RAISE EXCEPTION
        'case preflight failed: public.% is not an ordinary table (relkind=%)',
        required_table,
        relation_kind;
    END IF;
  END LOOP;
END
$base_table_guard$;

WITH required_tables(table_name) AS (
  VALUES
    ('ops_case'),
    ('ops_case_message'),
    ('ops_case_subscriber')
), existing_tables AS (
  SELECT
    class_row.relname AS table_name,
    class_row.relkind
  FROM pg_class class_row
  WHERE class_row.relnamespace = 'public'::regnamespace
)
SELECT
  'required_table' AS check_type,
  required.table_name,
  CASE
    WHEN existing.table_name IS NULL THEN 'ready_to_create'
    WHEN existing.relkind = 'r' THEN 'present_review_definition'
    ELSE 'name_conflict'
  END AS status,
  existing.relkind
FROM required_tables required
LEFT JOIN existing_tables existing USING (table_name)
ORDER BY required.table_name;

WITH required_sequences(sequence_name) AS (
  VALUES
    ('ops_case_id_seq'),
    ('ops_case_message_id_seq'),
    ('ops_case_subscriber_id_seq')
)
SELECT
  'required_sequence' AS check_type,
  required.sequence_name,
  CASE
    WHEN sequence_row.oid IS NULL THEN 'ready_to_create'
    WHEN sequence_row.relkind = 'S' THEN 'present_review_definition'
    ELSE 'name_conflict'
  END AS status,
  sequence_row.relkind
FROM required_sequences required
LEFT JOIN pg_class sequence_row
  ON sequence_row.relnamespace = 'public'::regnamespace
 AND sequence_row.relname = required.sequence_name
ORDER BY required.sequence_name;

WITH required_indexes(index_name) AS (
  VALUES
    ('ops_case_pkey'),
    ('ops_case_dedup_key_key'),
    ('ops_case_daily_key_key'),
    ('ops_case_status_status_changed_at_idx'),
    ('ops_case_owner_type_owner_id_status_status_changed_at_idx'),
    ('ops_case_reporter_id_created_idx'),
    ('ops_case_target_type_target_id_status_idx'),
    ('ops_case_patch_id_status_idx'),
    ('ops_case_message_pkey'),
    ('ops_case_message_case_id_id_idx'),
    ('ops_case_message_case_id_created_id_idx'),
    ('ops_case_subscriber_pkey'),
    ('ops_case_subscriber_case_id_user_id_key'),
    ('ops_case_subscriber_user_id_created_idx')
)
SELECT
  'required_index' AS check_type,
  required.index_name,
  CASE
    WHEN index_class.oid IS NULL THEN 'ready_to_create'
    WHEN index_class.relkind <> 'i' OR index_row.indexrelid IS NULL THEN 'name_conflict'
    ELSE 'present_review_definition'
  END AS status,
  index_class.relkind AS object_kind,
  index_row.indnullsnotdistinct,
  pg_get_indexdef(index_row.indexrelid) AS index_definition
FROM required_indexes required
LEFT JOIN pg_class index_class
  ON index_class.relnamespace = 'public'::regnamespace
 AND index_class.relname = required.index_name
LEFT JOIN pg_index index_row
  ON index_row.indexrelid = index_class.oid
ORDER BY required.index_name;

-- The cutover keeps old records in place. These two counts are the baseline
-- used to confirm that the switched endpoints no longer append to old queues.
SELECT
  'legacy_feedback_snapshot' AS check_type,
  COUNT(*)::bigint AS row_count
FROM public.user_message
WHERE type = 'feedback';

SELECT
  'legacy_patch_report_snapshot' AS check_type,
  COUNT(*)::bigint AS row_count
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
    ('ops_case', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
    ('ops_case', 'kind', 'character varying', 'NO', 32, NULL::integer, 'forbidden'),
    ('ops_case', 'target_type', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
    ('ops_case', 'target_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case', 'reporter_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case', 'owner_type', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
    ('ops_case', 'owner_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case', 'status', 'character varying', 'NO', 20, NULL::integer, 'open'),
    ('ops_case', 'resolution', 'character varying', 'YES', 32, NULL::integer, 'forbidden'),
    ('ops_case', 'public', 'boolean', 'NO', NULL::integer, NULL::integer, 'false'),
    ('ops_case', 'source', 'character varying', 'NO', 16, NULL::integer, 'user'),
    ('ops_case', 'dedup_key', 'character varying', 'YES', 96, NULL::integer, 'forbidden'),
    ('ops_case', 'daily_key', 'character varying', 'YES', 96, NULL::integer, 'forbidden'),
    ('ops_case', 'revision', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('ops_case', 'status_changed_at', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('ops_case', 'queue_entered_at', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('ops_case', 'closed_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('ops_case', 'escalated_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('ops_case', 'first_owner_response_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('ops_case', 'hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('ops_case', 'restored_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
    ('ops_case', 'reopened_count', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
    ('ops_case', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('ops_case', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden'),
    ('ops_case_message', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
    ('ops_case_message', 'case_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case_message', 'author_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case_message', 'kind', 'character varying', 'NO', 8, NULL::integer, 'reply'),
    ('ops_case_message', 'event', 'character varying', 'YES', 24, NULL::integer, 'forbidden'),
    ('ops_case_message', 'payload', 'jsonb', 'YES', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case_message', 'body', 'character varying', 'NO', 5007, NULL::integer, 'forbidden'),
    ('ops_case_message', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
    ('ops_case_subscriber', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
    ('ops_case_subscriber', 'case_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case_subscriber', 'user_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
    ('ops_case_subscriber', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp')
), existing_columns AS (
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
    WHEN required.default_policy = 'open'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^'open'::character varying$$ THEN 'default_mismatch'
    WHEN required.default_policy = 'reply'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^'reply'::character varying$$ THEN 'default_mismatch'
    WHEN required.default_policy = 'user'
      AND lower(COALESCE(existing.column_default, '')) !~ $$^'user'::character varying$$ THEN 'default_mismatch'
    WHEN required.default_policy = 'false'
      AND lower(COALESCE(existing.column_default, '')) <> 'false' THEN 'default_mismatch'
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
LEFT JOIN existing_columns existing
  ON existing.table_name = required.table_name
 AND existing.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

-- Existing target tables are safe to keep only when their columns and defaults
-- already match this contract. Missing tables are left for the sync to create.
DO $table_conflict_guard$
DECLARE
  table_contract record;
  relation_oid oid;
  relation_kind "char";
  actual_count integer;
  expected_count integer;
  mismatch_count integer;
BEGIN
  FOR table_contract IN
    SELECT * FROM (VALUES
      ('ops_case', 25),
      ('ops_case_message', 8),
      ('ops_case_subscriber', 4)
    ) AS contract(table_name, expected_columns)
  LOOP
    relation_oid := to_regclass(format('public.%I', table_contract.table_name));
    IF relation_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT relkind
    INTO relation_kind
    FROM pg_class
    WHERE oid = relation_oid;

    IF relation_kind <> 'r' THEN
      RAISE EXCEPTION
        'case preflight failed: public.% is not an ordinary table (relkind=%)',
        table_contract.table_name,
        relation_kind;
    END IF;

    SELECT COUNT(*)
    INTO actual_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = table_contract.table_name;

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE existing.column_name IS NULL
         OR existing.data_type <> required.expected_type
         OR existing.is_nullable <> required.expected_nullable
         OR existing.character_maximum_length IS DISTINCT FROM required.expected_length
         OR existing.datetime_precision IS DISTINCT FROM required.expected_precision
         OR (required.default_policy = 'forbidden' AND existing.column_default IS NOT NULL)
         OR (required.default_policy = 'sequence' AND lower(COALESCE(existing.column_default, '')) !~ $$^nextval\($$)
         OR (required.default_policy = 'open' AND lower(COALESCE(existing.column_default, '')) !~ $$^'open'::character varying$$)
         OR (required.default_policy = 'reply' AND lower(COALESCE(existing.column_default, '')) !~ $$^'reply'::character varying$$)
         OR (required.default_policy = 'user' AND lower(COALESCE(existing.column_default, '')) !~ $$^'user'::character varying$$)
         OR (required.default_policy = 'false' AND lower(COALESCE(existing.column_default, '')) <> 'false')
         OR (required.default_policy = 'zero' AND COALESCE(existing.column_default, '') <> '0')
         OR (required.default_policy = 'current_timestamp' AND upper(COALESCE(existing.column_default, '')) !~ $$^CURRENT_TIMESTAMP$$)
    )
    INTO expected_count, mismatch_count
    FROM (VALUES
      ('ops_case', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
      ('ops_case', 'kind', 'character varying', 'NO', 32, NULL::integer, 'forbidden'),
      ('ops_case', 'target_type', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
      ('ops_case', 'target_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case', 'patch_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case', 'reporter_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case', 'owner_type', 'character varying', 'NO', 16, NULL::integer, 'forbidden'),
      ('ops_case', 'owner_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case', 'status', 'character varying', 'NO', 20, NULL::integer, 'open'),
      ('ops_case', 'resolution', 'character varying', 'YES', 32, NULL::integer, 'forbidden'),
      ('ops_case', 'public', 'boolean', 'NO', NULL::integer, NULL::integer, 'false'),
      ('ops_case', 'source', 'character varying', 'NO', 16, NULL::integer, 'user'),
      ('ops_case', 'dedup_key', 'character varying', 'YES', 96, NULL::integer, 'forbidden'),
      ('ops_case', 'daily_key', 'character varying', 'YES', 96, NULL::integer, 'forbidden'),
      ('ops_case', 'revision', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
      ('ops_case', 'status_changed_at', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
      ('ops_case', 'queue_entered_at', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
      ('ops_case', 'closed_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
      ('ops_case', 'escalated_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
      ('ops_case', 'first_owner_response_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
      ('ops_case', 'hidden_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
      ('ops_case', 'restored_at', 'timestamp without time zone', 'YES', NULL::integer, 3, 'forbidden'),
      ('ops_case', 'reopened_count', 'integer', 'NO', NULL::integer, NULL::integer, 'zero'),
      ('ops_case', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
      ('ops_case', 'updated', 'timestamp without time zone', 'NO', NULL::integer, 3, 'forbidden'),
      ('ops_case_message', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
      ('ops_case_message', 'case_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case_message', 'author_id', 'integer', 'YES', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case_message', 'kind', 'character varying', 'NO', 8, NULL::integer, 'reply'),
      ('ops_case_message', 'event', 'character varying', 'YES', 24, NULL::integer, 'forbidden'),
      ('ops_case_message', 'payload', 'jsonb', 'YES', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case_message', 'body', 'character varying', 'NO', 5007, NULL::integer, 'forbidden'),
      ('ops_case_message', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp'),
      ('ops_case_subscriber', 'id', 'integer', 'NO', NULL::integer, NULL::integer, 'sequence'),
      ('ops_case_subscriber', 'case_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case_subscriber', 'user_id', 'integer', 'NO', NULL::integer, NULL::integer, 'forbidden'),
      ('ops_case_subscriber', 'created', 'timestamp without time zone', 'NO', NULL::integer, 3, 'current_timestamp')
    ) AS required(table_name, column_name, expected_type, expected_nullable, expected_length, expected_precision, default_policy)
    LEFT JOIN information_schema.columns existing
      ON existing.table_schema = 'public'
     AND existing.table_name = required.table_name
     AND existing.column_name = required.column_name
    WHERE required.table_name = table_contract.table_name;

    IF actual_count <> table_contract.expected_columns
       OR expected_count <> table_contract.expected_columns
       OR mismatch_count <> 0 THEN
      RAISE EXCEPTION
        'case preflight failed: public.% is partial or incompatible (columns=%, expected=%, mismatches=%)',
        table_contract.table_name,
        actual_count,
        table_contract.expected_columns,
        mismatch_count;
    END IF;
  END LOOP;
END
$table_conflict_guard$;

-- A named index is a shared schema object. Reject a same-name table, an index
-- on another table, or an incompatible/partial index before the sync can skip
-- it via IF NOT EXISTS.
DO $index_conflict_guard$
DECLARE
  index_contract record;
  index_actual record;
  actual_columns text;
BEGIN
  FOR index_contract IN
    SELECT * FROM (VALUES
      ('ops_case_pkey', 'ops_case', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_dedup_key_key', 'ops_case', TRUE, FALSE, 'dedup_key', $$\(\s*dedup_key\s*\)$$),
      ('ops_case_daily_key_key', 'ops_case', TRUE, FALSE, 'daily_key', $$\(\s*daily_key\s*\)$$),
      ('ops_case_status_status_changed_at_idx', 'ops_case', FALSE, FALSE, 'status,status_changed_at', $$\(\s*status\s*,\s*status_changed_at\s*\)$$),
      ('ops_case_owner_type_owner_id_status_status_changed_at_idx', 'ops_case', FALSE, FALSE, 'owner_type,owner_id,status,status_changed_at', $$\(\s*owner_type\s*,\s*owner_id\s*,\s*status\s*,\s*status_changed_at\s*\)$$),
      ('ops_case_reporter_id_created_idx', 'ops_case', FALSE, FALSE, 'reporter_id,created', $$\(\s*reporter_id\s*,\s*created DESC\s*\)$$),
      ('ops_case_target_type_target_id_status_idx', 'ops_case', FALSE, FALSE, 'target_type,target_id,status', $$\(\s*target_type\s*,\s*target_id\s*,\s*status\s*\)$$),
      ('ops_case_patch_id_status_idx', 'ops_case', FALSE, FALSE, 'patch_id,status', $$\(\s*patch_id\s*,\s*status\s*\)$$),
      ('ops_case_message_pkey', 'ops_case_message', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_message_case_id_id_idx', 'ops_case_message', FALSE, FALSE, 'case_id,id', $$\(\s*case_id\s*,\s*id\s*\)$$),
      ('ops_case_message_case_id_created_id_idx', 'ops_case_message', FALSE, FALSE, 'case_id,created,id', $$\(\s*case_id\s*,\s*created\s*,\s*id\s*\)$$),
      ('ops_case_subscriber_pkey', 'ops_case_subscriber', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_subscriber_case_id_user_id_key', 'ops_case_subscriber', TRUE, FALSE, 'case_id,user_id', $$\(\s*case_id\s*,\s*user_id\s*\)$$),
      ('ops_case_subscriber_user_id_created_idx', 'ops_case_subscriber', FALSE, FALSE, 'user_id,created', $$\(\s*user_id\s*,\s*created DESC\s*\)$$)
    ) AS contract(index_name, table_name, must_be_unique, must_be_primary, expected_columns, definition_pattern)
  LOOP
    SELECT
      object_row.oid,
      object_row.relkind,
      index_row.indexrelid,
      index_row.indrelid,
      index_row.indisunique,
      index_row.indisprimary,
      index_row.indnullsnotdistinct,
      index_row.indisvalid,
      index_row.indisready,
      index_row.indislive,
      index_row.indpred,
      index_row.indexprs,
      index_row.indnkeyatts,
      index_row.indnatts,
      index_row.indkey
    INTO index_actual
    FROM pg_class object_row
    LEFT JOIN pg_index index_row ON index_row.indexrelid = object_row.oid
    WHERE object_row.relnamespace = 'public'::regnamespace
      AND object_row.relname = index_contract.index_name;

    IF index_actual.oid IS NULL THEN
      CONTINUE;
    END IF;

    IF index_actual.relkind <> 'i' OR index_actual.indexrelid IS NULL THEN
      RAISE EXCEPTION
        'case preflight failed: index name % is occupied by a non-index object',
        index_contract.index_name;
    END IF;

    IF index_actual.indrelid IS DISTINCT FROM to_regclass(format('public.%I', index_contract.table_name)) THEN
      RAISE EXCEPTION
        'case preflight failed: index % belongs to the wrong table',
        index_contract.index_name;
    END IF;

    IF index_actual.indisunique <> index_contract.must_be_unique
       OR index_actual.indisprimary <> index_contract.must_be_primary
       OR index_actual.indnullsnotdistinct IS NOT FALSE
       OR NOT index_actual.indisvalid
       OR NOT index_actual.indisready
       OR NOT index_actual.indislive
       OR index_actual.indpred IS NOT NULL
       OR index_actual.indexprs IS NOT NULL
       OR index_actual.indnkeyatts <> cardinality(string_to_array(index_contract.expected_columns, ','))
       OR index_actual.indnatts <> index_actual.indnkeyatts
       OR pg_get_indexdef(index_actual.indexrelid) !~ index_contract.definition_pattern THEN
      RAISE EXCEPTION
        'case preflight failed: index % definition/state mismatch',
        index_contract.index_name;
    END IF;

    SELECT string_agg(attribute_row.attname, ',' ORDER BY key_row.ordinality)
    INTO actual_columns
    FROM unnest(index_actual.indkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = index_actual.indrelid
     AND attribute_row.attnum = key_row.attnum
    WHERE key_row.ordinality <= index_actual.indnkeyatts;

    IF actual_columns IS DISTINCT FROM index_contract.expected_columns THEN
      RAISE EXCEPTION
        'case preflight failed: index % source columns mismatch',
        index_contract.index_name;
    END IF;
  END LOOP;
END
$index_conflict_guard$;

WITH required_constraints(constraint_name, table_name) AS (
  VALUES
    ('ops_case_pkey', 'ops_case'),
    ('ops_case_message_pkey', 'ops_case_message'),
    ('ops_case_subscriber_pkey', 'ops_case_subscriber'),
    ('ops_case_patch_id_fkey', 'ops_case'),
    ('ops_case_reporter_id_fkey', 'ops_case'),
    ('ops_case_owner_id_fkey', 'ops_case'),
    ('ops_case_message_case_id_fkey', 'ops_case_message'),
    ('ops_case_message_author_id_fkey', 'ops_case_message'),
    ('ops_case_subscriber_case_id_fkey', 'ops_case_subscriber'),
    ('ops_case_subscriber_user_id_fkey', 'ops_case_subscriber')
)
SELECT
  'required_constraint' AS check_type,
  required.table_name,
  required.constraint_name,
  CASE
    WHEN constraint_row.oid IS NULL THEN 'missing'
    ELSE 'present_review_definition'
  END AS status,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM required_constraints required
LEFT JOIN pg_constraint constraint_row
  ON constraint_row.conname = required.constraint_name
 AND constraint_row.conrelid = to_regclass(format('public.%I', required.table_name))
ORDER BY required.table_name, required.constraint_name;

-- Do not let a same-name FK silently block or bypass the intended relation
-- action. Existing valid constraints are retained; incompatible ones stop the
-- rollout before any DDL is attempted.
DO $foreign_key_conflict_guard$
DECLARE
  constraint_contract record;
  constraint_actual record;
BEGIN
  FOR constraint_contract IN
    SELECT * FROM (VALUES
      ('ops_case_patch_id_fkey', 'ops_case', 'patch_id', 'patch', 'id', 'n', 'a'),
      ('ops_case_reporter_id_fkey', 'ops_case', 'reporter_id', 'user', 'id', 'n', 'a'),
      ('ops_case_owner_id_fkey', 'ops_case', 'owner_id', 'user', 'id', 'n', 'a'),
      ('ops_case_message_case_id_fkey', 'ops_case_message', 'case_id', 'ops_case', 'id', 'c', 'a'),
      ('ops_case_message_author_id_fkey', 'ops_case_message', 'author_id', 'user', 'id', 'n', 'a'),
      ('ops_case_subscriber_case_id_fkey', 'ops_case_subscriber', 'case_id', 'ops_case', 'id', 'c', 'a'),
      ('ops_case_subscriber_user_id_fkey', 'ops_case_subscriber', 'user_id', 'user', 'id', 'c', 'a')
    ) AS contract(constraint_name, table_name, source_column, referenced_table, referenced_column, delete_action, update_action)
  LOOP
    SELECT
      constraint_row.oid,
      constraint_row.conrelid,
      constraint_row.confrelid,
      constraint_row.contype,
      constraint_row.convalidated,
      constraint_row.condeferrable,
      constraint_row.condeferred,
      constraint_row.confmatchtype,
      constraint_row.confdeltype,
      constraint_row.confupdtype,
      constraint_row.conkey,
      constraint_row.confkey
    INTO constraint_actual
    FROM pg_constraint constraint_row
    WHERE constraint_row.conname = constraint_contract.constraint_name
      AND constraint_row.conrelid = to_regclass(format('public.%I', constraint_contract.table_name));

    IF constraint_actual.oid IS NULL THEN
      CONTINUE;
    END IF;

    IF constraint_actual.contype <> 'f'
       OR constraint_actual.convalidated IS NOT TRUE
       OR constraint_actual.condeferrable
       OR constraint_actual.condeferred
       OR constraint_actual.confmatchtype <> 's'
       OR constraint_actual.confrelid IS DISTINCT FROM to_regclass(format('public.%I', constraint_contract.referenced_table))
       OR constraint_actual.confdeltype::text <> constraint_contract.delete_action
       OR constraint_actual.confupdtype::text <> constraint_contract.update_action
       OR NOT EXISTS (
         SELECT 1
         FROM pg_attribute source_attribute
         WHERE source_attribute.attrelid = constraint_actual.conrelid
           AND source_attribute.attname = constraint_contract.source_column
           AND source_attribute.attnum > 0
           AND NOT source_attribute.attisdropped
           AND constraint_actual.conkey = ARRAY[source_attribute.attnum]::smallint[]
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_attribute referenced_attribute
         WHERE referenced_attribute.attrelid = constraint_actual.confrelid
           AND referenced_attribute.attname = constraint_contract.referenced_column
           AND referenced_attribute.attnum > 0
           AND NOT referenced_attribute.attisdropped
           AND constraint_actual.confkey = ARRAY[referenced_attribute.attnum]::smallint[]
       ) THEN
      RAISE EXCEPTION
        'case preflight failed: FK constraint % definition/action mismatch',
        constraint_contract.constraint_name;
    END IF;
  END LOOP;
END
$foreign_key_conflict_guard$;

COMMIT;
