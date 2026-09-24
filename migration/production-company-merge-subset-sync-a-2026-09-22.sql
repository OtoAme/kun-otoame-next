-- sync-a: add nullable company-merge subset columns (2026-09-22).
-- Run production-company-merge-subset-preflight-2026-09-22.sql first.
-- This file does not backfill, does not set NOT NULL, and does not create
-- company_merge_pending_key.
--
-- Resume point: each ADD COLUMN is IF NOT EXISTS. Re-run after an interrupt
-- is safe. Continue to sync-b only after this transaction commits.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.company_merge_suggestion
  ADD COLUMN IF NOT EXISTS selected_company_ids JSONB,
  ADD COLUMN IF NOT EXISTS applied_source_company_ids JSONB,
  ADD COLUMN IF NOT EXISTS applied_target_company_id INTEGER,
  ADD COLUMN IF NOT EXISTS member_key VARCHAR(512),
  ADD COLUMN IF NOT EXISTS candidate_key VARCHAR(512),
  ADD COLUMN IF NOT EXISTS resolution_source VARCHAR(32);

COMMIT;
