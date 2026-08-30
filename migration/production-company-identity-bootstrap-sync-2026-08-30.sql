-- Idempotent Phase A company identity bootstrap. Run the matching read-only
-- preflight first, then this file, then the independent postflight.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $base_tables$
BEGIN
  IF to_regclass('public.user') IS NULL
    OR to_regclass('public.patch_company') IS NULL
    OR to_regclass('public.patch_submission') IS NULL THEN
    RAISE EXCEPTION 'company identity bootstrap requires user, patch_company, and patch_submission';
  END IF;
END
$base_tables$;

ALTER TABLE public.patch_company
  ADD COLUMN IF NOT EXISTS normalized_name VARCHAR(107);

ALTER TABLE public.patch_submission
  ADD COLUMN IF NOT EXISTS company_candidates JSONB;

CREATE TABLE IF NOT EXISTS public.patch_company_external_id (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  source      VARCHAR(32) NOT NULL,
  external_id VARCHAR(107) NOT NULL,
  created     TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated     TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.patch_company_name_identity (
  id                   SERIAL PRIMARY KEY,
  company_id           INTEGER NOT NULL,
  kind                 VARCHAR(16) NOT NULL,
  origin               VARCHAR(16) NOT NULL,
  value                VARCHAR(107) NOT NULL,
  normalized_value     VARCHAR(107) NOT NULL,
  confirmed_by_user_id INTEGER,
  created              TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated              TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
);

DO $foreign_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patch_company_external_id_company_id_fkey'
      AND conrelid = 'public.patch_company_external_id'::regclass
  ) THEN
    ALTER TABLE public.patch_company_external_id
      ADD CONSTRAINT patch_company_external_id_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.patch_company(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patch_company_name_identity_company_id_fkey'
      AND conrelid = 'public.patch_company_name_identity'::regclass
  ) THEN
    ALTER TABLE public.patch_company_name_identity
      ADD CONSTRAINT patch_company_name_identity_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.patch_company(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patch_company_name_identity_confirmed_by_user_id_fkey'
      AND conrelid = 'public.patch_company_name_identity'::regclass
  ) THEN
    ALTER TABLE public.patch_company_name_identity
      ADD CONSTRAINT patch_company_name_identity_confirmed_by_user_id_fkey
      FOREIGN KEY (confirmed_by_user_id) REFERENCES public.user(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$foreign_keys$;

CREATE INDEX IF NOT EXISTS patch_company_normalized_name_idx
  ON public.patch_company (normalized_name);

CREATE INDEX IF NOT EXISTS patch_company_external_id_company_id_idx
  ON public.patch_company_external_id (company_id);

CREATE INDEX IF NOT EXISTS patch_company_external_id_source_external_id_idx
  ON public.patch_company_external_id (source, external_id);

CREATE INDEX IF NOT EXISTS patch_company_name_identity_company_id_idx
  ON public.patch_company_name_identity (company_id);

CREATE INDEX IF NOT EXISTS patch_company_name_identity_confirmed_by_user_id_idx
  ON public.patch_company_name_identity (confirmed_by_user_id);

CREATE INDEX IF NOT EXISTS patch_company_name_identity_normalized_value_idx
  ON public.patch_company_name_identity (normalized_value);

CREATE UNIQUE INDEX IF NOT EXISTS patch_company_name_identity_company_kind_value_key
  ON public.patch_company_name_identity (company_id, kind, normalized_value);

COMMIT;
