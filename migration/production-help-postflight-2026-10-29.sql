-- Independent read-only verification for the module 07 help board sync.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $required_tables$
BEGIN
  IF to_regclass('public.help_post') IS NULL
     OR to_regclass('public.help_answer') IS NULL
     OR to_regclass('public.help_answer_vote') IS NULL
     OR to_regclass('public.help_follow') IS NULL
     OR to_regclass('public.help_daily_quota') IS NULL
     OR to_regclass('public.help_reply') IS NULL THEN
    RAISE EXCEPTION 'help postflight failed: all six help tables must exist';
  END IF;
END
$required_tables$;

DO $required_constraints$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*)
  INTO missing_count
  FROM (VALUES
    ('help_post_user_id_fkey', 'n'),
    ('help_post_patch_id_fkey', 'n'),
    ('help_post_resource_id_fkey', 'n'),
    ('help_answer_post_id_fkey', 'c'),
    ('help_answer_user_id_fkey', 'n'),
    ('help_answer_vote_answer_id_fkey', 'c'),
    ('help_answer_vote_user_id_fkey', 'c'),
    ('help_follow_post_id_fkey', 'c'),
    ('help_follow_user_id_fkey', 'c'),
    ('help_daily_quota_user_id_fkey', 'c'),
    ('help_reply_answer_id_fkey', 'c'),
    ('help_reply_user_id_fkey', 'n'),
    ('help_reply_reply_to_user_id_fkey', 'n')
  ) AS expected(conname, delete_action)
  LEFT JOIN pg_constraint actual
    ON actual.conname = expected.conname AND actual.contype = 'f'
  WHERE actual.oid IS NULL OR actual.confdeltype <> expected.delete_action;

  IF missing_count <> 0 THEN
    RAISE EXCEPTION
      'help postflight failed: % foreign keys missing or with a wrong referential action',
      missing_count;
  END IF;
END
$required_constraints$;

DO $required_indexes$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*)
  INTO missing_count
  FROM (VALUES
    ('help_post_user_id_request_id_key', TRUE),
    ('help_answer_user_id_request_id_key', TRUE),
    ('help_answer_vote_answer_id_user_id_key', TRUE),
    ('help_follow_post_id_user_id_key', TRUE),
    ('help_post_deleted_at_hidden_at_created_id_idx', FALSE),
    ('help_post_category_created_idx', FALSE),
    ('help_post_patch_id_created_idx', FALSE),
    ('help_post_user_id_created_idx', FALSE),
    ('help_answer_post_id_created_id_idx', FALSE),
    ('help_answer_user_id_created_idx', FALSE),
    ('help_answer_vote_user_id_idx', FALSE),
    ('help_follow_user_id_idx', FALSE),
    ('help_reply_user_id_request_id_key', TRUE),
    ('help_reply_answer_id_created_id_idx', FALSE),
    ('help_reply_user_id_created_idx', FALSE)
  ) AS expected(index_name, is_unique)
  LEFT JOIN pg_class relation ON relation.relname = expected.index_name
  LEFT JOIN pg_index metadata ON metadata.indexrelid = relation.oid
  WHERE metadata.indexrelid IS NULL
     OR metadata.indisunique <> expected.is_unique
     OR NOT metadata.indisvalid;

  IF missing_count <> 0 THEN
    RAISE EXCEPTION
      'help postflight failed: % indexes missing, invalid or with wrong uniqueness',
      missing_count;
  END IF;
END
$required_indexes$;

SELECT 'help_rows' AS check_type,
  (SELECT COUNT(*) FROM public.help_post)::bigint AS post_count,
  (SELECT COUNT(*) FROM public.help_answer)::bigint AS answer_count,
  (SELECT COUNT(*) FROM public.help_reply)::bigint AS reply_count;

COMMIT;
