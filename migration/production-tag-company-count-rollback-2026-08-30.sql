-- Remove only the six counter triggers/functions installed by the matching sync.
-- Keep relation writes paused until manual-counter application code is restored
-- and an absolute counter repair has completed.

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

COMMIT;
