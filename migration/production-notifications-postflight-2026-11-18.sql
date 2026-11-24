\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $notification_check$
DECLARE expected record; actual record; relation_name text; invalid boolean; required boolean := true;
BEGIN
  IF to_regclass('public."user"') IS NULL OR to_regclass('public.user_message') IS NULL
    OR to_regclass('public.account_preference_version') IS NULL THEN
    RAISE EXCEPTION 'notifications require the reviewed account-preferences schema';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('user','user_nsfw_mode_check','nsfw_modeISNULLORnsfw_mode=ANYARRAY[''sfw'',''nsfw'',''all'']'),
    ('user','user_preference_version_check','preference_version>=0'),
    ('account_preference_version','account_preference_version_positive_check','version>0ANDsetting_key<>''''')
  ) AS prerequisite_checks(relation,name,expression) LOOP
    SELECT contype,convalidated,regexp_replace(regexp_replace(pg_get_expr(conbin,conrelid),
      '::(character varying|text|bigint)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') AS expression INTO actual
    FROM pg_constraint WHERE conrelid=to_regclass(format('public.%I',expected.relation)) AND conname=expected.name;
    IF NOT FOUND OR actual.contype <> 'c' OR NOT actual.convalidated OR actual.expression IS DISTINCT FROM expected.expression THEN
      RAISE EXCEPTION 'incompatible account-preferences check: %',expected.name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE (
      (c.conrelid=to_regclass('public.notification_subscription')
        AND c.conname NOT IN ('notification_subscription_pkey','notification_subscription_user_id_fkey','notification_subscription_event_type_check'))
      OR (c.conrelid=to_regclass('public.notification_content_sequence')
        AND c.conname NOT IN ('notification_content_sequence_pkey','notification_content_sequence_user_id_fkey','notification_content_sequence_scope_check'))
    ) AND NOT (
      c.contype='n' AND c.convalidated AND NOT c.condeferrable
      AND c.conislocal AND c.coninhcount=0 AND c.conparentid=0
      AND COALESCE((to_jsonb(c)->>'conenforced')::boolean, false)
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=c.conrelid AND NOT a.attisdropped AND a.attnotnull
          AND c.conkey=ARRAY[a.attnum]
          AND (
            (a.attrelid=to_regclass('public.notification_subscription')
              AND a.attname IN ('user_id','event_type','enabled'))
            OR (a.attrelid=to_regclass('public.notification_content_sequence')
              AND a.attname IN ('user_id','category','sequence'))
          )
      )
    )
  ) THEN
    RAISE EXCEPTION 'unexpected notification constraint';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.user_message') AND attname IN ('event_type') AND NOT attisdropped) = 1 THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_message WHERE NOT (event_type IS NULL OR event_type IN (''comment-reply'', ''mention'', ''like'', ''favorite'', ''follow'', ''follow-publication'', ''help-answer'', ''help-reply'', ''help-resource'', ''help-follow-answer'', ''help-follow-resolved'', ''help-accepted'', ''creator-application'', ''creator-result'', ''submission-pending'', ''submission-result'', ''resource-pending'', ''resource-result'', ''content-adjusted'', ''maintenance-required'', ''maintenance-result'', ''case-update'', ''case-follow'', ''case-reminder'', ''report-result'', ''feedback-result'', ''site-announcement'', ''moderation'', ''points'')))' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'invalid notification data for user_message_event_type_check'; END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.user_message') AND attname IN ('content_version', 'aggregate_count') AND NOT attisdropped) = 2 THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_message WHERE NOT (content_version > 0 AND aggregate_count > 0))' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'invalid notification data for user_message_content_version_check'; END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.user_message') AND attname IN ('dedup_key') AND NOT attisdropped) = 1 THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_message WHERE NOT (dedup_key IS NULL OR dedup_key ~ ''^[a-f0-9]{64}$''))' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'invalid notification data for user_message_dedup_key_check'; END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.notification_subscription') AND attname IN ('event_type') AND NOT attisdropped) = 1 THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.notification_subscription WHERE NOT (event_type IN (''comment-reply'', ''mention'', ''like'', ''favorite'', ''follow'', ''follow-publication'', ''help-answer'', ''help-reply'', ''help-resource'', ''help-follow-answer'', ''help-follow-resolved'', ''case-follow'', ''site-announcement'')))' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'invalid notification data for notification_subscription_event_type_check'; END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.notification_content_sequence') AND attname IN ('sequence', 'category') AND NOT attisdropped) = 2 THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.notification_content_sequence WHERE NOT (sequence >= 0 AND category IN ('''', ''interaction'', ''mention'', ''follow'', ''help'', ''review'', ''maintenance'', ''account'')))' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'invalid notification data for notification_content_sequence_scope_check'; END IF;
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['notification_subscription','notification_content_sequence'] LOOP
    IF to_regclass('public.' || relation_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I item LEFT JOIN public."user" account ON account.id=item.user_id WHERE account.id IS NULL)',relation_name) INTO invalid;
      IF invalid THEN RAISE EXCEPTION 'orphan notification account: %',relation_name; END IF;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I GROUP BY user_id,%I HAVING count(*) > 1)',relation_name,
        CASE relation_name WHEN 'notification_subscription' THEN 'event_type' ELSE 'category' END) INTO invalid;
      IF invalid THEN RAISE EXCEPTION 'duplicate notification identity: %',relation_name; END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.user_message'::regclass AND attname='dedup_key' AND NOT attisdropped) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_message WHERE dedup_key IS NOT NULL GROUP BY dedup_key HAVING count(*) > 1)' INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'duplicate notification dedup key'; END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.account_preference_version'::regclass AND attnum>0 AND NOT attisdropped) <> 3 THEN
    RAISE EXCEPTION 'incompatible account-preferences column set';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('user', 'nsfw_mode', 'character varying(4)', false, NULL::text),
    ('user', 'preference_version', 'integer', true, '0'),
    ('account_preference_version', 'user_id', 'integer', true, NULL::text),
    ('account_preference_version', 'setting_key', 'character varying(100)', true, NULL::text),
    ('account_preference_version', 'version', 'integer', true, '1')
  ) AS prerequisite(relation,name,kind,nonnull,initial) LOOP
    SELECT format_type(a.atttypid,a.atttypmod) AS kind,a.attnotnull AS nonnull,pg_get_expr(d.adbin,d.adrelid) AS initial INTO actual
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass(format('public.%I',expected.relation)) AND a.attname=expected.name AND NOT a.attisdropped;
    IF NOT FOUND OR actual.kind IS DISTINCT FROM expected.kind OR actual.nonnull IS DISTINCT FROM expected.nonnull OR actual.initial IS DISTINCT FROM expected.initial THEN
      RAISE EXCEPTION 'incompatible account-preferences prerequisite: %.%',expected.relation,expected.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass AND contype='p'
      AND NOT condeferrable AND pg_get_constraintdef(oid)='PRIMARY KEY (user_id, setting_key)')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass AND contype='f'
      AND convalidated AND NOT condeferrable AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."user"'::regclass AND conname='user_preference_version_check' AND convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.account_preference_version'::regclass AND conname='account_preference_version_positive_check' AND convalidated) THEN
    RAISE EXCEPTION 'account-preferences prerequisite constraints missing or incompatible';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['notification_subscription','notification_content_sequence'] LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      IF required THEN RAISE EXCEPTION 'notification table missing: %',relation_name; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.' || relation_name) AND relkind='r' AND NOT relrowsecurity)
      OR (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.' || relation_name) AND attnum>0 AND NOT attisdropped) <> 3
      OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.' || relation_name) AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'incompatible notification table: %',relation_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('user_message', 'event_type', 'character varying(100)', false, NULL::text),
    ('user_message', 'content_version', 'bigint', true, '1'),
    ('user_message', 'aggregate_count', 'integer', true, '1'),
    ('user_message', 'dedup_key', 'character varying(64)', false, NULL::text),
    ('notification_subscription', 'user_id', 'integer', true, NULL::text),
    ('notification_subscription', 'event_type', 'character varying(100)', true, NULL::text),
    ('notification_subscription', 'enabled', 'boolean', true, 'true'),
    ('notification_content_sequence', 'user_id', 'integer', true, NULL::text),
    ('notification_content_sequence', 'category', 'character varying(30)', true, NULL::text),
    ('notification_content_sequence', 'sequence', 'bigint', true, '0')
  ) AS columns(relation,name,kind,nonnull,initial) LOOP
    SELECT format_type(a.atttypid,a.atttypmod) AS kind,a.attnotnull AS nonnull,pg_get_expr(d.adbin,d.adrelid) AS initial INTO actual
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.' || expected.relation) AND a.attname=expected.name AND NOT a.attisdropped;
    IF NOT FOUND THEN
      IF required OR (expected.relation <> 'user_message' AND to_regclass('public.' || expected.relation) IS NOT NULL) THEN
        RAISE EXCEPTION 'notification column missing: %.%',expected.relation,expected.name;
      END IF;
    ELSIF actual.kind IS DISTINCT FROM expected.kind OR actual.nonnull IS DISTINCT FROM expected.nonnull OR actual.initial IS DISTINCT FROM expected.initial THEN
      RAISE EXCEPTION 'incompatible notification column: %.%',expected.relation,expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('notification_subscription', 'notification_subscription_pkey', 'p', 'PRIMARY KEY (user_id, event_type)'),
    ('notification_subscription', 'notification_subscription_user_id_fkey', 'f', 'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE'),
    ('notification_content_sequence', 'notification_content_sequence_pkey', 'p', 'PRIMARY KEY (user_id, category)'),
    ('notification_content_sequence', 'notification_content_sequence_user_id_fkey', 'f', 'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE')
  ) AS keys(relation,name,kind,definition) LOOP
    SELECT contype,convalidated,condeferrable,pg_get_constraintdef(oid) AS definition INTO actual
    FROM pg_constraint WHERE conrelid=to_regclass('public.' || expected.relation) AND conname=expected.name;
    IF NOT FOUND THEN
      IF required THEN RAISE EXCEPTION 'notification key missing: %',expected.name; END IF;
    ELSIF actual.contype::text <> expected.kind OR NOT actual.convalidated OR actual.condeferrable OR actual.definition IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'incompatible notification key: %',expected.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.' || expected.relation) AND contype::text=expected.kind AND conname<>expected.name) THEN
      RAISE EXCEPTION 'unexpected notification key: %',expected.relation;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('user_message', 'user_message_event_type_check', 'event_typeISNULLORevent_type=ANYARRAY[''comment-reply'',''mention'',''like'',''favorite'',''follow'',''follow-publication'',''help-answer'',''help-reply'',''help-resource'',''help-follow-answer'',''help-follow-resolved'',''help-accepted'',''creator-application'',''creator-result'',''submission-pending'',''submission-result'',''resource-pending'',''resource-result'',''content-adjusted'',''maintenance-required'',''maintenance-result'',''case-update'',''case-follow'',''case-reminder'',''report-result'',''feedback-result'',''site-announcement'',''moderation'',''points'']'),
    ('user_message', 'user_message_content_version_check', 'content_version>0ANDaggregate_count>0'),
    ('user_message', 'user_message_dedup_key_check', 'dedup_keyISNULLORdedup_key~''^[a-f0-9]{64}$'''),
    ('notification_subscription', 'notification_subscription_event_type_check', 'event_type=ANYARRAY[''comment-reply'',''mention'',''like'',''favorite'',''follow'',''follow-publication'',''help-answer'',''help-reply'',''help-resource'',''help-follow-answer'',''help-follow-resolved'',''case-follow'',''site-announcement'']'),
    ('notification_content_sequence', 'notification_content_sequence_scope_check', 'sequence>=0ANDcategory=ANYARRAY['''',''interaction'',''mention'',''follow'',''help'',''review'',''maintenance'',''account'']')
  ) AS checks(relation,name,expression) LOOP
    SELECT contype,convalidated,regexp_replace(regexp_replace(pg_get_expr(conbin,conrelid),
      '::(character varying|text|bigint)(\[\])?', '', 'g'), '[[:space:]()]', '', 'g') AS expression INTO actual
    FROM pg_constraint WHERE conrelid=to_regclass('public.' || expected.relation) AND conname=expected.name;
    IF NOT FOUND THEN
      IF required THEN RAISE EXCEPTION 'notification check missing: %',expected.name; END IF;
    ELSIF actual.contype <> 'c' OR NOT actual.convalidated OR actual.expression IS DISTINCT FROM expected.expression THEN
      RAISE EXCEPTION 'incompatible notification check: % (%)',expected.name,actual.expression;
    END IF;
  END LOOP;
  IF to_regclass('public.user_message_dedup_key_key') IS NULL THEN
    IF required THEN RAISE EXCEPTION 'notification dedup index missing'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid='public.user_message_dedup_key_key'::regclass AND i.indrelid='public.user_message'::regclass
    AND i.indisunique AND i.indisvalid AND i.indisready
    AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX user_message_dedup_key_key ON public.user_message USING btree (dedup_key)') THEN
    RAISE EXCEPTION 'incompatible notification dedup index';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('user_message_recipient_id_id_idx', 'CREATE INDEX user_message_recipient_id_id_idx ON public.user_message USING btree (recipient_id, id)'),
    ('user_message_recipient_id_status_id_idx', 'CREATE INDEX user_message_recipient_id_status_id_idx ON public.user_message USING btree (recipient_id, status, id)')
  ) AS indexes(name,definition) LOOP
    IF to_regclass('public.' || expected.name) IS NULL THEN
      IF required THEN RAISE EXCEPTION 'notification cursor index missing: %',expected.name; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.' || expected.name)
      AND i.indrelid='public.user_message'::regclass AND NOT i.indisunique AND i.indisvalid AND i.indisready
      AND pg_get_indexdef(i.indexrelid)=expected.definition) THEN
      RAISE EXCEPTION 'incompatible notification cursor index: %',expected.name;
    END IF;
  END LOOP;
END
$notification_check$;
SELECT 'notifications postflight OK' AS result,
  CASE installed.components WHEN 0 THEN 'not-installed' WHEN 24 THEN 'complete' ELSE 'partial' END AS installation_state,
  installed.components AS installed_components
FROM (SELECT (SELECT count(*) FROM pg_attribute a JOIN (VALUES ('user_message', 'event_type'),
    ('user_message', 'content_version'),
    ('user_message', 'aggregate_count'),
    ('user_message', 'dedup_key'),
    ('notification_subscription', 'user_id'),
    ('notification_subscription', 'event_type'),
    ('notification_subscription', 'enabled'),
    ('notification_content_sequence', 'user_id'),
    ('notification_content_sequence', 'category'),
    ('notification_content_sequence', 'sequence')) expected(relation,name)
  ON a.attrelid=to_regclass('public.' || expected.relation) AND a.attname=expected.name AND NOT a.attisdropped)
  + (SELECT count(*) FROM pg_constraint c JOIN (VALUES ('notification_subscription', 'notification_subscription_pkey'),
    ('notification_subscription', 'notification_subscription_user_id_fkey'),
    ('notification_content_sequence', 'notification_content_sequence_pkey'),
    ('notification_content_sequence', 'notification_content_sequence_user_id_fkey'),
    ('user_message', 'user_message_event_type_check'),
    ('user_message', 'user_message_content_version_check'),
    ('user_message', 'user_message_dedup_key_check'),
    ('notification_subscription', 'notification_subscription_event_type_check'),
    ('notification_content_sequence', 'notification_content_sequence_scope_check')) expected(relation,name)
  ON c.conrelid=to_regclass('public.' || expected.relation) AND c.conname=expected.name)
  + CASE WHEN to_regclass('public.user_message_dedup_key_key') IS NULL THEN 0 ELSE 1 END
  + CASE WHEN to_regclass('public.user_message_recipient_id_id_idx') IS NULL THEN 0 ELSE 1 END
  + CASE WHEN to_regclass('public.user_message_recipient_id_status_id_idx') IS NULL THEN 0 ELSE 1 END
  + CASE WHEN to_regclass('public.notification_subscription') IS NULL THEN 0 ELSE 1 END
  + CASE WHEN to_regclass('public.notification_content_sequence') IS NULL THEN 0 ELSE 1 END AS components) installed;
COMMIT;
