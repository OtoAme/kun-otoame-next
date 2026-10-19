\set ON_ERROR_STOP on
-- Read-only inventory; invalid latest contexts retain their original case entry.
BEGIN TRANSACTION READ ONLY;
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
SELECT COUNT(*) AS candidate_count, COUNT(*) FILTER (WHERE NOT valid_context) AS invalid_latest_context, COUNT(*) FILTER (WHERE valid_context AND has_counted_report) AS eligible_count FROM candidates;
COMMIT;
