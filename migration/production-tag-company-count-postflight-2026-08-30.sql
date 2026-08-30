-- Independent read-only verification for tag/company relation counters.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'counter_function' AS check_type,
  procedure_row.proname AS object_name,
  pg_get_functiondef(procedure_row.oid) AS definition
FROM pg_proc procedure_row
JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.proname IN (
    'patch_tag_count_trg_ins',
    'patch_tag_count_trg_del',
    'patch_tag_count_trg_upd',
    'patch_company_count_trg_ins',
    'patch_company_count_trg_del',
    'patch_company_count_trg_upd'
  )
  AND procedure_row.pronargs = 0
ORDER BY procedure_row.proname;

SELECT
  'counter_trigger' AS check_type,
  relation_row.relname AS relation_table,
  trigger_row.tgname AS object_name,
  trigger_row.tgenabled,
  pg_get_triggerdef(trigger_row.oid, true) AS definition
FROM pg_trigger trigger_row
JOIN pg_class relation_row ON relation_row.oid = trigger_row.tgrelid
JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
WHERE namespace_row.nspname = 'public'
  AND trigger_row.tgname IN (
    'patch_tag_count_trg_ins',
    'patch_tag_count_trg_del',
    'patch_tag_count_trg_upd',
    'patch_company_count_trg_ins',
    'patch_company_count_trg_del',
    'patch_company_count_trg_upd'
  )
  AND NOT trigger_row.tgisinternal
ORDER BY trigger_row.tgname;

WITH tag_counts AS (
  SELECT
    tag.id,
    tag.count::bigint AS stored_count,
    COUNT(relation.id)::bigint AS actual_count
  FROM public.patch_tag tag
  LEFT JOIN public.patch_tag_relation relation ON relation.tag_id = tag.id
  GROUP BY tag.id
), company_counts AS (
  SELECT
    company.id,
    company.count::bigint AS stored_count,
    COUNT(relation.id)::bigint AS actual_count
  FROM public.patch_company company
  LEFT JOIN public.patch_company_relation relation ON relation.company_id = company.id
  GROUP BY company.id
)
SELECT
  'counter_invariant' AS check_type,
  'patch_tag' AS parent_table,
  COUNT(*) FILTER (WHERE stored_count <> actual_count) AS mismatched_rows,
  COALESCE(MAX(ABS(stored_count - actual_count)), 0) AS max_absolute_delta
FROM tag_counts
UNION ALL
SELECT
  'counter_invariant',
  'patch_company',
  COUNT(*) FILTER (WHERE stored_count <> actual_count),
  COALESCE(MAX(ABS(stored_count - actual_count)), 0)
FROM company_counts;

DO $postflight$
DECLARE
  mismatch_count integer;
  contract record;
  function_row record;
  trigger_row record;
  expected_source text;
