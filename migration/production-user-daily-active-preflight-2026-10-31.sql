-- Read-only preflight for user_daily_active: one row per user per Shanghai
-- calendar day with an authenticated visit (decision 10, §10.5). Reports
-- whether the table and its constraints already exist and in what shape.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT
  'user_daily_active' AS target,
  CASE
    WHEN to_regclass('public.user_daily_active') IS NULL THEN 'ready_to_create'
    WHEN (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.user_daily_active')) <> 'r'
      THEN 'name_taken_by_non_table'
    ELSE 'present'
  END AS state;

-- When present, the columns must match exactly.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_daily_active'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.user_daily_active')
ORDER BY conname;

-- The foreign key needs the user table.
SELECT 'user' AS required_table,
       CASE WHEN to_regclass('public."user"') IS NULL THEN 'missing' ELSE 'ok' END AS state;

COMMIT;
