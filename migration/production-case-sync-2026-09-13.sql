-- Idempotent M03 case schema sync.
-- Run the read-only preflight first and the matching postflight afterwards.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $base_table_guard$
BEGIN
  IF to_regclass('public."user"') IS NULL
     OR to_regclass('public.patch') IS NULL THEN
    RAISE EXCEPTION
      'case sync failed: public.user and public.patch are required before the case tables';
  END IF;
END
$base_table_guard$;

-- Validate any already-named target objects before CREATE TABLE/INDEX can
-- silently keep or skip them. Missing objects are created below; existing
-- compatible objects are retained.
DO $existing_target_guard$
DECLARE
  required_table text;
  relation_oid oid;
  relation_kind "char";
  index_contract record;
  index_actual record;
  actual_columns text;
  constraint_contract record;
  constraint_actual record;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ops_case',
    'ops_case_message',
    'ops_case_subscriber'
  ]
  LOOP
    relation_oid := to_regclass(format('public.%I', required_table));
    IF relation_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT relkind
    INTO relation_kind
    FROM pg_class
    WHERE oid = relation_oid;

    IF relation_kind <> 'r' THEN
      RAISE EXCEPTION
        'case sync failed: public.% is not an ordinary table (relkind=%)',
        required_table,
        relation_kind;
    END IF;
  END LOOP;

  FOR index_contract IN
    SELECT * FROM (VALUES
      ('ops_case_pkey', 'ops_case', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_dedup_key_key', 'ops_case', TRUE, FALSE, 'dedup_key', $$\(\s*dedup_key\s*\)$$),
      ('ops_case_daily_key_key', 'ops_case', TRUE, FALSE, 'daily_key', $$\(\s*daily_key\s*\)$$),
      ('ops_case_status_status_changed_at_idx', 'ops_case', FALSE, FALSE, 'status,status_changed_at', $$\(\s*status\s*,\s*status_changed_at\s*\)$$),
      ('ops_case_owner_type_owner_id_status_status_changed_at_idx', 'ops_case', FALSE, FALSE, 'owner_type,owner_id,status,status_changed_at', $$\(\s*owner_type\s*,\s*owner_id\s*,\s*status\s*,\s*status_changed_at\s*\)$$),
      ('ops_case_reporter_id_created_idx', 'ops_case', FALSE, FALSE, 'reporter_id,created', $$\(\s*reporter_id\s*,\s*created DESC\s*\)$$),
      ('ops_case_target_type_target_id_status_idx', 'ops_case', FALSE, FALSE, 'target_type,target_id,status', $$\(\s*target_type\s*,\s*target_id\s*,\s*status\s*\)$$),
      ('ops_case_patch_id_status_idx', 'ops_case', FALSE, FALSE, 'patch_id,status', $$\(\s*patch_id\s*,\s*status\)$$),
      ('ops_case_message_pkey', 'ops_case_message', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_message_case_id_id_idx', 'ops_case_message', FALSE, FALSE, 'case_id,id', $$\(\s*case_id\s*,\s*id\s*\)$$),
      ('ops_case_message_case_id_created_id_idx', 'ops_case_message', FALSE, FALSE, 'case_id,created,id', $$\(\s*case_id\s*,\s*created\s*,\s*id\s*\)$$),
      ('ops_case_subscriber_pkey', 'ops_case_subscriber', TRUE, TRUE, 'id', $$\(\s*id\s*\)$$),
      ('ops_case_subscriber_case_id_user_id_key', 'ops_case_subscriber', TRUE, FALSE, 'case_id,user_id', $$\(\s*case_id\s*,\s*user_id\)$$),
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
        'case sync failed: index name % is occupied by a non-index object',
        index_contract.index_name;
    END IF;

    IF index_actual.indrelid IS DISTINCT FROM to_regclass(format('public.%I', index_contract.table_name)) THEN
      RAISE EXCEPTION
        'case sync failed: index % belongs to the wrong table',
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
        'case sync failed: index % definition/state mismatch',
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
        'case sync failed: index % source columns mismatch',
        index_contract.index_name;
    END IF;
  END LOOP;

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
        'case sync failed: FK constraint % definition/action mismatch',
        constraint_contract.constraint_name;
    END IF;
  END LOOP;
END
$existing_target_guard$;

CREATE TABLE IF NOT EXISTS public.ops_case (
  id                      SERIAL PRIMARY KEY,
  kind                    VARCHAR(32) NOT NULL,
  target_type             VARCHAR(16) NOT NULL,
  target_id               INTEGER NOT NULL,
  patch_id                INTEGER,
  reporter_id             INTEGER,
  owner_type              VARCHAR(16) NOT NULL,
  owner_id                INTEGER,
  status                  VARCHAR(20) NOT NULL DEFAULT 'open',
  resolution              VARCHAR(32),
  public                  BOOLEAN NOT NULL DEFAULT FALSE,
  source                  VARCHAR(16) NOT NULL DEFAULT 'user',
  dedup_key               VARCHAR(96),
  daily_key               VARCHAR(96),
  revision                INTEGER NOT NULL DEFAULT 0,
  status_changed_at       TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queue_entered_at        TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at               TIMESTAMP(3) WITHOUT TIME ZONE,
  escalated_at            TIMESTAMP(3) WITHOUT TIME ZONE,
  first_owner_response_at TIMESTAMP(3) WITHOUT TIME ZONE,
  hidden_at               TIMESTAMP(3) WITHOUT TIME ZONE,
  restored_at             TIMESTAMP(3) WITHOUT TIME ZONE,
  reopened_count          INTEGER NOT NULL DEFAULT 0,
  created                 TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated                 TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ops_case_message (
  id        SERIAL PRIMARY KEY,
  case_id   INTEGER NOT NULL,
  author_id INTEGER,
  kind      VARCHAR(8) NOT NULL DEFAULT 'reply',
  event     VARCHAR(24),
  payload   JSONB,
  body      VARCHAR(5007) NOT NULL,
  created   TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.ops_case_subscriber (
  id      SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ops_case_subscriber_case_id_user_id_key UNIQUE (case_id, user_id)
);

-- A table that was created by an interrupted or unrelated rollout must not be
-- repaired in place. The sync only accepts exact columns and defaults, then
-- adds missing indexes/FKs below without changing existing definitions.
DO $existing_case_tables$
DECLARE
  table_contract record;
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
        'case sync refused: public.% is partial or incompatible (columns=%, expected=%, mismatches=%)',
        table_contract.table_name,
        actual_count,
        table_contract.expected_columns,
        mismatch_count;
    END IF;
  END LOOP;
END
$existing_case_tables$;

DO $case_foreign_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_patch_id_fkey'
      AND conrelid = 'public.ops_case'::regclass
  ) THEN
    ALTER TABLE public.ops_case
      ADD CONSTRAINT ops_case_patch_id_fkey
      FOREIGN KEY (patch_id) REFERENCES public.patch(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_reporter_id_fkey'
      AND conrelid = 'public.ops_case'::regclass
  ) THEN
    ALTER TABLE public.ops_case
      ADD CONSTRAINT ops_case_reporter_id_fkey
      FOREIGN KEY (reporter_id) REFERENCES public."user"(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_owner_id_fkey'
      AND conrelid = 'public.ops_case'::regclass
  ) THEN
    ALTER TABLE public.ops_case
      ADD CONSTRAINT ops_case_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES public."user"(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_message_case_id_fkey'
      AND conrelid = 'public.ops_case_message'::regclass
  ) THEN
    ALTER TABLE public.ops_case_message
      ADD CONSTRAINT ops_case_message_case_id_fkey
      FOREIGN KEY (case_id) REFERENCES public.ops_case(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_message_author_id_fkey'
      AND conrelid = 'public.ops_case_message'::regclass
  ) THEN
    ALTER TABLE public.ops_case_message
      ADD CONSTRAINT ops_case_message_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES public."user"(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_subscriber_case_id_fkey'
      AND conrelid = 'public.ops_case_subscriber'::regclass
  ) THEN
    ALTER TABLE public.ops_case_subscriber
      ADD CONSTRAINT ops_case_subscriber_case_id_fkey
      FOREIGN KEY (case_id) REFERENCES public.ops_case(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ops_case_subscriber_user_id_fkey'
      AND conrelid = 'public.ops_case_subscriber'::regclass
  ) THEN
    ALTER TABLE public.ops_case_subscriber
      ADD CONSTRAINT ops_case_subscriber_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public."user"(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END
$case_foreign_keys$;

CREATE UNIQUE INDEX IF NOT EXISTS ops_case_dedup_key_key
  ON public.ops_case (dedup_key);
CREATE UNIQUE INDEX IF NOT EXISTS ops_case_daily_key_key
  ON public.ops_case (daily_key);
CREATE INDEX IF NOT EXISTS ops_case_status_status_changed_at_idx
  ON public.ops_case (status, status_changed_at);
CREATE INDEX IF NOT EXISTS ops_case_owner_type_owner_id_status_status_changed_at_idx
  ON public.ops_case (owner_type, owner_id, status, status_changed_at);
CREATE INDEX IF NOT EXISTS ops_case_reporter_id_created_idx
  ON public.ops_case (reporter_id, created DESC);
CREATE INDEX IF NOT EXISTS ops_case_target_type_target_id_status_idx
  ON public.ops_case (target_type, target_id, status);
CREATE INDEX IF NOT EXISTS ops_case_patch_id_status_idx
  ON public.ops_case (patch_id, status);

CREATE INDEX IF NOT EXISTS ops_case_message_case_id_id_idx
  ON public.ops_case_message (case_id, id);
CREATE INDEX IF NOT EXISTS ops_case_message_case_id_created_id_idx
  ON public.ops_case_message (case_id, created, id);

CREATE UNIQUE INDEX IF NOT EXISTS ops_case_subscriber_case_id_user_id_key
  ON public.ops_case_subscriber (case_id, user_id);
CREATE INDEX IF NOT EXISTS ops_case_subscriber_user_id_created_idx
  ON public.ops_case_subscriber (user_id, created DESC);

COMMIT;
