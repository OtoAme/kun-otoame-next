\set ON_ERROR_STOP on
\ir production-account-preferences-preflight-2026-11-17.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public."user" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS nsfw_mode varchar(4);
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS preference_version integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.account_preference_version (
  user_id integer NOT NULL,
  setting_key varchar(100) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT account_preference_version_pkey PRIMARY KEY (user_id, setting_key),
  CONSTRAINT account_preference_version_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."user"'::regclass AND conname='user_nsfw_mode_check') THEN
    ALTER TABLE public."user" ADD CONSTRAINT user_nsfw_mode_check CHECK (nsfw_mode IS NULL OR nsfw_mode IN ('sfw','nsfw','all'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."user"'::regclass AND conname='user_preference_version_check') THEN
    ALTER TABLE public."user" ADD CONSTRAINT user_preference_version_check CHECK (preference_version >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass AND conname='account_preference_version_positive_check') THEN
    ALTER TABLE public.account_preference_version ADD CONSTRAINT account_preference_version_positive_check CHECK (version > 0 AND setting_key <> '');
  END IF;
END
$constraints$;
COMMIT;
\ir production-account-preferences-postflight-2026-11-17.sql
