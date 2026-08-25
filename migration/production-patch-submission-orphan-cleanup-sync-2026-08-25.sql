-- Idempotent production sync for the durable patch-submission orphan cleanup
-- outbox. Run the matching read-only preflight first, then prisma:deploy-safe.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.patch_submission_orphan_cleanup (
  id          SERIAL PRIMARY KEY,
  object_key  VARCHAR(1007) NOT NULL,
  purge_urls  JSONB NOT NULL,
  source      VARCHAR(32) NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  VARCHAR(1007),
  created     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated     TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS patch_submission_orphan_cleanup_object_key_key
  ON public.patch_submission_orphan_cleanup (object_key);

CREATE INDEX IF NOT EXISTS patch_submission_orphan_cleanup_created_id_idx
  ON public.patch_submission_orphan_cleanup (created, id);

DO $$
BEGIN
  ALTER TABLE public.patch_submission_orphan_cleanup
    ADD CONSTRAINT patch_submission_orphan_cleanup_key_prefix
    CHECK (object_key LIKE 'patch-submission/%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission_orphan_cleanup
    ADD CONSTRAINT patch_submission_orphan_cleanup_attempts_nonnegative
    CHECK (attempts >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission_orphan_cleanup
    ADD CONSTRAINT patch_submission_orphan_cleanup_purge_urls_array
    CHECK (jsonb_typeof(purge_urls) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $postflight$
DECLARE
  missing_columns integer;
  missing_indexes integer;
  missing_constraints integer;
BEGIN
  SELECT count(*)
  INTO missing_columns
  FROM (VALUES
    ('id'), ('object_key'), ('purge_urls'), ('source'), ('attempts'),
    ('last_error'), ('created'), ('updated')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patch_submission_orphan_cleanup'
      AND column_name = required.column_name
  );

  SELECT count(*)
  INTO missing_indexes
  FROM (VALUES
    ('patch_submission_orphan_cleanup_object_key_key'),
    ('patch_submission_orphan_cleanup_created_id_idx')
  ) AS required(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = required.index_name
  );

  SELECT count(*)
  INTO missing_constraints
  FROM (VALUES
    ('patch_submission_orphan_cleanup_key_prefix'),
    ('patch_submission_orphan_cleanup_attempts_nonnegative'),
    ('patch_submission_orphan_cleanup_purge_urls_array')
  ) AS required(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = required.constraint_name
      AND contype = 'c'
  );

  IF missing_columns <> 0 OR missing_indexes <> 0 OR missing_constraints <> 0 THEN
    RAISE EXCEPTION
      'patch_submission_orphan_cleanup postflight failed: columns=%, indexes=%, constraints=%',
      missing_columns, missing_indexes, missing_constraints;
  END IF;
END
$postflight$;