BEGIN
  IF to_regclass('public.patch_tag') IS NULL
    OR to_regclass('public.patch_tag_relation') IS NULL
    OR to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_company_relation') IS NULL THEN
    RAISE EXCEPTION 'tag/company counter postflight failed: required table missing';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (VALUES
    ('patch_tag', 'id'),
    ('patch_tag', 'count'),
    ('patch_tag_relation', 'id'),
    ('patch_tag_relation', 'tag_id'),
    ('patch_company', 'id'),
    ('patch_company', 'count'),
    ('patch_company_relation', 'id'),
    ('patch_company_relation', 'company_id')
  ) AS required(table_name, column_name)
  LEFT JOIN information_schema.columns existing
    ON existing.table_schema = 'public'
   AND existing.table_name = required.table_name
   AND existing.column_name = required.column_name
  WHERE existing.column_name IS NULL
     OR existing.data_type <> 'integer'
     OR existing.is_nullable <> 'NO';

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'tag/company counter postflight failed: required integer column mismatch';
  END IF;

  IF to_regprocedure('public.patch_tag_count_trg()') IS NOT NULL
    OR to_regprocedure('public.patch_company_count_trg()') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_trigger legacy_item
      WHERE NOT legacy_item.tgisinternal
        AND legacy_item.tgname IN ('patch_tag_count_trg', 'patch_company_count_trg')
    ) THEN
    RAISE EXCEPTION 'tag/company counter postflight failed: unsupported legacy counter trigger objects exist';
  END IF;

  FOR contract IN
    SELECT * FROM (VALUES
      ('patch_tag_count_trg_ins', 'patch_tag_relation', 'patch_tag', 'tag_id', 'ins', 4, NULL::text, 'new_rows'),
      ('patch_tag_count_trg_del', 'patch_tag_relation', 'patch_tag', 'tag_id', 'del', 8, 'old_rows', NULL::text),
      ('patch_tag_count_trg_upd', 'patch_tag_relation', 'patch_tag', 'tag_id', 'upd', 16, 'old_rows', 'new_rows'),
      ('patch_company_count_trg_ins', 'patch_company_relation', 'patch_company', 'company_id', 'ins', 4, NULL::text, 'new_rows'),
      ('patch_company_count_trg_del', 'patch_company_relation', 'patch_company', 'company_id', 'del', 8, 'old_rows', NULL::text),
      ('patch_company_count_trg_upd', 'patch_company_relation', 'patch_company', 'company_id', 'upd', 16, 'old_rows', 'new_rows')
    ) AS target(function_name, relation_table, parent_table, fk_column, event_kind, trigger_type, old_table, new_table)
  LOOP
    IF contract.event_kind = 'ins' THEN
      expected_source := format($source$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT %I AS parent_id, COUNT(*)::integer AS delta
    FROM new_rows
    GROUP BY %I
    ORDER BY %I
  LOOP
    UPDATE public.%I
    SET count = count + counter.delta
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$source$, contract.fk_column, contract.fk_column, contract.fk_column, contract.parent_table);
    ELSIF contract.event_kind = 'del' THEN
      expected_source := format($source$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT %I AS parent_id, COUNT(*)::integer AS delta
    FROM old_rows
    GROUP BY %I
    ORDER BY %I
  LOOP
    UPDATE public.%I
    SET count = GREATEST(count - counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$source$, contract.fk_column, contract.fk_column, contract.fk_column, contract.parent_table);
    ELSE
      expected_source := format($source$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.%I AS parent_id, -1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.%I IS DISTINCT FROM new_row.%I
      UNION ALL
      SELECT new_row.%I AS parent_id, 1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.%I IS DISTINCT FROM new_row.%I
    ) changes
    GROUP BY parent_id
    ORDER BY parent_id
  LOOP
    UPDATE public.%I
    SET count = GREATEST(count + counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$source$, contract.fk_column, contract.fk_column, contract.fk_column, contract.fk_column, contract.fk_column, contract.fk_column, contract.parent_table);
    END IF;

    SELECT procedure_row.oid, procedure_row.prosrc, procedure_row.prorettype,
           procedure_row.prokind, procedure_row.pronargs
    INTO function_row
    FROM pg_proc procedure_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = contract.function_name
      AND procedure_row.pronargs = 0;

    IF function_row.oid IS NULL
      OR function_row.prorettype <> 'pg_catalog.trigger'::regtype
      OR function_row.prokind <> 'f'
      OR regexp_replace(btrim(function_row.prosrc), '\s+', '', 'g')
         <> regexp_replace(btrim(expected_source), '\s+', '', 'g') THEN
      RAISE EXCEPTION 'tag/company counter postflight failed: function % mismatch', contract.function_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_trigger other_trigger
      WHERE other_trigger.tgfoid = function_row.oid
        AND NOT other_trigger.tgisinternal
        AND NOT (
          other_trigger.tgrelid = to_regclass(format('public.%I', contract.relation_table))
          AND other_trigger.tgname = contract.function_name
        )
    ) THEN
      RAISE EXCEPTION 'tag/company counter postflight failed: function % is used by another trigger', contract.function_name;
    END IF;

    SELECT trigger_data.oid, trigger_data.tgfoid, trigger_data.tgtype,
           trigger_data.tgoldtable, trigger_data.tgnewtable, trigger_data.tgqual,
           trigger_data.tgenabled, trigger_data.tgconstraint
    INTO trigger_row
    FROM pg_trigger trigger_data
    WHERE trigger_data.tgrelid = to_regclass(format('public.%I', contract.relation_table))
      AND trigger_data.tgname = contract.function_name
      AND NOT trigger_data.tgisinternal;

    IF trigger_row.oid IS NULL
      OR trigger_row.tgfoid <> function_row.oid
      OR trigger_row.tgtype <> contract.trigger_type
      OR trigger_row.tgoldtable IS DISTINCT FROM contract.old_table
      OR trigger_row.tgnewtable IS DISTINCT FROM contract.new_table
      OR trigger_row.tgqual IS NOT NULL
      OR trigger_row.tgenabled <> 'O'
      OR trigger_row.tgconstraint <> 0 THEN
      RAISE EXCEPTION 'tag/company counter postflight failed: trigger % mismatch', contract.function_name;
    END IF;
  END LOOP;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (
    SELECT tag.count::bigint AS stored_count, COUNT(relation.id)::bigint AS actual_count
    FROM public.patch_tag tag
    LEFT JOIN public.patch_tag_relation relation ON relation.tag_id = tag.id
    GROUP BY tag.id
    UNION ALL
    SELECT company.count::bigint, COUNT(relation.id)::bigint
    FROM public.patch_company company
    LEFT JOIN public.patch_company_relation relation ON relation.company_id = company.id
    GROUP BY company.id
  ) counters
  WHERE counters.stored_count <> counters.actual_count;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'tag/company counter postflight failed: count mismatches=%', mismatch_count;
  END IF;
END
$postflight$;

COMMIT;
