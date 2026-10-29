-- Idempotent module 07 help board schema sync.
-- Run the read-only preflight first and the matching postflight afterwards.
-- Only creates the six help tables; no existing table is altered.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- A present help table must have passed the preflight review. This sync
-- creates missing tables and does not repair a partial table in place.
DO $existing_help$
DECLARE
  present_count integer;
BEGIN
  SELECT COUNT(*)
  INTO present_count
  FROM (VALUES
    ('help_post'), ('help_answer'), ('help_answer_vote'),
    ('help_follow'), ('help_daily_quota'), ('help_reply')
  ) AS required(table_name)
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL;

  IF present_count NOT IN (0, 6) THEN
    RAISE EXCEPTION
      'help sync refused: existing help tables are partial or incompatible; rerun preflight and review it';
  END IF;
END
$existing_help$;

CREATE TABLE IF NOT EXISTS public.help_post (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER,
  request_id         VARCHAR(64) NOT NULL,
  category           VARCHAR(16) NOT NULL,
  patch_id           INTEGER,
  game_name          VARCHAR(200) NOT NULL DEFAULT '',
  game_links         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  resource_id        INTEGER,
  title              VARCHAR(100) NOT NULL,
  content            VARCHAR(10007) NOT NULL,
  status             VARCHAR(8) NOT NULL DEFAULT 'open',
  accepted_answer_id INTEGER,
  rewarded_answer_id INTEGER,
  hidden_at          TIMESTAMP(3) WITHOUT TIME ZONE,
  deleted_at         TIMESTAMP(3) WITHOUT TIME ZONE,
  created            TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated            TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  CONSTRAINT help_post_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT help_post_patch_id_fkey
    FOREIGN KEY (patch_id) REFERENCES public.patch(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT help_post_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES public.patch_resource(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.help_answer (
  id         SERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL,
  user_id    INTEGER,
  request_id VARCHAR(64) NOT NULL,
  content    VARCHAR(10007) NOT NULL,
  hidden_at  TIMESTAMP(3) WITHOUT TIME ZONE,
  deleted_at TIMESTAMP(3) WITHOUT TIME ZONE,
  created    TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated    TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  CONSTRAINT help_answer_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.help_post(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT help_answer_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.help_answer_vote (
  id        SERIAL PRIMARY KEY,
  answer_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  created   TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT help_answer_vote_answer_id_fkey
    FOREIGN KEY (answer_id) REFERENCES public.help_answer(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT help_answer_vote_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.help_follow (
  id      SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT help_follow_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.help_post(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT help_follow_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.help_daily_quota (
  user_id      INTEGER NOT NULL,
  day          VARCHAR(10) NOT NULL,
  post_count   INTEGER NOT NULL DEFAULT 0,
  reward_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT help_daily_quota_pkey PRIMARY KEY (user_id, day),
  CONSTRAINT help_daily_quota_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS public.help_reply (
  id               SERIAL PRIMARY KEY,
  answer_id        INTEGER NOT NULL,
  user_id          INTEGER,
  reply_to_user_id INTEGER,
  request_id       VARCHAR(64) NOT NULL,
  content          VARCHAR(1000) NOT NULL,
  hidden_at        TIMESTAMP(3) WITHOUT TIME ZONE,
  deleted_at       TIMESTAMP(3) WITHOUT TIME ZONE,
  created          TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated          TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  CONSTRAINT help_reply_answer_id_fkey
    FOREIGN KEY (answer_id) REFERENCES public.help_answer(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT help_reply_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT help_reply_reply_to_user_id_fkey
    FOREIGN KEY (reply_to_user_id) REFERENCES public."user"(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS help_post_deleted_at_hidden_at_created_id_idx
  ON public.help_post (deleted_at, hidden_at, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS help_post_category_created_idx
  ON public.help_post (category, created DESC);
CREATE INDEX IF NOT EXISTS help_post_patch_id_created_idx
  ON public.help_post (patch_id, created DESC);
CREATE INDEX IF NOT EXISTS help_post_user_id_created_idx
  ON public.help_post (user_id, created DESC);
CREATE UNIQUE INDEX IF NOT EXISTS help_post_user_id_request_id_key
  ON public.help_post (user_id, request_id);
CREATE INDEX IF NOT EXISTS help_answer_post_id_created_id_idx
  ON public.help_answer (post_id, created, id);
CREATE INDEX IF NOT EXISTS help_answer_user_id_created_idx
  ON public.help_answer (user_id, created DESC);
CREATE UNIQUE INDEX IF NOT EXISTS help_answer_user_id_request_id_key
  ON public.help_answer (user_id, request_id);
CREATE INDEX IF NOT EXISTS help_answer_vote_user_id_idx
  ON public.help_answer_vote (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS help_answer_vote_answer_id_user_id_key
  ON public.help_answer_vote (answer_id, user_id);
CREATE INDEX IF NOT EXISTS help_follow_user_id_idx
  ON public.help_follow (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS help_follow_post_id_user_id_key
  ON public.help_follow (post_id, user_id);
CREATE INDEX IF NOT EXISTS help_reply_answer_id_created_id_idx
  ON public.help_reply (answer_id, created, id);
CREATE INDEX IF NOT EXISTS help_reply_user_id_created_idx
  ON public.help_reply (user_id, created DESC);
CREATE UNIQUE INDEX IF NOT EXISTS help_reply_user_id_request_id_key
  ON public.help_reply (user_id, request_id);

COMMIT;
