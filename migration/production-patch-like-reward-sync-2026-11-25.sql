\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.patch_like_reward (
  user_id integer NOT NULL,
  target_type varchar(32) NOT NULL,
  target_id integer NOT NULL,
  CONSTRAINT patch_like_reward_pkey PRIMARY KEY (user_id, target_type, target_id),
  CONSTRAINT patch_like_reward_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

LOCK TABLE public.user_patch_comment_like_relation, public.patch_rating_like,
  public.user_patch_resource_like_relation IN SHARE MODE;

INSERT INTO public.patch_like_reward (user_id, target_type, target_id)
SELECT user_id, 'patch_comment', comment_id FROM public.user_patch_comment_like_relation
UNION ALL
SELECT user_id, 'patch_rating', patch_rating_id FROM public.patch_rating_like
UNION ALL
SELECT user_id, 'patch_resource', resource_id FROM public.user_patch_resource_like_relation
ON CONFLICT (user_id, target_type, target_id) DO NOTHING;

COMMIT;
