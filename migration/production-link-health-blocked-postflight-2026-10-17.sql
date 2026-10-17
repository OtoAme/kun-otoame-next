-- Incremental CHECK upgrade after the 2026-10-09 link-health baseline trio.
-- Existing installations run only this 2026-10-17 preflight/sync/postflight trio.
-- After this upgrade, use this postflight for the CHECK definition.
\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

DO $link_health_blocked$
DECLARE
  target_oid oid;
  actual record;
  old_definition CONSTANT text := $old_check$CHECK ((((link_version > 0) AND (evidence_round >= 0) AND ((health)::text = ANY ((ARRAY['ok'::character varying, 'suspect'::character varying, 'disputed'::character varying, 'broken'::character varying])::text[])) AND ((input_signature)::text ~ '^[0-9a-f]{64}$'::text) AND (completed_at >= requested_at) AND ((((verdict)::text = 'available'::text) AND (provider IS NOT NULL) AND ((reason)::text = 'share_available'::text) AND (NOT failed) AND (checked_at IS NOT NULL)) OR (((verdict)::text = 'broken'::text) AND (provider IS NOT NULL) AND ((reason)::text = ANY ((ARRAY['share_deleted'::character varying, 'share_cancelled'::character varying, 'share_expired'::character varying])::text[])) AND (NOT failed) AND (checked_at IS NOT NULL)) OR (((verdict)::text = 'unknown'::text) AND ((reason)::text = ANY ((ARRAY['access_unverified'::character varying, 'unsupported'::character varying, 'rate_limited'::character varying, 'timeout'::character varying, 'unavailable'::character varying, 'invalid_response'::character varying, 'untrusted_result'::character varying])::text[])) AND ((failed AND (checked_at IS NULL)) OR ((NOT failed) AND (checked_at IS NOT NULL))))) AND ((provider IS NULL) OR ((provider)::text = ANY ((ARRAY['baidu'::character varying, 'quark'::character varying, 'uc'::character varying, 'caiyun'::character varying, 'pan123'::character varying])::text[])))) IS TRUE))$old_check$;
  new_definition CONSTANT text := replace(old_definition,
    $old_reason$'share_expired'::character varying]$old_reason$,
    $new_reason$'share_expired'::character varying, 'share_blocked'::character varying]$new_reason$);
BEGIN
  target_oid := to_regclass('public.patch_resource_link_check');
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'link health blocked migration: missing table public.patch_resource_link_check; apply the 2026-10-09 baseline first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = target_oid AND relkind = 'r' AND NOT relispartition) THEN
    RAISE EXCEPTION 'link health blocked migration: incompatible table public.patch_resource_link_check';
  END IF;
  SELECT contype, convalidated, conenforced, connoinherit, condeferrable,
         condeferred, conislocal, coninhcount, conparentid,
         pg_get_constraintdef(oid, false) AS definition
  INTO actual
  FROM pg_constraint
  WHERE conrelid = target_oid AND conname = 'link_check_shape_check';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link health blocked migration: missing CHECK link_check_shape_check';
  END IF;
  IF actual.contype <> 'c' OR NOT actual.convalidated OR NOT actual.conenforced
     OR actual.connoinherit OR actual.condeferrable OR actual.condeferred
     OR NOT actual.conislocal OR actual.coninhcount <> 0 OR actual.conparentid <> 0
     OR actual.definition IS DISTINCT FROM new_definition THEN
    RAISE EXCEPTION 'link health blocked migration: incompatible CHECK link_check_shape_check';
  END IF;
  RAISE NOTICE 'link health blocked migration: postflight passed';
END
$link_health_blocked$;
COMMIT;
