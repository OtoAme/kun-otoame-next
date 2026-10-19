\set ON_ERROR_STOP on
-- Stop old writers before this additive, atomic and re-runnable sync.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
SET LOCAL TIME ZONE 'UTC';
DO $health_guard$ BEGIN
 IF to_regclass('public.patch_resource_link') IS NULL OR to_regclass('public.patch_resource_link_report') IS NULL OR to_regclass('public.ops_case') IS NULL THEN
  RAISE EXCEPTION 'link maintenance: install link-health and case baseline first';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patch_resource_link_check'::regclass AND conname='link_check_shape_check' AND convalidated AND pg_get_constraintdef(oid) LIKE '%share_blocked%') THEN
  RAISE EXCEPTION 'link maintenance: install the 2026-10-17 CHECK upgrade first';
 END IF;
END $health_guard$;
LOCK TABLE public.patch_resource IN SHARE MODE;
LOCK TABLE public.patch_resource_link IN SHARE MODE;
LOCK TABLE public.ops_case,public.ops_case_message,public.patch_resource_link_report IN SHARE MODE;
CREATE TABLE IF NOT EXISTS public."patch_resource_link_maintenance" (
  "id" SERIAL NOT NULL,
  "original_link_id" INTEGER NOT NULL,
  "link_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "latest_round" INTEGER NOT NULL DEFAULT 0,
  "frozen" BOOLEAN NOT NULL DEFAULT false,
  "stopped_at" TIMESTAMP(3),
  "stop_note" VARCHAR(1007) NOT NULL DEFAULT '',
  "patch_id" INTEGER NOT NULL,
  "link_id" INTEGER,
  "resource_id" INTEGER,
  "owner_id" INTEGER,
  "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patch_resource_link_maintenance_pkey" PRIMARY KEY (id),
  CONSTRAINT "patch_resource_link_maintenance_link_id_fkey" FOREIGN KEY (link_id) REFERENCES public."patch_resource_link"(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "patch_resource_link_maintenance_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public."user"(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "link_maintenance_shape_check" CHECK ((original_link_id>0 AND link_version>0 AND revision>=0 AND latest_round>=0 AND patch_id>0 AND (NOT frozen OR (stopped_at IS NOT NULL AND length(btrim(stop_note))>0))) IS TRUE)
);
CREATE UNIQUE INDEX IF NOT EXISTS "link_maintenance_target_key" ON public."patch_resource_link_maintenance" (original_link_id, link_version);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_link_id_idx" ON public."patch_resource_link_maintenance" (link_id);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_resource_id_idx" ON public."patch_resource_link_maintenance" (resource_id);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_owner_id_idx" ON public."patch_resource_link_maintenance" (owner_id);
CREATE TABLE IF NOT EXISTS public."patch_resource_link_maintenance_event" (
  "id" SERIAL NOT NULL,
  "control_id" INTEGER NOT NULL,
  "round" INTEGER NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "active_key" VARCHAR(64),
  "source" VARCHAR(16) NOT NULL DEFAULT 'report',
  "snoozed_until" TIMESTAMP(3),
  "publisher_notified_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "outcome" VARCHAR(16),
  "note" VARCHAR(1007) NOT NULL DEFAULT '',
  "result_notified_at" TIMESTAMP(3),
  "case_id" INTEGER,
  "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patch_resource_link_maintenance_event_pkey" PRIMARY KEY (id),
  CONSTRAINT "patch_resource_link_maintenance_event_control_id_fkey" FOREIGN KEY (control_id) REFERENCES public."patch_resource_link_maintenance"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "patch_resource_link_maintenance_event_case_id_fkey" FOREIGN KEY (case_id) REFERENCES public."ops_case"(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "link_maintenance_event_shape_check" CHECK ((round>0 AND source IN ('report','migrated') AND ((state='pending' AND active_key IS NOT NULL AND snoozed_until IS NULL AND responded_at IS NULL AND outcome IS NULL) OR (state='snoozed' AND active_key IS NOT NULL AND snoozed_until IS NOT NULL AND responded_at IS NULL AND outcome IS NULL) OR (state='handled' AND active_key IS NULL AND snoozed_until IS NULL AND responded_at IS NOT NULL AND outcome IN ('explained','verified','relinked','stopped','removed')))) IS TRUE)
);
CREATE UNIQUE INDEX IF NOT EXISTS "patch_resource_link_maintenance_event_active_key_key" ON public."patch_resource_link_maintenance_event" (active_key);
CREATE UNIQUE INDEX IF NOT EXISTS "link_maintenance_event_round_key" ON public."patch_resource_link_maintenance_event" (control_id, round);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_event_case_id_idx" ON public."patch_resource_link_maintenance_event" (case_id);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_event_state_snoozed_until_idx" ON public."patch_resource_link_maintenance_event" (state, snoozed_until);
CREATE TABLE IF NOT EXISTS public."patch_resource_link_maintenance_participant" (
  "event_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patch_resource_link_maintenance_participant_pkey" PRIMARY KEY (event_id,user_id),
  CONSTRAINT "patch_resource_link_maintenance_participant_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public."patch_resource_link_maintenance_event"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "patch_resource_link_maintenance_participant_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "patch_resource_link_maintenance_participant_user_id_idx" ON public."patch_resource_link_maintenance_participant" (user_id);
DO $shape$ DECLARE target oid := to_regclass('public.patch_resource_link_maintenance'); BEGIN
 IF target IS NULL THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=target AND relkind='r' AND NOT relispartition) OR
   (SELECT COUNT(*) FROM pg_attribute WHERE attrelid=target AND attnum>0 AND NOT attisdropped)<>14 OR EXISTS (
  SELECT 1 FROM (VALUES ('id','integer',true),('original_link_id','integer',true),('link_version','integer',true),('revision','integer',true),('latest_round','integer',true),('frozen','boolean',true),('stopped_at','timestamp(3) without time zone',false),('stop_note','character varying(1007)',true),('patch_id','integer',true),('link_id','integer',false),('resource_id','integer',false),('owner_id','integer',false),('created','timestamp(3) without time zone',true),('updated','timestamp(3) without time zone',true)) expected(name,typ,required)
  LEFT JOIN pg_attribute a ON a.attrelid=target AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.typ OR a.attnotnull<>expected.required
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible columns on patch_resource_link_maintenance'; END IF;
 IF EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=target AND a.attname='updated') THEN
  RAISE EXCEPTION 'link maintenance: updated must have no database default'; END IF;
END $shape$;
DO $shape$ DECLARE target oid := to_regclass('public.patch_resource_link_maintenance_event'); BEGIN
 IF target IS NULL THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=target AND relkind='r' AND NOT relispartition) OR
   (SELECT COUNT(*) FROM pg_attribute WHERE attrelid=target AND attnum>0 AND NOT attisdropped)<>15 OR EXISTS (
  SELECT 1 FROM (VALUES ('id','integer',true),('control_id','integer',true),('round','integer',true),('state','character varying(16)',true),('active_key','character varying(64)',false),('source','character varying(16)',true),('snoozed_until','timestamp(3) without time zone',false),('publisher_notified_at','timestamp(3) without time zone',false),('responded_at','timestamp(3) without time zone',false),('outcome','character varying(16)',false),('note','character varying(1007)',true),('result_notified_at','timestamp(3) without time zone',false),('case_id','integer',false),('created','timestamp(3) without time zone',true),('updated','timestamp(3) without time zone',true)) expected(name,typ,required)
  LEFT JOIN pg_attribute a ON a.attrelid=target AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.typ OR a.attnotnull<>expected.required
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible columns on patch_resource_link_maintenance_event'; END IF;
 IF EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=target AND a.attname='updated') THEN
  RAISE EXCEPTION 'link maintenance: updated must have no database default'; END IF;
END $shape$;
DO $shape$ DECLARE target oid := to_regclass('public.patch_resource_link_maintenance_participant'); BEGIN
 IF target IS NULL THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=target AND relkind='r' AND NOT relispartition) OR
   (SELECT COUNT(*) FROM pg_attribute WHERE attrelid=target AND attnum>0 AND NOT attisdropped)<>3 OR EXISTS (
  SELECT 1 FROM (VALUES ('event_id','integer',true),('user_id','integer',true),('created','timestamp(3) without time zone',true)) expected(name,typ,required)
  LEFT JOIN pg_attribute a ON a.attrelid=target AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.typ OR a.attnotnull<>expected.required
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible columns on patch_resource_link_maintenance_participant'; END IF;
 IF EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=target AND a.attname='updated') THEN
  RAISE EXCEPTION 'link maintenance: updated must have no database default'; END IF;
