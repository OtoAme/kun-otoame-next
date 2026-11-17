\set ON_ERROR_STOP on
\ir production-account-preferences-preflight-2026-11-17.sql
BEGIN READ ONLY;
DO $check$
BEGIN
  IF to_regclass('public.account_preference_version') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public."user"'::regclass AND attname='nsfw_mode' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public."user"'::regclass AND attname='preference_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'account preferences not installed';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE convalidated AND (
    (conrelid='public."user"'::regclass AND conname IN ('user_nsfw_mode_check','user_preference_version_check'))
    OR (conrelid='public.account_preference_version'::regclass AND conname='account_preference_version_positive_check'))) <> 3 THEN
    RAISE EXCEPTION 'account preference validation constraints missing';
  END IF;
END
$check$;
SELECT 'account-preferences postflight OK' AS result,
  (SELECT count(*) FROM public."user") AS accounts,
  (SELECT count(*) FROM public."user" WHERE nsfw_mode IS NOT NULL) AS explicit_nsfw_choices,
  (SELECT count(*) FROM public.account_preference_version) AS version_records;
COMMIT;
