-- sync-c: member_key NOT NULL, pending-key table, current pending rows (2026-09-22).
-- Run preflight-2 first and only continue when it commits.
-- Application code that reads member_key or company_merge_pending_key must
-- not ship before this transaction commits and postflight passes.
--
-- Resume point: SET NOT NULL is idempotent once applied. CREATE TABLE and
-- CREATE INDEX use IF NOT EXISTS. The insert skips a pending row whose
-- matching key is already present, then raises if any pending row still lacks
-- that key (duplicate member_key or a key owned by a different suggestion).
-- Re-run only after resolving that exception; the transaction rolls back.
--
-- CREATE TABLE IF NOT EXISTS does not change company_merge_pending_key_suggestion_id_fkey
-- if the table already exists. Prisma's onDelete: Restrict (no onUpdate) is
-- ON DELETE RESTRICT ON UPDATE CASCADE. If this table was already created
-- with NO ACTION on update, drop that foreign key and add it again before
-- continuing, still in this file:
--   ALTER TABLE public.company_merge_pending_key
--     DROP CONSTRAINT company_merge_pending_key_suggestion_id_fkey;
--   ALTER TABLE public.company_merge_pending_key
--     ADD CONSTRAINT company_merge_pending_key_suggestion_id_fkey
--     FOREIGN KEY (suggestion_id)
--     REFERENCES public.company_merge_suggestion (id)
--     ON DELETE RESTRICT
--     ON UPDATE CASCADE;

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.company_merge_suggestion
  ALTER COLUMN member_key SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_merge_pending_key (
  member_key    VARCHAR(512) PRIMARY KEY,
  suggestion_id INTEGER NOT NULL,
  created       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_merge_pending_key_suggestion_id_key UNIQUE (suggestion_id),
  CONSTRAINT company_merge_pending_key_suggestion_id_fkey
    FOREIGN KEY (suggestion_id)
    REFERENCES public.company_merge_suggestion (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS company_merge_suggestion_member_key_status_idx
  ON public.company_merge_suggestion (member_key, status);
CREATE INDEX IF NOT EXISTS company_merge_suggestion_candidate_key_status_idx
  ON public.company_merge_suggestion (candidate_key, status);

INSERT INTO public.company_merge_pending_key (member_key, suggestion_id)
SELECT suggestion.member_key, suggestion.id
FROM public.company_merge_suggestion AS suggestion
WHERE suggestion.status = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_merge_pending_key AS pending_key
    WHERE pending_key.member_key = suggestion.member_key
      AND pending_key.suggestion_id = suggestion.id
  );

DO $sync_c_pending_key$
DECLARE
  missing_rows text;
BEGIN
  SELECT string_agg(suggestion.id::text, ', ' ORDER BY suggestion.id)
  INTO missing_rows
  FROM public.company_merge_suggestion AS suggestion
  WHERE suggestion.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_merge_pending_key AS pending_key
      WHERE pending_key.suggestion_id = suggestion.id
        AND pending_key.member_key = suggestion.member_key
    );

  IF missing_rows IS NOT NULL THEN
    RAISE EXCEPTION
      'company merge subset sync-c failed: pending suggestions missing a matching pending-key: %',
      missing_rows;
  END IF;
END
$sync_c_pending_key$;

COMMIT;
