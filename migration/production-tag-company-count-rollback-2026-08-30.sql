-- Remove the six counter triggers/functions installed by the matching sync and
-- repair both counters while relation writes remain paused. Restore the prior
-- manual-counter application version before writes resume.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS patch_tag_count_trg_ins ON public.patch_tag_relation;
DROP TRIGGER IF EXISTS patch_tag_count_trg_del ON public.patch_tag_relation;
DROP TRIGGER IF EXISTS patch_tag_count_trg_upd ON public.patch_tag_relation;
DROP TRIGGER IF EXISTS patch_company_count_trg_ins ON public.patch_company_relation;
DROP TRIGGER IF EXISTS patch_company_count_trg_del ON public.patch_company_relation;
DROP TRIGGER IF EXISTS patch_company_count_trg_upd ON public.patch_company_relation;

DROP FUNCTION IF EXISTS public.patch_tag_count_trg_ins();
DROP FUNCTION IF EXISTS public.patch_tag_count_trg_del();
DROP FUNCTION IF EXISTS public.patch_tag_count_trg_upd();
DROP FUNCTION IF EXISTS public.patch_company_count_trg_ins();
DROP FUNCTION IF EXISTS public.patch_company_count_trg_del();
DROP FUNCTION IF EXISTS public.patch_company_count_trg_upd();

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