END $shape$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance'::regclass AND n.relname='patch_resource_link_maintenance_pkey' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_pkey'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance'::regclass AND n.relname='link_maintenance_target_key' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['original_link_id','link_version']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index link_maintenance_target_key'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance'::regclass AND n.relname='patch_resource_link_maintenance_link_id_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['link_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_link_id_idx'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance'::regclass AND n.relname='patch_resource_link_maintenance_resource_id_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['resource_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_resource_id_idx'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance'::regclass AND n.relname='patch_resource_link_maintenance_owner_id_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['owner_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_owner_id_idx'; END IF; END $index$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance'::regclass AND c.conname='patch_resource_link_maintenance_link_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."patch_resource_link"'::regclass AND c.confdeltype='n' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='link_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance.link_id'; END IF; END $fk$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance'::regclass AND c.conname='patch_resource_link_maintenance_owner_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."user"'::regclass AND c.confdeltype='n' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='owner_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance.owner_id'; END IF; END $fk$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_event'::regclass AND n.relname='patch_resource_link_maintenance_event_pkey' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_event_pkey'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_event'::regclass AND n.relname='patch_resource_link_maintenance_event_active_key_key' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['active_key']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_event_active_key_key'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_event'::regclass AND n.relname='link_maintenance_event_round_key' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['control_id','round']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index link_maintenance_event_round_key'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_event'::regclass AND n.relname='patch_resource_link_maintenance_event_case_id_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['case_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_event_case_id_idx'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_event'::regclass AND n.relname='patch_resource_link_maintenance_event_state_snoozed_until_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['state','snoozed_until']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_event_state_snoozed_until_idx'; END IF; END $index$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance_event'::regclass AND c.conname='patch_resource_link_maintenance_event_control_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."patch_resource_link_maintenance"'::regclass AND c.confdeltype='c' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='control_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance_event.control_id'; END IF; END $fk$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance_event'::regclass AND c.conname='patch_resource_link_maintenance_event_case_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."ops_case"'::regclass AND c.confdeltype='n' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='case_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance_event.case_id'; END IF; END $fk$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_participant'::regclass AND n.relname='patch_resource_link_maintenance_participant_pkey' AND i.indisunique=true
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['event_id','user_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_participant_pkey'; END IF; END $index$;
DO $index$ BEGIN IF NOT EXISTS (
 SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
 WHERE i.indrelid='public.patch_resource_link_maintenance_participant'::regclass AND n.relname='patch_resource_link_maintenance_participant_user_id_idx' AND i.indisunique=false
 AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
 AND NOT i.indnullsnotdistinct AND (SELECT array_agg(a.attname::text ORDER BY ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['user_id']::text[]
 ) THEN RAISE EXCEPTION 'link maintenance: incompatible index patch_resource_link_maintenance_participant_user_id_idx'; END IF; END $index$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance_participant'::regclass AND c.conname='patch_resource_link_maintenance_participant_event_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."patch_resource_link_maintenance_event"'::regclass AND c.confdeltype='c' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='event_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance_participant.event_id'; END IF; END $fk$;
DO $fk$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c
 WHERE c.conrelid='public.patch_resource_link_maintenance_participant'::regclass AND c.conname='patch_resource_link_maintenance_participant_user_id_fkey' AND c.contype='f' AND c.convalidated
 AND c.confrelid='public."user"'::regclass AND c.confdeltype='c' AND c.confupdtype='a'
 AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='user_id')]::smallint[]
 AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[])
 THEN RAISE EXCEPTION 'link maintenance: incompatible foreign key patch_resource_link_maintenance_participant.user_id'; END IF; END $fk$;
WITH candidates AS (
 SELECT c.id AS case_id,c.created,c.target_id,l.version,l.resource_id,r.patch_id,r.user_id,ctx.context,
  (jsonb_typeof(ctx.context)='object'
   AND (SELECT COUNT(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(ctx.context)='object' THEN ctx.context ELSE '{}'::jsonb END))=8
   AND ctx.context->'source'='"user_reports"'::jsonb AND ctx.context->'health'='"suspect"'::jsonb
   AND ctx.context->'linkId'=to_jsonb(l.id) AND ctx.context->'linkVersion'=to_jsonb(l.version)
   AND ctx.context->'resourceId'=to_jsonb(l.resource_id) AND ctx.context->'patchId'=to_jsonb(r.patch_id)
   AND ctx.context->'evidenceRound'=to_jsonb(l.evidence_round) AND l.health='suspect'
   AND l.health_changed_at IS NOT NULL AND ctx.context->>'healthChangedAt'=to_char(l.health_changed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) IS TRUE AS valid_context,
  EXISTS (SELECT 1 FROM patch_resource_link_report report WHERE report.link_id=l.id AND report.link_version=l.version
    AND report.ever_counted=true AND report.weight>0) AS has_counted_report
 FROM ops_case c JOIN patch_resource_link l ON l.id=c.target_id
 JOIN patch_resource r ON r.id=l.resource_id
 LEFT JOIN LATERAL (SELECT payload->'link_health' AS context FROM ops_case_message
   WHERE case_id=c.id AND kind='system' AND payload ? 'link_health' ORDER BY created DESC,id DESC LIMIT 1) ctx ON true
 WHERE c.target_type='link' AND c.kind='link_suspect' AND c.source='system' AND c.reporter_id IS NULL
  AND c.owner_type='publisher' AND c.owner_id=r.user_id AND c.first_owner_response_at IS NULL
  AND c.status IN ('open','waiting_owner','waiting_reporter') AND l.storage<>'touchgal'
  AND c.patch_id=r.patch_id AND c.dedup_key='link:'||l.id||':v:'||l.version
), eligible AS (SELECT * FROM candidates WHERE valid_context AND has_counted_report)
, inserted_controls AS (
 INSERT INTO patch_resource_link_maintenance (original_link_id,link_version,revision,latest_round,patch_id,link_id,resource_id,owner_id,created,updated)
 SELECT target_id,version,1,1,patch_id,target_id,resource_id,user_id,created,CURRENT_TIMESTAMP FROM eligible
 ON CONFLICT (original_link_id,link_version) DO NOTHING RETURNING id,original_link_id,link_version
), inserted_events AS (
 INSERT INTO patch_resource_link_maintenance_event (control_id,round,state,active_key,source,case_id,created,updated)
 SELECT m.id,1,'pending','maintenance:'||m.id,'migrated',e.case_id,e.created,CURRENT_TIMESTAMP
 FROM inserted_controls m JOIN eligible e ON e.target_id=m.original_link_id AND e.version=m.link_version
 RETURNING id,control_id
)
INSERT INTO patch_resource_link_maintenance_participant (event_id,user_id,created)
SELECT DISTINCT e.id,report.user_id,CURRENT_TIMESTAMP FROM inserted_events e
 JOIN inserted_controls m ON m.id=e.control_id
 JOIN patch_resource_link_report report ON report.link_id=m.original_link_id AND report.link_version=m.link_version
 WHERE report.ever_counted=true AND report.weight>0
ON CONFLICT (event_id,user_id) DO NOTHING;
COMMIT;
