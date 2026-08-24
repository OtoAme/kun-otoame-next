-- Production sync for the user submission domain. Creates patch_submission and
-- patch_submission_gallery to match prisma/schema/patch-submission.prisma, then
-- adds the CHECK constraints Prisma cannot express.
--
-- Run the matching preflight first. Safe to rerun: every step is guarded.
-- Run outside an explicit transaction block: CREATE INDEX CONCURRENTLY cannot
-- run inside one.

\set ON_ERROR_STOP on

DO $preflight$
BEGIN
  IF to_regclass('public.patch') IS NULL
    OR to_regclass('public."user"') IS NULL
    OR to_regclass('public.user_moemoepoint_reservation') IS NULL THEN
    RAISE EXCEPTION
      'patch, user and user_moemoepoint_reservation must exist before the submission domain';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.patch_submission (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL,
  status              VARCHAR(32) NOT NULL DEFAULT 'draft',
  payload             JSONB NOT NULL,
  payload_version     INTEGER NOT NULL DEFAULT 1,
  external_source     VARCHAR(64),
  external_fetched_at TIMESTAMP(3),
  name                VARCHAR(1007) NOT NULL,
  vndb_id             VARCHAR(107),
  vndb_relation_id    VARCHAR(107),
  bangumi_id          INTEGER,
  steam_id            INTEGER,
  dlsite_code         VARCHAR(107),
  revision            INTEGER NOT NULL DEFAULT 1,
  role_at_creation    INTEGER NOT NULL,
  held_amount         INTEGER NOT NULL,
  reservation_id      INTEGER,
  reviewed_by_id      INTEGER,
  review_reason       VARCHAR(1007),
  reviewed_at         TIMESTAMP(3),
  patch_id            INTEGER,
  banner_key           VARCHAR(1007),
  banner_thumbnail_key VARCHAR(1007),
  banner_original_key  VARCHAR(1007),
  hidden_by_user      BOOLEAN NOT NULL DEFAULT false,
  submitted_at        TIMESTAMP(3),
  settled_at          TIMESTAMP(3),
  created             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.patch_submission_gallery (
  id                SERIAL PRIMARY KEY,
  submission_id     INTEGER NOT NULL,
  client_asset_id   VARCHAR(64) NOT NULL,
  upload_status     VARCHAR(16) NOT NULL DEFAULT 'uploading',
  file_fingerprint  VARCHAR(128),
  declared_bytes    INTEGER NOT NULL DEFAULT 0,
  image_key         VARCHAR(1007),
  thumbnail_key     VARCHAR(1007),
  is_nsfw           BOOLEAN NOT NULL DEFAULT false,
  display_order     INTEGER NOT NULL DEFAULT 0,
  status_changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_reservation_id_fkey
    FOREIGN KEY (reservation_id) REFERENCES public.user_moemoepoint_reservation(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_reviewed_by_id_fkey
    FOREIGN KEY (reviewed_by_id) REFERENCES public."user"(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_patch_id_fkey
    FOREIGN KEY (patch_id) REFERENCES public.patch(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission_gallery
    ADD CONSTRAINT patch_submission_gallery_submission_id_fkey
    FOREIGN KEY (submission_id) REFERENCES public.patch_submission(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS patch_submission_reservation_id_key
  ON public.patch_submission (reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS patch_submission_patch_id_key
  ON public.patch_submission (patch_id);
CREATE INDEX IF NOT EXISTS patch_submission_user_id_status_created_idx
  ON public.patch_submission (user_id, status, created DESC);
CREATE INDEX IF NOT EXISTS patch_submission_status_submitted_at_idx
  ON public.patch_submission (status, submitted_at);
CREATE INDEX IF NOT EXISTS patch_submission_vndb_id_idx
  ON public.patch_submission (vndb_id);
CREATE INDEX IF NOT EXISTS patch_submission_vndb_relation_id_idx
  ON public.patch_submission (vndb_relation_id);
CREATE INDEX IF NOT EXISTS patch_submission_bangumi_id_idx
  ON public.patch_submission (bangumi_id);
CREATE INDEX IF NOT EXISTS patch_submission_steam_id_idx
  ON public.patch_submission (steam_id);
CREATE INDEX IF NOT EXISTS patch_submission_dlsite_code_idx
  ON public.patch_submission (dlsite_code);
CREATE INDEX IF NOT EXISTS patch_submission_name_idx
  ON public.patch_submission (name);
CREATE INDEX IF NOT EXISTS patch_submission_reviewed_by_id_idx
  ON public.patch_submission (reviewed_by_id);

CREATE UNIQUE INDEX IF NOT EXISTS patch_submission_gallery_submission_id_client_asset_id_key
  ON public.patch_submission_gallery (submission_id, client_asset_id);
CREATE INDEX IF NOT EXISTS patch_submission_gallery_submission_id_display_order_idx
  ON public.patch_submission_gallery (submission_id, display_order);
CREATE INDEX IF NOT EXISTS patch_submission_gallery_submission_id_upload_status_idx
  ON public.patch_submission_gallery (submission_id, upload_status);

-- Constraints Prisma cannot express. The status list is the state machine: a
-- value outside it means some code path invented a state.
DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_status_valid
    CHECK (status IN (
      'draft', 'pending', 'changes_requested',
      'rejected', 'published', 'violation', 'deleted'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_held_amount_nonnegative
    CHECK (held_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission
    ADD CONSTRAINT patch_submission_revision_positive
    CHECK (revision >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission_gallery
    ADD CONSTRAINT patch_submission_gallery_upload_status_valid
    CHECK (upload_status IN ('uploading', 'ready', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.patch_submission_gallery
    ADD CONSTRAINT patch_submission_gallery_declared_bytes_nonnegative
    CHECK (declared_bytes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $postflight$
DECLARE
  missing_tables integer;
  missing_indexes integer;
  missing_constraints integer;
BEGIN
  SELECT count(*)
  INTO missing_tables
  FROM (VALUES ('patch_submission'), ('patch_submission_gallery')) AS required(table_name)
  WHERE to_regclass('public.' || quote_ident(required.table_name)) IS NULL;

  SELECT count(*)
  INTO missing_indexes
  FROM (VALUES
    ('patch_submission_user_id_status_created_idx'),
    ('patch_submission_status_submitted_at_idx'),
    ('patch_submission_reservation_id_key'),
    ('patch_submission_patch_id_key'),
    ('patch_submission_gallery_submission_id_client_asset_id_key'),
    ('patch_submission_gallery_submission_id_upload_status_idx')
  ) AS required(index_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = required.index_name
  );

  SELECT count(*)
  INTO missing_constraints
  FROM (VALUES
    ('patch_submission_status_valid'),
    ('patch_submission_held_amount_nonnegative'),
    ('patch_submission_revision_positive'),
    ('patch_submission_gallery_upload_status_valid'),
    ('patch_submission_gallery_declared_bytes_nonnegative')
  ) AS required(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = required.constraint_name AND contype = 'c'
  );

  IF missing_tables <> 0 OR missing_indexes <> 0 OR missing_constraints <> 0 THEN
    RAISE EXCEPTION
      'patch_submission postflight failed: tables=%, indexes=%, constraints=%',
      missing_tables, missing_indexes, missing_constraints;
  END IF;
END
$postflight$;
