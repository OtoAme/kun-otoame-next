-- W04/M04-2 + M10 snapshot schema, accepted W00 2026-10-09.
-- Manual rollout only; drain all old writers before sync. No data backfill/reset.
\set ON_ERROR_STOP on
-- initial_baseline=true is ONLY for first upgrade before new writers run.
\if :{?initial_baseline}
\else
\set initial_baseline false
\endif
BEGIN TRANSACTION READ ONLY;
DO $link_health_shape$
DECLARE wanted record; actual record; target_oid oid; current_default text; fk_count integer;
BEGIN
  FOR wanted IN SELECT unnest(ARRAY['user','patch','patch_resource','patch_resource_link','patch_resource_access','patch_resource_access_grant']) AS table_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || quote_ident(wanted.table_name)) AND relkind = 'r') THEN
      RAISE EXCEPTION 'link health migration: missing prerequisite %', wanted.table_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'patch_resource' AND column_name IN ('storage','size','code','password','hash','content')) THEN
    RAISE EXCEPTION 'link health migration: complete legacy resource-links migration before this rollout';
  END IF;
  FOR wanted IN SELECT * FROM (VALUES ('patch_resource_link_report',9),('patch_resource_link_history',12),('patch_resource_link_check',17)) AS shape(table_name,column_count) LOOP
    target_oid := to_regclass('public.' || wanted.table_name);
    IF target_oid IS NULL THEN
      IF true THEN RAISE EXCEPTION 'link health migration: missing target %', wanted.table_name; END IF;
      IF to_regclass('public.' || wanted.table_name || '_id_seq') IS NOT NULL THEN RAISE EXCEPTION 'link health migration: orphan sequence for %',wanted.table_name; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=target_oid AND relkind='r') OR (SELECT count(*) FROM pg_attribute WHERE attrelid=target_oid AND attnum>0 AND NOT attisdropped) <> wanted.column_count THEN
      RAISE EXCEPTION 'link health migration: incompatible table %', wanted.table_name;
    END IF;
  END LOOP;
  FOR wanted IN SELECT * FROM (VALUES
    ('patch_resource_link', 'health', 'character varying(20)', true, 'ok'),
    ('patch_resource_link', 'version', 'integer', true, '1'),
    ('patch_resource_link', 'evidence_round', 'integer', true, '0'),
    ('patch_resource_link', 'health_changed_at', 'timestamp(3) without time zone', false, 'none'),
    ('patch_resource_link', 'verified_at', 'timestamp(3) without time zone', false, 'none'),
    ('patch_resource_link', 'content_changed_at', 'timestamp(3) without time zone', false, 'none'),
    ('patch_resource_access', 'link_version', 'integer', false, 'none'),
    ('patch_resource_link_report', 'id', 'integer', true, 'serial'),
    ('patch_resource_link_report', 'created', 'timestamp(3) without time zone', true, 'created'),
    ('patch_resource_link_history', 'id', 'integer', true, 'serial'),
    ('patch_resource_link_history', 'created', 'timestamp(3) without time zone', true, 'created'),
    ('patch_resource_link_report', 'link_id', 'integer', true, 'none'),
    ('patch_resource_link_report', 'link_version', 'integer', true, 'none'),
    ('patch_resource_link_report', 'evidence_round', 'integer', true, 'none'),
    ('patch_resource_link_report', 'user_id', 'integer', true, 'none'),
    ('patch_resource_link_report', 'reason', 'character varying(32)', true, 'none'),
    ('patch_resource_link_report', 'weight', 'numeric(3,1)', true, 'none'),
    ('patch_resource_link_report', 'ever_counted', 'boolean', true, 'none'),
    ('patch_resource_link_history', 'resource_id', 'integer', true, 'none'),
    ('patch_resource_link_history', 'link_id', 'integer', true, 'none'),
    ('patch_resource_link_history', 'from_version', 'integer', true, 'none'),
    ('patch_resource_link_history', 'old_content', 'text', false, 'none'),
    ('patch_resource_link_history', 'old_storage', 'character varying(107)', false, 'none'),
    ('patch_resource_link_history', 'old_size', 'character varying(107)', false, 'none'),
    ('patch_resource_link_history', 'reason', 'character varying(20)', true, 'none'),
    ('patch_resource_link_history', 'operator_user_id', 'integer', false, 'none'),
    ('patch_resource_link_history', 'health_transition', 'jsonb', false, 'none'),
    ('patch_resource_link_history', 'health_event_key', 'character varying(107)', false, 'none'),
    ('patch_resource_link_check', 'link_id', 'integer', true, 'none'),
    ('patch_resource_link_check', 'patch_id', 'integer', true, 'none'),
    ('patch_resource_link_check', 'resource_id', 'integer', true, 'none'),
    ('patch_resource_link_check', 'link_version', 'integer', true, 'none'),
    ('patch_resource_link_check', 'evidence_round', 'integer', true, 'none'),
    ('patch_resource_link_check', 'health', 'character varying(20)', true, 'none'),
    ('patch_resource_link_check', 'health_changed_at', 'timestamp(3) without time zone', false, 'none'),
    ('patch_resource_link_check', 'request_id', 'uuid', true, 'none'),
    ('patch_resource_link_check', 'input_signature', 'character varying(64)', true, 'none'),
    ('patch_resource_link_check', 'requested_at', 'timestamp(3) without time zone', true, 'none'),
    ('patch_resource_link_check', 'completed_at', 'timestamp(3) without time zone', true, 'none'),
    ('patch_resource_link_check', 'verdict', 'character varying(20)', true, 'none'),
    ('patch_resource_link_check', 'provider', 'character varying(20)', false, 'none'),
    ('patch_resource_link_check', 'reason', 'character varying(32)', true, 'none'),
    ('patch_resource_link_check', 'checked_at', 'timestamp(3) without time zone', false, 'none'),
    ('patch_resource_link_check', 'cached', 'boolean', true, 'none'),
    ('patch_resource_link_check', 'failed', 'boolean', true, 'none')
  ) AS shape(table_name,column_name,column_type,not_null,default_kind) LOOP
    SELECT format_type(a.atttypid,a.atttypmod) AS column_type,a.attnotnull AS not_null,a.attgenerated,a.attidentity,pg_get_expr(d.adbin,d.adrelid) AS default_value INTO actual
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.' || wanted.table_name) AND a.attname=wanted.column_name AND NOT a.attisdropped;
    IF NOT FOUND THEN
      IF true OR to_regclass('public.' || wanted.table_name) IS NOT NULL AND wanted.table_name IN ('patch_resource_link_report','patch_resource_link_history','patch_resource_link_check') THEN RAISE EXCEPTION 'link health migration: missing column %.%',wanted.table_name,wanted.column_name; END IF;
      CONTINUE;
    END IF;
    current_default := actual.default_value;
    IF actual.column_type <> wanted.column_type OR actual.not_null <> wanted.not_null OR actual.attgenerated <> '' OR actual.attidentity <> '' OR
      (CASE wanted.default_kind
        WHEN 'none' THEN current_default IS NOT NULL
        WHEN 'serial' THEN pg_get_serial_sequence('public.' || wanted.table_name,wanted.column_name) IS NULL OR current_default IS DISTINCT FROM format('nextval(%L::regclass)',pg_get_serial_sequence('public.' || wanted.table_name,wanted.column_name)::regclass::text)
        WHEN 'created' THEN current_default IS DISTINCT FROM 'CURRENT_TIMESTAMP'
        WHEN 'ok' THEN current_default IS DISTINCT FROM '''ok''::character varying'
        ELSE current_default IS DISTINCT FROM wanted.default_kind END) THEN
      RAISE EXCEPTION 'link health migration: incompatible column %.%',wanted.table_name,wanted.column_name;
    END IF;
  END LOOP;
  SELECT conname,confdeltype,confupdtype,convalidated,condeferrable,confrelid,conkey,confkey INTO actual FROM pg_constraint WHERE conrelid='public.patch_resource_access'::regclass AND conname='patch_resource_access_link_id_fkey' AND contype='f';
  IF NOT FOUND OR actual.confrelid <> 'public.patch_resource_link'::regclass OR actual.confupdtype <> 'a' OR NOT actual.convalidated OR actual.condeferrable OR actual.conkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.patch_resource_access'::regclass AND attname='link_id')]::smallint[] OR actual.confkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.patch_resource_link'::regclass AND attname='id')]::smallint[] OR
    (CASE WHEN true THEN actual.confdeltype <> 'n' ELSE actual.confdeltype NOT IN ('c','n') END) OR
    (SELECT attnotnull FROM pg_attribute WHERE attrelid='public.patch_resource_access'::regclass AND attname='link_id') <> (actual.confdeltype = 'c') THEN
    RAISE EXCEPTION 'link health migration: incompatible access link FK/nullability';
  END IF;
  FOR wanted IN SELECT * FROM (VALUES
    ('patch_resource_link_report', 'patch_resource_link_report_link_id_fkey', 'link_id', 'patch_resource_link', 'id', 'c'),
    ('patch_resource_link_report', 'patch_resource_link_report_user_id_fkey', 'user_id', 'user', 'id', 'c'),
    ('patch_resource_link_history', 'patch_resource_link_history_resource_id_fkey', 'resource_id', 'patch_resource', 'id', 'c'),
    ('patch_resource_link_history', 'patch_resource_link_history_operator_user_id_fkey', 'operator_user_id', 'user', 'id', 'n'),
    ('patch_resource_link_check', 'patch_resource_link_check_link_id_fkey', 'link_id', 'patch_resource_link', 'id', 'c')
  ) AS shape(table_name,constraint_name,column_name,target_table,target_column,delete_action) LOOP
    SELECT * INTO actual FROM pg_constraint WHERE conrelid=to_regclass('public.' || wanted.table_name) AND conname=wanted.constraint_name;
    IF NOT FOUND THEN
      IF true OR to_regclass('public.' || wanted.table_name) IS NOT NULL THEN RAISE EXCEPTION 'link health migration: missing FK %',wanted.constraint_name; END IF;
      CONTINUE;
    END IF;
    IF actual.contype <> 'f' OR actual.confrelid <> to_regclass('public.' || quote_ident(wanted.target_table)) OR actual.confdeltype::text <> wanted.delete_action OR actual.confupdtype <> 'a' OR NOT actual.convalidated OR actual.condeferrable OR actual.conkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=actual.conrelid AND attname=wanted.column_name)]::smallint[] OR actual.confkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=actual.confrelid AND attname=wanted.target_column)]::smallint[] THEN RAISE EXCEPTION 'link health migration: incompatible FK %',wanted.constraint_name; END IF;
  END LOOP;
  FOR wanted IN SELECT * FROM (VALUES ('patch_resource_link_report',2),('patch_resource_link_history',2),('patch_resource_link_check',1)) AS shape(table_name,fk_count) LOOP
    IF to_regclass('public.' || wanted.table_name) IS NOT NULL AND (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.' || wanted.table_name) AND contype='f') <> wanted.fk_count THEN RAISE EXCEPTION 'link health migration: unexpected FK on %',wanted.table_name; END IF;
  END LOOP;
  FOR wanted IN SELECT * FROM (VALUES
    ('patch_resource_link', 'patch_resource_link_health_health_changed_at_idx', false, false, 'health,health_changed_at', '0,0'),
    ('patch_resource_link_report', 'patch_resource_link_report_pkey', true, true, 'id', '0'),
    ('patch_resource_link_report', 'link_report_identity_key', true, false, 'link_id,link_version,evidence_round,user_id', '0,0,0,0'),
    ('patch_resource_link_report', 'link_report_window_idx', false, false, 'link_id,link_version,evidence_round,created', '0,0,0,0'),
    ('patch_resource_link_history', 'patch_resource_link_history_pkey', true, true, 'id', '0'),
    ('patch_resource_link_history', 'patch_resource_link_history_health_event_key_key', true, false, 'health_event_key', '0'),
    ('patch_resource_link_history', 'patch_resource_link_history_resource_id_created_idx', false, false, 'resource_id,created', '0,3'),
    ('patch_resource_link_history', 'patch_resource_link_history_link_id_created_idx', false, false, 'link_id,created', '0,3'),
    ('patch_resource_link_check', 'patch_resource_link_check_pkey', true, true, 'link_id', '0')
  ) AS shape(table_name,index_name,is_unique,is_primary,column_names,sort_options) LOOP
    SELECT i.*,am.amname,c.relkind,
      (SELECT string_agg(a.attname,',' ORDER BY pos) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum,pos) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum) AS column_names,
      array_to_string(i.indoption::smallint[],',') AS sort_options INTO actual
    FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid=c.oid LEFT JOIN pg_class t ON t.oid=i.indrelid LEFT JOIN pg_am am ON am.oid=c.relam WHERE c.oid=to_regclass('public.' || wanted.index_name);
    IF NOT FOUND THEN
      IF true OR to_regclass('public.' || wanted.table_name) IS NOT NULL AND wanted.table_name IN ('patch_resource_link_report','patch_resource_link_history','patch_resource_link_check') THEN RAISE EXCEPTION 'link health migration: missing index %',wanted.index_name; END IF;
      CONTINUE;
    END IF;
    IF actual.relkind <> 'i' OR actual.indrelid IS DISTINCT FROM to_regclass('public.' || wanted.table_name) OR actual.amname <> 'btree' OR actual.indisunique <> wanted.is_unique OR actual.indisprimary <> wanted.is_primary OR NOT actual.indisready OR NOT actual.indisvalid OR NOT actual.indislive OR actual.indpred IS NOT NULL OR actual.indexprs IS NOT NULL OR actual.indnatts <> actual.indnkeyatts OR actual.column_names <> wanted.column_names OR actual.sort_options <> wanted.sort_options OR actual.indnullsnotdistinct THEN RAISE EXCEPTION 'link health migration: incompatible index %',wanted.index_name; END IF;
  END LOOP;
END
$link_health_shape$;
DO $check_shape$
DECLARE wanted record; actual record;
BEGIN
  FOR wanted IN SELECT * FROM (VALUES
    ('patch_resource_link', 'link_health_state_check', 'CHECK ((((health)::text = ANY ((ARRAY[''ok''::character varying, ''suspect''::character varying, ''disputed''::character varying, ''broken''::character varying])::text[])) IS TRUE))'),
    ('patch_resource_link', 'link_health_version_check', 'CHECK ((((version > 0) AND (evidence_round >= 0)) IS TRUE))'),
    ('patch_resource_access', 'resource_access_link_version_check', 'CHECK ((((link_version IS NULL) OR (link_version > 0)) IS TRUE))'),
    ('patch_resource_link_report', 'link_report_shape_check', 'CHECK ((((link_version > 0) AND (evidence_round >= 0) AND ((reason)::text = ANY ((ARRAY[''deleted''::character varying, ''access_condition''::character varying, ''unreachable''::character varying])::text[])) AND (weight = ANY (ARRAY[(0)::numeric, 0.5, (1)::numeric])) AND ((weight = (0)::numeric) OR ever_counted)) IS TRUE))'),
    ('patch_resource_link_history', 'link_history_shape_check', 'CHECK ((((from_version > 0) AND ((((reason)::text = ''health''::text) AND (old_content IS NULL) AND (old_storage IS NULL) AND (old_size IS NULL) AND (jsonb_typeof(health_transition) = ''object''::text) AND (health_event_key IS NOT NULL) AND ((health_event_key)::text = (((((((((''link:''::text || link_id) || '':v:''::text) || from_version) || '':r:''::text) || (health_transition #>> ''{from,evidenceRound}''::text[])) || '':''::text) || (health_transition #>> ''{from,health}''::text[])) || '':''::text) || (health_transition #>> ''{to,health}''::text[])))) OR (((reason)::text = ANY ((ARRAY[''relink''::character varying, ''edit''::character varying, ''remove''::character varying, ''merge''::character varying])::text[])) AND (old_content IS NOT NULL) AND (old_storage IS NOT NULL) AND (old_size IS NOT NULL) AND (health_transition IS NULL) AND (health_event_key IS NULL)))) IS TRUE))'),
    ('patch_resource_link_check', 'link_check_shape_check', 'CHECK ((((link_version > 0) AND (evidence_round >= 0) AND ((health)::text = ANY ((ARRAY[''ok''::character varying, ''suspect''::character varying, ''disputed''::character varying, ''broken''::character varying])::text[])) AND ((input_signature)::text ~ ''^[0-9a-f]{64}$''::text) AND (completed_at >= requested_at) AND ((((verdict)::text = ''available''::text) AND (provider IS NOT NULL) AND ((reason)::text = ''share_available''::text) AND (NOT failed) AND (checked_at IS NOT NULL)) OR (((verdict)::text = ''broken''::text) AND (provider IS NOT NULL) AND ((reason)::text = ANY ((ARRAY[''share_deleted''::character varying, ''share_cancelled''::character varying, ''share_expired''::character varying])::text[])) AND (NOT failed) AND (checked_at IS NOT NULL)) OR (((verdict)::text = ''unknown''::text) AND ((reason)::text = ANY ((ARRAY[''access_unverified''::character varying, ''unsupported''::character varying, ''rate_limited''::character varying, ''timeout''::character varying, ''unavailable''::character varying, ''invalid_response''::character varying, ''untrusted_result''::character varying])::text[])) AND ((failed AND (checked_at IS NULL)) OR ((NOT failed) AND (checked_at IS NOT NULL))))) AND ((provider IS NULL) OR ((provider)::text = ANY ((ARRAY[''baidu''::character varying, ''quark''::character varying, ''uc''::character varying, ''caiyun''::character varying, ''pan123''::character varying])::text[])))) IS TRUE))')
  ) AS shape(table_name,constraint_name,definition) LOOP
    SELECT contype,convalidated,pg_get_constraintdef(oid) AS definition INTO actual FROM pg_constraint WHERE conrelid=to_regclass('public.' || wanted.table_name) AND conname=wanted.constraint_name;
    IF NOT FOUND THEN
      IF true THEN RAISE EXCEPTION 'link health migration: missing CHECK %',wanted.constraint_name; END IF;
    ELSIF actual.contype <> 'c' OR NOT actual.convalidated OR wanted.definition IS NOT NULL AND actual.definition <> wanted.definition THEN
      RAISE EXCEPTION 'link health migration: incompatible CHECK %',wanted.constraint_name;
    END IF;
  END LOOP;
END
$check_shape$;
\if :initial_baseline
DO $initial_baseline$ BEGIN IF EXISTS (SELECT 1 FROM patch_resource_access WHERE link_version IS NOT NULL) OR EXISTS (SELECT 1 FROM patch_resource_link WHERE version<>1 OR evidence_round<>0 OR health<>'ok' OR health_changed_at IS NOT NULL OR verified_at IS NOT NULL OR content_changed_at IS NOT NULL) OR EXISTS (SELECT 1 FROM patch_resource_link_report) OR EXISTS (SELECT 1 FROM patch_resource_link_history) OR EXISTS (SELECT 1 FROM patch_resource_link_check) THEN RAISE EXCEPTION 'link health initial baseline failed: new writer facts already exist'; END IF; END $initial_baseline$;
\endif
SELECT 'link_health_postflight_ok' AS result;
COMMIT;
