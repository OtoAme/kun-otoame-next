-- Idempotent schema sync for the company merge suggestion queue (stage D1).
-- Run the read-only preflight first and review its output.
--
-- This file only creates the new table; it never alters an existing one and it
-- never touches patch_company. Deploying the matching Prisma model without this
-- sync would leave the production schema guard with unexpected drift.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.company_merge_suggestion (
  id                  SERIAL PRIMARY KEY,
  kind                VARCHAR(32) NOT NULL,
  status              VARCHAR(16) NOT NULL,
  folded_key          VARCHAR(107) NOT NULL,
  target_company_id   INTEGER NOT NULL,
  source_company_ids  INTEGER[],
  names               TEXT[],
  evidence            JSONB NOT NULL,
  detected_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at         TIMESTAMP(3),
  resolved_by_user_id INTEGER,
  created             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated             TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS company_merge_suggestion_status_detected_at_idx
  ON public.company_merge_suggestion (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS company_merge_suggestion_kind_folded_key_status_idx
  ON public.company_merge_suggestion (kind, folded_key, status);

COMMIT;
