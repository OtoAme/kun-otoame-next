-- Safe-to-retry production bootstrap for the Phase 2 resource access table.
-- An existing access table aborts and must continue through preflight-only handoff.
-- Run with psql after the matching preflight. Do not use prisma db push.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT to_regclass('public.patch_resource_access') IS NOT NULL AS access_table_present
\gset bootstrap_

\if :bootstrap_access_table_present
  \echo 'public.patch_resource_access already exists; run preflight and continue with the grant migration without rerunning bootstrap sync'
  SELECT 1 / 0 AS resource_access_bootstrap_aborted;
\else
  DO $write_preflight$
  DECLARE
    relation_name text;
    relation_oid oid;
    relation_kind "char";
    conflict_count integer;
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
        RAISE EXCEPTION 'public.% must be an ordinary table', relation_name;
      END IF;
    END LOOP;

    SELECT COUNT(*)
    INTO conflict_count
    FROM pg_class relation
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relname = ANY(conflict_names);

    IF conflict_count <> 0 THEN
      RAISE EXCEPTION 'Bootstrap relation-name conflict appeared after preflight';
    END IF;
  END
  $write_preflight$;

  CREATE SEQUENCE public.patch_resource_access_id_seq AS integer;

  CREATE TABLE public.patch_resource_access (
    id integer NOT NULL DEFAULT nextval('public.patch_resource_access_id_seq'::regclass),
    actor_type varchar(20) NOT NULL,
    visitor_token varchar(64) NOT NULL DEFAULT '',
    section varchar(107) NOT NULL,
    storage varchar(107) NOT NULL,
    cost integer NOT NULL DEFAULT 0,
    expires timestamp(3) without time zone NOT NULL,
    user_id integer,
    patch_id integer NOT NULL,
    resource_id integer NOT NULL,
    link_id integer NOT NULL,
    created timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated timestamp(3) without time zone NOT NULL,
    CONSTRAINT patch_resource_access_pkey PRIMARY KEY (id),
    CONSTRAINT patch_resource_access_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user(id)
      ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT patch_resource_access_patch_id_fkey
      FOREIGN KEY (patch_id) REFERENCES public.patch(id)
      ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT patch_resource_access_resource_id_fkey
      FOREIGN KEY (resource_id) REFERENCES public.patch_resource(id)
      ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT patch_resource_access_link_id_fkey
      FOREIGN KEY (link_id) REFERENCES public.patch_resource_link(id)
      ON DELETE CASCADE ON UPDATE NO ACTION
  );

  ALTER SEQUENCE public.patch_resource_access_id_seq
    OWNED BY public.patch_resource_access.id;

  CREATE INDEX patch_resource_access_user_id_link_id_expires_idx
    ON public.patch_resource_access (user_id, link_id, expires);
  CREATE INDEX patch_resource_access_visitor_token_link_id_expires_idx
    ON public.patch_resource_access (visitor_token, link_id, expires);
  CREATE INDEX patch_resource_access_patch_id_created_idx
    ON public.patch_resource_access (patch_id, created DESC);
  CREATE INDEX patch_resource_access_resource_id_created_idx
    ON public.patch_resource_access (resource_id, created DESC);
  CREATE INDEX patch_resource_access_link_id_created_idx
    ON public.patch_resource_access (link_id, created DESC);

  DO $postflight$
  DECLARE
    access_relation oid := to_regclass('public.patch_resource_access');
    sequence_relation oid := to_regclass('public.patch_resource_access_id_seq');
    id_attnum smallint;
    actual_count integer;
    matching_count integer;
  BEGIN
    SELECT attnum
    INTO id_attnum
    FROM pg_attribute
    WHERE attrelid = access_relation
      AND attname = 'id'
      AND attnum > 0
      AND NOT attisdropped;

    SELECT COUNT(*)
    INTO actual_count
    FROM pg_attribute
    WHERE attrelid = access_relation
      AND attnum > 0
      AND NOT attisdropped;

    IF actual_count <> 13
      OR EXISTS (
        SELECT 1
        FROM pg_attribute attribute
        JOIN pg_attrdef attribute_default
          ON attribute_default.adrelid = attribute.attrelid
         AND attribute_default.adnum = attribute.attnum
        WHERE attribute.attrelid = access_relation
          AND attribute.attname = 'updated'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ) THEN
      RAISE EXCEPTION 'Bootstrap postflight failed for columns or updated default';
    END IF;

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
      RAISE EXCEPTION 'Bootstrap postflight failed for serial sequence/default/ownership';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE constraint_row.conname IN (
        'patch_resource_access_pkey',
        'patch_resource_access_user_id_fkey',
        'patch_resource_access_patch_id_fkey',
        'patch_resource_access_resource_id_fkey',
        'patch_resource_access_link_id_fkey'
      )
        AND constraint_row.convalidated
        AND NOT constraint_row.condeferrable
        AND NOT constraint_row.condeferred
    )
    INTO actual_count, matching_count
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = access_relation
      AND constraint_row.contype IN ('p', 'f');

    IF actual_count <> 5 OR matching_count <> 5 THEN
      RAISE EXCEPTION 'Bootstrap postflight failed for constraints';
    END IF;

    SELECT COUNT(*)
    INTO matching_count
    FROM pg_constraint constraint_row
    JOIN pg_class index_class ON index_class.oid = constraint_row.conindid
    JOIN pg_index index_row ON index_row.indexrelid = constraint_row.conindid
    WHERE constraint_row.conrelid = access_relation
      AND constraint_row.contype = 'p'
      AND constraint_row.conname = 'patch_resource_access_pkey'
      AND index_class.relname = 'patch_resource_access_pkey'
      AND index_row.indisprimary
      AND index_row.indisunique
      AND index_row.indisready
      AND index_row.indisvalid
      AND index_row.indislive;

    IF matching_count <> 1 THEN
      RAISE EXCEPTION 'Bootstrap postflight failed for primary-key backing index';
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
    )
    SELECT COUNT(*)
    INTO matching_count
    FROM expected
    JOIN pg_class index_class
      ON index_class.relnamespace = 'public'::regnamespace
     AND index_class.relname = expected.index_name
    JOIN pg_index index_row ON index_row.indexrelid = index_class.oid
    WHERE index_row.indrelid = access_relation
      AND NOT index_row.indisunique
      AND NOT index_row.indisprimary
      AND index_row.indisready
      AND index_row.indisvalid
      AND index_row.indislive
      AND index_row.indpred IS NULL
      AND index_row.indexprs IS NULL
      AND pg_get_indexdef(index_class.oid) = expected.definition;

    IF matching_count <> 5 THEN
      RAISE EXCEPTION 'Bootstrap postflight failed for base indexes';
    END IF;

    IF EXISTS (SELECT 1 FROM public.patch_resource_access)
      OR (SELECT COALESCE(MAX(id), 0) FROM public.patch_resource_access) <> 0 THEN
      RAISE EXCEPTION 'Bootstrap postflight expected an empty table with MAX(id)=0';
    END IF;
  END
  $postflight$;

  \echo 'bootstrap_state=created_phase2'
\endif

COMMIT;
