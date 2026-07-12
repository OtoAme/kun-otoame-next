-- Read-only production preflight for bootstrapping the Phase 2 resource access table.
-- Run with: psql -X -v ON_ERROR_STOP=1 "$KUN_DATABASE_URL" -f this-file.sql

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $bootstrap_preflight$
DECLARE
  access_relation oid := to_regclass('public.patch_resource_access');
  grant_relation oid := to_regclass('public.patch_resource_access_grant');
  sequence_relation oid := to_regclass('public.patch_resource_access_id_seq');
  relation_name text;
  relation_oid oid;
  relation_kind "char";
  access_kind_count integer;
  actual_count integer;
  matching_count integer;
  unexpected_count integer;
  id_attnum smallint;
  conflict_names text[] := ARRAY[
    'patch_resource_access',
    'patch_resource_access_id_seq',
    'patch_resource_access_pkey',
    'patch_resource_access_user_id_link_id_expires_idx',
    'patch_resource_access_visitor_token_link_id_expires_idx',
    'patch_resource_access_patch_id_created_idx',
    'patch_resource_access_resource_id_created_idx',
    'patch_resource_access_link_id_created_idx',
    'patch_resource_access_grant',
    'patch_resource_access_grant_pkey',
    'resource_access_grant_expires_idx',
    'resource_access_visitor_kind_created_idx'
  ];
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'user',
    'patch',
    'patch_resource',
    'patch_resource_link'
  ]
  LOOP
    relation_oid := to_regclass(format('public.%I', relation_name));
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'Missing required table public.%', relation_name;
    END IF;

    SELECT relkind INTO relation_kind FROM pg_class WHERE oid = relation_oid;
    IF relation_kind <> 'r' THEN
      RAISE EXCEPTION 'public.% must be an ordinary table, found relkind %', relation_name, relation_kind;
    END IF;

    SELECT COUNT(*)
    INTO matching_count
    FROM pg_constraint constraint_row
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attname = 'id'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE constraint_row.conrelid = relation_oid
      AND constraint_row.contype = 'p'
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND constraint_row.conkey = ARRAY[attribute.attnum]::smallint[]
      AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer'
      AND attribute.attnotnull;

    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'public.%.id must be the validated non-deferrable integer primary key', relation_name;
    END IF;
  END LOOP;

  IF access_relation IS NULL THEN
    SELECT COUNT(*)
    INTO actual_count
    FROM pg_class relation
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relname = ANY(conflict_names);

    IF actual_count <> 0 THEN
      RAISE EXCEPTION 'Bootstrap relation-name conflict: %', (
        SELECT array_agg(relation.relname ORDER BY relation.relname)
        FROM pg_class relation
        WHERE relation.relnamespace = 'public'::regnamespace
          AND relation.relname = ANY(conflict_names)
      );
    END IF;

    RAISE NOTICE 'bootstrap_state=ready_to_create';
    RETURN;
  END IF;

  SELECT relkind INTO relation_kind FROM pg_class WHERE oid = access_relation;
  IF relation_kind <> 'r' THEN
    RAISE EXCEPTION 'public.patch_resource_access must be an ordinary table, found relkind %', relation_kind;
  END IF;

  SELECT COUNT(*)
  INTO access_kind_count
  FROM pg_attribute
  WHERE attrelid = access_relation
    AND attname = 'access_kind'
    AND attnum > 0
    AND NOT attisdropped;

  IF access_kind_count NOT IN (0, 1) THEN
    RAISE EXCEPTION 'Unexpected access_kind catalog count: %', access_kind_count;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE attribute.attidentity = ''
        AND attribute.attgenerated = ''
        AND (
          (attribute.attname = 'id'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer'
            AND attribute.attnotnull)
          OR (attribute.attname = 'actor_type'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(20)'
            AND attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname = 'visitor_token'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(64)'
            AND attribute.attnotnull
            AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''''::character varying')
          OR (attribute.attname IN ('section', 'storage')
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(107)'
            AND attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname = 'cost'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer'
            AND attribute.attnotnull
            AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '0')
          OR (attribute.attname = 'expires'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone'
            AND attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname = 'user_id'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer'
            AND NOT attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname IN ('patch_id', 'resource_id', 'link_id')
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer'
            AND attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname = 'created'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone'
            AND attribute.attnotnull
            AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = 'CURRENT_TIMESTAMP')
          OR (attribute.attname = 'updated'
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone'
            AND attribute.attnotnull AND attribute_default.oid IS NULL)
          OR (attribute.attname = 'access_kind'
            AND access_kind_count = 1
            AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(20)'
            AND attribute.attnotnull
            AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''link_reveal''::character varying')
        )
    )
  INTO actual_count, matching_count
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = access_relation
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual_count <> 13 + access_kind_count
    OR matching_count <> 13 + access_kind_count THEN
    RAISE EXCEPTION 'patch_resource_access column fingerprint mismatch: total=%, matching=%', actual_count, matching_count;
  END IF;

  SELECT attnum
  INTO id_attnum
  FROM pg_attribute
  WHERE attrelid = access_relation
    AND attname = 'id'
    AND attnum > 0
    AND NOT attisdropped;

  IF sequence_relation IS NULL
    OR (SELECT relkind FROM pg_class WHERE oid = sequence_relation) <> 'S'
    OR (SELECT seqtypid FROM pg_sequence WHERE seqrelid = sequence_relation) <> 'integer'::regtype
    OR to_regclass(pg_get_serial_sequence('public.patch_resource_access', 'id')) <> sequence_relation
    OR NOT EXISTS (
      SELECT 1
      FROM pg_attrdef attribute_default
      JOIN pg_depend dependency
        ON dependency.classid = 'pg_attrdef'::regclass
       AND dependency.objid = attribute_default.oid
       AND dependency.refclassid = 'pg_class'::regclass
       AND dependency.refobjid = sequence_relation
       AND dependency.deptype = 'n'
      WHERE attribute_default.adrelid = access_relation
        AND attribute_default.adnum = id_attnum
        AND pg_get_expr(attribute_default.adbin, attribute_default.adrelid) =
          format('nextval(%L::regclass)', sequence_relation::regclass::text)
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = sequence_relation
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.refobjid = access_relation
        AND dependency.refobjsubid = id_attnum
        AND dependency.deptype = 'a'
    ) THEN
    RAISE EXCEPTION 'patch_resource_access id serial sequence/default/ownership mismatch';
  END IF;

  WITH primary_keys AS (
    SELECT
      constraint_row.*,
      index_class.relname AS index_name,
      index_row.indisprimary,
      index_row.indisunique,
      index_row.indisready,
      index_row.indisvalid,
      index_row.indislive,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.conkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS key_columns
    FROM pg_constraint constraint_row
    LEFT JOIN pg_class index_class ON index_class.oid = constraint_row.conindid
    LEFT JOIN pg_index index_row ON index_row.indexrelid = constraint_row.conindid
    WHERE constraint_row.conrelid = access_relation
      AND constraint_row.contype = 'p'
  )
  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE conname = 'patch_resource_access_pkey'
      AND convalidated AND NOT condeferrable AND NOT condeferred
      AND key_columns = ARRAY['id']::text[]
      AND index_name = 'patch_resource_access_pkey'
      AND indisprimary AND indisunique AND indisready AND indisvalid AND indislive
  )
  INTO actual_count, matching_count
  FROM primary_keys;

  IF actual_count <> 1 OR matching_count <> 1 THEN
    RAISE EXCEPTION 'patch_resource_access primary key/backing index mismatch';
  END IF;

  WITH foreign_keys AS (
    SELECT
      constraint_row.*,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.conkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS key_columns,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.confkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS referenced_columns
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = access_relation
      AND constraint_row.contype = 'f'
  )
  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE convalidated AND NOT condeferrable AND NOT condeferred
      AND confmatchtype = 's' AND confupdtype = 'a'
      AND referenced_columns = ARRAY['id']::text[]
      AND (
        (conname = 'patch_resource_access_user_id_fkey'
          AND key_columns = ARRAY['user_id']::text[]
          AND confrelid = 'public.user'::regclass AND confdeltype = 'n')
        OR (conname = 'patch_resource_access_patch_id_fkey'
          AND key_columns = ARRAY['patch_id']::text[]
          AND confrelid = 'public.patch'::regclass AND confdeltype = 'c')
        OR (conname = 'patch_resource_access_resource_id_fkey'
          AND key_columns = ARRAY['resource_id']::text[]
          AND confrelid = 'public.patch_resource'::regclass AND confdeltype = 'c')
        OR (conname = 'patch_resource_access_link_id_fkey'
          AND key_columns = ARRAY['link_id']::text[]
          AND confrelid = 'public.patch_resource_link'::regclass AND confdeltype = 'c')
      )
  )
  INTO actual_count, matching_count
  FROM foreign_keys;

  IF actual_count <> 4 OR matching_count <> 4 THEN
    RAISE EXCEPTION 'patch_resource_access foreign key fingerprint mismatch: total=%, matching=%', actual_count, matching_count;
  END IF;

  WITH expected(index_name, definition) AS (
    VALUES
      ('patch_resource_access_user_id_link_id_expires_idx',
       'CREATE INDEX patch_resource_access_user_id_link_id_expires_idx ON public.patch_resource_access USING btree (user_id, link_id, expires)'),
      ('patch_resource_access_visitor_token_link_id_expires_idx',
       'CREATE INDEX patch_resource_access_visitor_token_link_id_expires_idx ON public.patch_resource_access USING btree (visitor_token, link_id, expires)'),
      ('patch_resource_access_patch_id_created_idx',
       'CREATE INDEX patch_resource_access_patch_id_created_idx ON public.patch_resource_access USING btree (patch_id, created DESC)'),
      ('patch_resource_access_resource_id_created_idx',
       'CREATE INDEX patch_resource_access_resource_id_created_idx ON public.patch_resource_access USING btree (resource_id, created DESC)'),
      ('patch_resource_access_link_id_created_idx',
       'CREATE INDEX patch_resource_access_link_id_created_idx ON public.patch_resource_access USING btree (link_id, created DESC)')
  ), actual AS (
    SELECT
      expected.index_name,
      index_class.oid,
      index_row.*,
      pg_get_indexdef(index_class.oid) AS definition
    FROM expected
    LEFT JOIN pg_class index_class
      ON index_class.relnamespace = 'public'::regnamespace
     AND index_class.relname = expected.index_name
    LEFT JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
  )
  SELECT COUNT(*) FILTER (
    WHERE oid IS NULL OR indrelid <> access_relation OR indisunique OR indisprimary
      OR NOT indisready OR NOT indisvalid OR NOT indislive
      OR indpred IS NOT NULL OR indexprs IS NOT NULL
      OR actual.definition IS DISTINCT FROM expected.definition
  )
  INTO actual_count
  FROM actual
  JOIN expected USING (index_name);

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'patch_resource_access base index fingerprint mismatch';
  END IF;

  SELECT COUNT(*)
  INTO unexpected_count
  FROM pg_index index_row
  JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
  WHERE index_row.indrelid = access_relation
    AND index_class.relname NOT IN (
      'patch_resource_access_pkey',
      'patch_resource_access_user_id_link_id_expires_idx',
      'patch_resource_access_visitor_token_link_id_expires_idx',
      'patch_resource_access_patch_id_created_idx',
      'patch_resource_access_resource_id_created_idx',
      'patch_resource_access_link_id_created_idx',
      'resource_access_visitor_kind_created_idx'
    );

  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'patch_resource_access has unexpected user-defined indexes';
  END IF;

  relation_oid := to_regclass('public.resource_access_visitor_kind_created_idx');
  IF relation_oid IS NOT NULL THEN
    SELECT relkind INTO relation_kind FROM pg_class WHERE oid = relation_oid;
    IF relation_kind NOT IN ('i', 'I') THEN
      RAISE EXCEPTION 'same_name_non_index: resource_access_visitor_kind_created_idx';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index
      WHERE indexrelid = relation_oid
        AND (NOT indisready OR NOT indisvalid OR NOT indislive)
    ) THEN
      RAISE NOTICE 'invalid_not_ready_or_not_live: resource_access_visitor_kind_created_idx';
    ELSIF pg_get_indexdef(relation_oid) <>
      'CREATE INDEX resource_access_visitor_kind_created_idx ON public.patch_resource_access USING btree (actor_type, visitor_token, section, access_kind, created DESC)' THEN
      RAISE EXCEPTION 'ready_valid_live_definition_mismatch: resource_access_visitor_kind_created_idx';
    END IF;
  END IF;

  IF access_kind_count = 0 THEN
    IF grant_relation IS NOT NULL
      OR to_regclass('public.patch_resource_access_grant_pkey') IS NOT NULL
      OR to_regclass('public.resource_access_grant_expires_idx') IS NOT NULL
      OR to_regclass('public.resource_access_visitor_kind_created_idx') IS NOT NULL THEN
      RAISE EXCEPTION 'Grant-owned objects cannot exist before access_kind';
    END IF;
    RAISE NOTICE 'bootstrap_state=phase2_present';
    RETURN;
  END IF;

  IF grant_relation IS NULL THEN
    IF to_regclass('public.patch_resource_access_grant_pkey') IS NOT NULL
      OR to_regclass('public.resource_access_grant_expires_idx') IS NOT NULL THEN
      RAISE EXCEPTION 'Grant primary/expires indexes cannot exist without patch_resource_access_grant';
    END IF;
    RAISE NOTICE 'bootstrap_state=upgrade_compatible_present';
    RETURN;
  END IF;

  SELECT relkind INTO relation_kind FROM pg_class WHERE oid = grant_relation;
  IF relation_kind <> 'r' THEN
    RAISE EXCEPTION 'public.patch_resource_access_grant must be an ordinary table';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE attribute.attnotnull
      AND attribute.attidentity = ''
      AND attribute.attgenerated = ''
      AND attribute_default.oid IS NULL
      AND (
        (attribute.attname = 'actor_key'
          AND format_type(attribute.atttypid, attribute.atttypmod) = 'character varying(80)')
        OR (attribute.attname = 'resource_id'
          AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer')
        OR (attribute.attname = 'expires'
          AND format_type(attribute.atttypid, attribute.atttypmod) = 'timestamp(3) without time zone')
      )
  )
  INTO actual_count, matching_count
  FROM pg_attribute attribute
  LEFT JOIN pg_attrdef attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = grant_relation
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual_count <> 3 OR matching_count <> 3 THEN
    RAISE EXCEPTION 'patch_resource_access_grant column fingerprint mismatch';
  END IF;

  WITH primary_keys AS (
    SELECT
      constraint_row.*,
      index_class.relname AS index_name,
      index_row.indisprimary,
      index_row.indisunique,
      index_row.indisready,
      index_row.indisvalid,
      index_row.indislive,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.conkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS key_columns
    FROM pg_constraint constraint_row
    LEFT JOIN pg_class index_class ON index_class.oid = constraint_row.conindid
    LEFT JOIN pg_index index_row ON index_row.indexrelid = constraint_row.conindid
    WHERE constraint_row.conrelid = grant_relation
      AND constraint_row.contype = 'p'
  )
  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE conname = 'patch_resource_access_grant_pkey'
      AND convalidated AND NOT condeferrable AND NOT condeferred
      AND key_columns = ARRAY['actor_key', 'resource_id']::text[]
      AND index_name = 'patch_resource_access_grant_pkey'
      AND indisprimary AND indisunique AND indisready AND indisvalid AND indislive
  )
  INTO actual_count, matching_count
  FROM primary_keys;

  IF actual_count <> 1 OR matching_count <> 1 THEN
    RAISE EXCEPTION 'patch_resource_access_grant primary key/backing index mismatch';
  END IF;

  WITH foreign_keys AS (
    SELECT
      constraint_row.*,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.conkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS key_columns,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_row.confkey) WITH ORDINALITY key_column(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.position
      ) AS referenced_columns
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = grant_relation
      AND constraint_row.contype = 'f'
  )
  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE conname = 'patch_resource_access_grant_resource_id_fkey'
      AND convalidated AND NOT condeferrable AND NOT condeferred
      AND confmatchtype = 's' AND confupdtype = 'a' AND confdeltype = 'c'
      AND confrelid = 'public.patch_resource'::regclass
      AND key_columns = ARRAY['resource_id']::text[]
      AND referenced_columns = ARRAY['id']::text[]
  )
  INTO actual_count, matching_count
  FROM foreign_keys;

  IF actual_count <> 1 OR matching_count <> 1 THEN
    RAISE EXCEPTION 'patch_resource_access_grant foreign key fingerprint mismatch';
  END IF;

  relation_oid := to_regclass('public.resource_access_grant_expires_idx');
  IF relation_oid IS NOT NULL THEN
    SELECT relkind INTO relation_kind FROM pg_class WHERE oid = relation_oid;
    IF relation_kind NOT IN ('i', 'I') THEN
      RAISE EXCEPTION 'same_name_non_index: resource_access_grant_expires_idx';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index
      WHERE indexrelid = relation_oid
        AND (NOT indisready OR NOT indisvalid OR NOT indislive)
    ) THEN
      RAISE NOTICE 'invalid_not_ready_or_not_live: resource_access_grant_expires_idx';
    ELSIF pg_get_indexdef(relation_oid) <>
      'CREATE INDEX resource_access_grant_expires_idx ON public.patch_resource_access_grant USING btree (expires)' THEN
      RAISE EXCEPTION 'ready_valid_live_definition_mismatch: resource_access_grant_expires_idx';
    END IF;
  END IF;

  RAISE NOTICE 'bootstrap_state=upgrade_compatible_present';
END
$bootstrap_preflight$;

SELECT CASE
  WHEN to_regclass('public.patch_resource_access') IS NULL
    THEN 'ready_to_create'
  WHEN NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = to_regclass('public.patch_resource_access')
      AND attname = 'access_kind'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN 'phase2_present'
  ELSE 'upgrade_compatible_present'
END AS bootstrap_state;

COMMIT;
