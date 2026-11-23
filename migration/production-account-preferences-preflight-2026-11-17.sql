\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $check$
DECLARE
  column_row record;
  expected record;
  definition text;
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    RAISE EXCEPTION 'account preferences require public.user';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('nsfw_mode', 'character varying(4)', false, NULL::text),
    ('preference_version', 'integer', true, '0')
  ) AS definitions(name, kind, required, initial) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) AS kind, a.attnotnull AS required,
      pg_get_expr(d.adbin, d.adrelid) AS initial INTO column_row
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public."user"'::regclass AND a.attname=expected.name AND NOT a.attisdropped;
    IF FOUND AND (column_row.kind IS DISTINCT FROM expected.kind
      OR column_row.required IS DISTINCT FROM expected.required
      OR column_row.initial IS DISTINCT FROM expected.initial) THEN
      RAISE EXCEPTION 'incompatible user column: %', expected.name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public."user"'::regclass AND attname='nsfw_mode' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM public."user" WHERE nsfw_mode IS NOT NULL AND nsfw_mode NOT IN ('sfw','nsfw','all')) THEN
      RAISE EXCEPTION 'invalid stored NSFW mode';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public."user"'::regclass AND attname='preference_version' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM public."user" WHERE preference_version < 0) THEN
      RAISE EXCEPTION 'invalid account preference version';
    END IF;
  END IF;
  IF to_regclass('public.account_preference_version') IS NOT NULL THEN
    IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.account_preference_version'::regclass AND attnum>0 AND NOT attisdropped) <> 3 THEN
      RAISE EXCEPTION 'incompatible preference version columns';
    END IF;
    FOR expected IN SELECT * FROM (VALUES
      ('user_id', 'integer', NULL::text), ('setting_key', 'character varying(100)', NULL::text), ('version','integer','1')
    ) AS definitions(name,kind,initial) LOOP
      SELECT format_type(a.atttypid,a.atttypmod) AS kind,a.attnotnull AS required,
        pg_get_expr(d.adbin,d.adrelid) AS initial INTO column_row
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.account_preference_version'::regclass AND a.attname=expected.name AND NOT a.attisdropped;
      IF NOT FOUND OR column_row.kind IS DISTINCT FROM expected.kind OR NOT column_row.required
        OR column_row.initial IS DISTINCT FROM expected.initial THEN
        RAISE EXCEPTION 'incompatible preference version column: %',expected.name;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass
      AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (user_id, setting_key)') THEN
      RAISE EXCEPTION 'incompatible preference version primary key';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass
      AND contype='f' AND convalidated AND confrelid='public."user"'::regclass AND confdeltype='c' AND confupdtype='a'
      AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE') THEN
      RAISE EXCEPTION 'incompatible preference version foreign key';
    END IF;
    IF EXISTS (SELECT 1 FROM public.account_preference_version v LEFT JOIN public."user" u ON u.id=v.user_id
      WHERE v.version<1 OR v.setting_key='' OR u.id IS NULL) THEN
      RAISE EXCEPTION 'invalid preference versions or orphan accounts';
    END IF;
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('user', 'user_nsfw_mode_check', 'nsfw_modeISNULLORnsfw_mode=ANYARRAY[''sfw'',''nsfw'',''all''][]'),
    ('user', 'user_preference_version_check', 'preference_version>=0'),
    ('account_preference_version', 'account_preference_version_positive_check', 'version>0ANDsetting_key<>''''')
  ) AS definitions(relation, name, expression) LOOP
    SELECT contype, convalidated,
      regexp_replace(replace(replace(pg_get_expr(conbin, conrelid), '::character varying', ''), '::text', ''), '[[:space:]()]', '', 'g') AS expression
      INTO column_row FROM pg_constraint
      WHERE conrelid=to_regclass(format('public.%I', expected.relation)) AND conname=expected.name;
    IF FOUND AND (column_row.contype <> 'c' OR NOT column_row.convalidated
      OR column_row.expression IS DISTINCT FROM expected.expression) THEN
      RAISE EXCEPTION 'incompatible account preference constraint: % (%)', expected.name, column_row.expression;
    END IF;
  END LOOP;
END
$check$;
SELECT 'account-preferences preflight OK' AS result,
  to_regclass('public.account_preference_version') IS NOT NULL AS installed;
COMMIT;
