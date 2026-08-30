-- Install statement-level tag/company relation counter triggers and repair all
-- stored counters. Deploy application code without manual counter writes first.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

DO $required_schema$
BEGIN
  IF to_regclass('public.patch_tag') IS NULL
    OR to_regclass('public.patch_tag_relation') IS NULL
    OR to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_company_relation') IS NULL THEN
    RAISE EXCEPTION 'tag/company counter sync requires both parent and relation tables';
  END IF;
END
$required_schema$;

CREATE OR REPLACE FUNCTION public.patch_tag_count_trg_ins()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT tag_id AS parent_id, COUNT(*)::integer AS delta
    FROM new_rows
    GROUP BY tag_id
    ORDER BY tag_id
  LOOP
    UPDATE public.patch_tag
    SET count = count + counter.delta
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.patch_tag_count_trg_del()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT tag_id AS parent_id, COUNT(*)::integer AS delta
    FROM old_rows
    GROUP BY tag_id
    ORDER BY tag_id
  LOOP
    UPDATE public.patch_tag
    SET count = GREATEST(count - counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.patch_tag_count_trg_upd()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.tag_id AS parent_id, -1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.tag_id IS DISTINCT FROM new_row.tag_id
      UNION ALL
      SELECT new_row.tag_id AS parent_id, 1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.tag_id IS DISTINCT FROM new_row.tag_id
    ) changes
    GROUP BY parent_id
    ORDER BY parent_id
  LOOP
    UPDATE public.patch_tag
    SET count = GREATEST(count + counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.patch_company_count_trg_ins()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT company_id AS parent_id, COUNT(*)::integer AS delta
    FROM new_rows
    GROUP BY company_id
    ORDER BY company_id
  LOOP
    UPDATE public.patch_company
    SET count = count + counter.delta
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.patch_company_count_trg_del()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT company_id AS parent_id, COUNT(*)::integer AS delta
    FROM old_rows
    GROUP BY company_id
    ORDER BY company_id
  LOOP
    UPDATE public.patch_company
    SET count = GREATEST(count - counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.patch_company_count_trg_upd()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  counter record;
BEGIN
  FOR counter IN
    SELECT parent_id, SUM(delta)::integer AS delta
    FROM (
      SELECT old_row.company_id AS parent_id, -1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
      UNION ALL
      SELECT new_row.company_id AS parent_id, 1 AS delta
      FROM old_rows old_row
      JOIN new_rows new_row USING (id)
      WHERE old_row.company_id IS DISTINCT FROM new_row.company_id
    ) changes
    GROUP BY parent_id
    ORDER BY parent_id
  LOOP
    UPDATE public.patch_company
    SET count = GREATEST(count + counter.delta, 0)
    WHERE id = counter.parent_id;
  END LOOP;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS patch_tag_count_trg_ins ON public.patch_tag_relation;
CREATE TRIGGER patch_tag_count_trg_ins
AFTER INSERT ON public.patch_tag_relation
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_tag_count_trg_ins();

DROP TRIGGER IF EXISTS patch_tag_count_trg_del ON public.patch_tag_relation;
CREATE TRIGGER patch_tag_count_trg_del
AFTER DELETE ON public.patch_tag_relation
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_tag_count_trg_del();

DROP TRIGGER IF EXISTS patch_tag_count_trg_upd ON public.patch_tag_relation;
CREATE TRIGGER patch_tag_count_trg_upd
AFTER UPDATE ON public.patch_tag_relation
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_tag_count_trg_upd();

DROP TRIGGER IF EXISTS patch_company_count_trg_ins ON public.patch_company_relation;
CREATE TRIGGER patch_company_count_trg_ins
AFTER INSERT ON public.patch_company_relation
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_company_count_trg_ins();

DROP TRIGGER IF EXISTS patch_company_count_trg_del ON public.patch_company_relation;
CREATE TRIGGER patch_company_count_trg_del
AFTER DELETE ON public.patch_company_relation
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_company_count_trg_del();

DROP TRIGGER IF EXISTS patch_company_count_trg_upd ON public.patch_company_relation;
CREATE TRIGGER patch_company_count_trg_upd
AFTER UPDATE ON public.patch_company_relation
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.patch_company_count_trg_upd();

-- SHARE conflicts with relation writers. Holding it before both absolute
-- backfills prevents a trigger delta from being overwritten by an older count.
LOCK TABLE public.patch_tag_relation, public.patch_company_relation IN SHARE MODE;

UPDATE public.patch_tag parent
SET count = actual.count
FROM (
  SELECT tag.id, COUNT(relation.id)::integer AS count
  FROM public.patch_tag tag
  LEFT JOIN public.patch_tag_relation relation ON relation.tag_id = tag.id
  GROUP BY tag.id
) actual
WHERE parent.id = actual.id
  AND parent.count IS DISTINCT FROM actual.count;

UPDATE public.patch_company parent
SET count = actual.count
FROM (
  SELECT company.id, COUNT(relation.id)::integer AS count
  FROM public.patch_company company
  LEFT JOIN public.patch_company_relation relation ON relation.company_id = company.id
  GROUP BY company.id
) actual
WHERE parent.id = actual.id
  AND parent.count IS DISTINCT FROM actual.count;

COMMIT;
