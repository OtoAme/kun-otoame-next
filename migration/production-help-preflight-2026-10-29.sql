-- Read-only inventory for the module 07 help board schema.
-- Run this file before the matching sync file and review every result.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'target_table' AS check_type,
  table_name,
  CASE
    WHEN to_regclass(format('public.%I', table_name)) IS NULL
      THEN 'ready_to_create'
    ELSE 'present_review_definition'
  END AS status
FROM (VALUES
  ('help_post'),
  ('help_answer'),
  ('help_answer_vote'),
  ('help_follow'),
  ('help_daily_quota'),
  ('help_reply')
) AS required(table_name)
ORDER BY table_name;

SELECT
  'dependency_table' AS check_type,
  table_name,
  to_regclass(format('public.%I', table_name)) IS NOT NULL AS present
FROM (VALUES ('user'), ('patch'), ('patch_resource'), ('ops_case'))
  AS dependency(table_name)
ORDER BY table_name;

SELECT
  'help_case_rows' AS check_type,
  target_type,
  COUNT(*)::bigint AS row_count
FROM public.ops_case
WHERE target_type IN ('help', 'help_answer', 'help_reply')
GROUP BY target_type
ORDER BY target_type;

COMMIT;
