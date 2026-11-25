\set ON_ERROR_STOP on
\if :{?require_complete}
\else
  \set require_complete false
\endif

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public;
SELECT set_config('otoame.require_complete', :'require_complete', true) AS require_complete \gset

DO $$
DECLARE
  reward_table regclass := to_regclass('public.patch_like_reward');
  columns text[];
  constraints text[];
  pending bigint;
BEGIN
  IF reward_table IS NOT NULL THEN
    SELECT array_agg(attname || ':' || format_type(atttypid, atttypmod)
      || ':' || attnotnull::text || ':' || atthasdef::text ORDER BY attnum)
    INTO columns
    FROM pg_attribute
    WHERE attrelid = reward_table AND attnum > 0 AND NOT attisdropped;

    SELECT array_agg(pg_get_constraintdef(oid) ORDER BY contype)
    INTO constraints
    FROM pg_constraint
    WHERE conrelid = reward_table AND contype <> 'n';

    IF columns IS DISTINCT FROM ARRAY[
      'user_id:integer:true:false',
      'target_type:character varying(32):true:false',
      'target_id:integer:true:false'
    ] OR constraints IS DISTINCT FROM ARRAY[
      'FOREIGN KEY (user_id) REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE',
      'PRIMARY KEY (user_id, target_type, target_id)'
    ] OR EXISTS (
      SELECT 1 FROM pg_class WHERE oid = reward_table AND relkind <> 'r'
    ) OR EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = reward_table AND (NOT convalidated OR condeferrable)
    ) THEN
      RAISE EXCEPTION 'patch-like-reward: incompatible reward table';
    END IF;
  END IF;

  IF reward_table IS NULL THEN
    IF current_setting('otoame.require_complete')::boolean THEN
      RAISE EXCEPTION 'patch-like-reward: reward table is missing';
    END IF;
    SELECT (SELECT count(*) FROM public.user_patch_comment_like_relation)
         + (SELECT count(*) FROM public.patch_rating_like)
         + (SELECT count(*) FROM public.user_patch_resource_like_relation)
    INTO pending;
    RAISE NOTICE 'patch-like-reward preflight OK, installed=false, pending=%', pending;
    RETURN;
  END IF;

  SELECT count(*) INTO pending
  FROM (
    SELECT user_id, 'patch_comment' AS target_type, comment_id AS target_id
    FROM public.user_patch_comment_like_relation
    UNION ALL
    SELECT user_id, 'patch_rating', patch_rating_id
    FROM public.patch_rating_like
    UNION ALL
    SELECT user_id, 'patch_resource', resource_id
    FROM public.user_patch_resource_like_relation
  ) AS likes
  WHERE NOT EXISTS (
    SELECT 1 FROM public.patch_like_reward AS reward
    WHERE reward.user_id = likes.user_id
      AND reward.target_type = likes.target_type
      AND reward.target_id = likes.target_id
  );
  IF pending > 0 AND current_setting('otoame.require_complete')::boolean THEN
    RAISE EXCEPTION 'patch-like-reward: % current likes still lack a reward record', pending;
  END IF;
  RAISE NOTICE 'patch-like-reward preflight OK, installed=true, pending=%', pending;
END $$;

COMMIT;
