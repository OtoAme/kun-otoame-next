/**
 * Module 06 aggregate audit. Never changes database data or calls application
 * services. Run --inspect-target first; --run requires an explicit fingerprint,
 * source kind supplied by the operator. Dump freshness may be explicitly
 * unverified. No production fallback; container mode never loads dotenv.
 *
 * node scripts/officialMirrorDataAudit.ts --inspect-target
 * node scripts/officialMirrorDataAudit.ts --sql
 * node scripts/officialMirrorDataAudit.ts --run --confirm-target=<fingerprint>
 *   --source-kind=live|verified-snapshot --source-as-of=<ISO instant>
 *   --out=.deploy/module06-data-audit/report.json
 * Container mode: --container=<existing-container> --database=otoame_prod_dump
 *   --source-kind=existing-dump --source-as-of=unverified
 * Uses the existing container-local database role without reading credentials.
 *
 * A successful query is not deployment approval. An existing fill manifest is
 * recorded evidence of a decision, not proof of the original migration source.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import dotenv from 'dotenv'
import pg from 'pg'

const root = realpathSync(process.cwd())
const args = process.argv.slice(2)
const flag = (name: string) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const inRoot = (path: string) => {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const sourceFiles = [
  'lib/officialMirror/decide.ts',
  'lib/officialMirror/rows.ts',
  'lib/officialMirror/mergeService.ts',
  'migration/migratePatchResourceLinks.ts',
  'migration/production-official-mirror-preflight-2026-11-04.sql',
  'migration/production-official-mirror-sync-2026-11-04.sql',
  'migration/production-official-mirror-postflight-2026-11-04.sql'
]
const source = () => ({
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files: Object.fromEntries(sourceFiles.map((path) => [path, hash(readFileSync(resolve(root, path), 'utf8'))]))
})
const whitespace = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`
const utf16Length = (text: string) => String.raw`(char_length(${text}) + char_length(regexp_replace(${text}, U&'[^\+010000-\+10FFFF]', '', 'g')))`
const emptyRecords = `SELECT NULL::integer user_resource_id, NULL::integer staff_resource_id,
  NULL::text status WHERE false`

const candidatesSql = (hasHandover: boolean, hasRecords: boolean, hasCases: boolean) => `
WITH records AS (
  ${hasRecords ? `SELECT user_resource_id, staff_resource_id, status FROM public.patch_resource_merge_record
    WHERE status IN ('merged','dismissed')` : emptyRecords}
), survivors AS (SELECT DISTINCT user_resource_id id FROM records WHERE status='merged'),
link_facts AS (
  SELECT resource_id, count(*) AS links,
    count(*) FILTER (WHERE storage='user') AS external_links,
    count(*) FILTER (WHERE storage <> 'touchgal') AS non_touchgal_links
  FROM public.patch_resource_link GROUP BY resource_id
), cards AS (
  SELECT r.id, r.patch_id, r.section, r.status, r.created, r.note,
    r.type, r.language, r.platform, u.role, p.status AS patch_status,
    ${hasHandover ? 'r.publisher_left_at' : 'NULL::timestamp'} AS publisher_left_at,
    coalesce(l.links,0) links, coalesce(l.external_links,0) external_links,
    coalesce(l.non_touchgal_links,0) non_touchgal_links,
    EXISTS(SELECT 1 FROM survivors s WHERE s.id=r.id) AS survivor
  FROM public.patch_resource r
  JOIN public."user" u ON u.id=r.user_id JOIN public.patch p ON p.id=r.patch_id
  LEFT JOIN link_facts l ON l.resource_id=r.id
), users AS (
  SELECT * FROM cards WHERE role<=2 AND status=0 AND external_links>0
    AND publisher_left_at IS NULL AND section IN ('galgame','patch') AND NOT survivor
), staff AS (
  SELECT * FROM cards WHERE role>=3 AND section IN ('galgame','patch') AND NOT survivor
), raw_pairs AS (
  SELECT u.id user_id,s.id staff_id,u.section FROM users u JOIN staff s
    ON s.patch_id=u.patch_id AND s.section=u.section
), pairs AS (
  SELECT p.*,
    count(*) OVER (PARTITION BY p.user_id) user_candidates,
    count(*) OVER (PARTITION BY p.staff_id) staff_candidates
  FROM raw_pairs p WHERE NOT EXISTS (
    SELECT 1 FROM records r WHERE r.user_resource_id=p.user_id AND r.staff_resource_id=p.staff_id
  )
), assessed AS (
  SELECT p.*,s.status staff_status,
    s.status=0 AND s.created>u.created AND p.user_candidates=1 AND p.staff_candidates=1
      AND ARRAY(SELECT v FROM unnest(u.type) v WHERE v IS NOT NULL ORDER BY v COLLATE "C")=ARRAY(SELECT v FROM unnest(s.type) v WHERE v IS NOT NULL ORDER BY v COLLATE "C")
      AND ARRAY(SELECT v FROM unnest(u.language) v WHERE v IS NOT NULL ORDER BY v COLLATE "C")=ARRAY(SELECT v FROM unnest(s.language) v WHERE v IS NOT NULL ORDER BY v COLLATE "C")
      AND ARRAY(SELECT v FROM unnest(u.platform) v WHERE v IS NOT NULL ORDER BY v COLLATE "C")=ARRAY(SELECT v FROM unnest(s.platform) v WHERE v IS NOT NULL ORDER BY v COLLATE "C") AS high,
    s.status<>0 AS staff_not_public,
    s.patch_status<>0 OR u.patch_status<>0 AS game_not_public,
    s.non_touchgal_links>0 AS staff_link_not_touchgal,
    ${hasCases ? `EXISTS(SELECT 1 FROM public.ops_case c
      WHERE c.status IN ('open','waiting_reporter','waiting_owner') AND (
        (c.target_type='resource' AND c.target_id=s.id) OR
        (c.target_type='link' AND EXISTS(SELECT 1 FROM public.patch_resource_link l
          WHERE l.resource_id=s.id AND l.id=c.target_id))))` : 'NULL::boolean'} AS staff_case_open,
    ${utf16Length(`CASE WHEN btrim(s.note,${whitespace})='' OR position(btrim(s.note,${whitespace}) IN u.note)>0
      THEN u.note ELSE u.note || CASE WHEN u.note<>'' THEN E'\\n\\n' ELSE '' END || '站方备份说明：' || btrim(s.note,${whitespace}) END`)} >10007 AS note_too_long
  FROM pairs p JOIN users u ON u.id=p.user_id JOIN staff s ON s.id=p.staff_id
), classified AS (
  SELECT *,NOT(staff_not_public OR game_not_public OR staff_link_not_touchgal
    OR coalesce(staff_case_open,true) OR note_too_long) AS no_current_blocks,
    (staff_not_public OR game_not_public OR staff_link_not_touchgal
    OR coalesce(staff_case_open,false) OR note_too_long) AS has_known_block,
    staff_case_open IS NULL AS case_check_unknown FROM assessed
)
SELECT jsonb_build_object(
 'eligible_user_cards',(SELECT count(*) FROM users),
 'eligible_staff_cards_all_statuses',(SELECT count(*) FROM staff),
 'raw_pairs_before_record_exclusion',(SELECT count(*) FROM raw_pairs),
 'excluded_recorded_pairs',(SELECT count(*) FROM raw_pairs p WHERE EXISTS (
    SELECT 1 FROM records r WHERE r.user_resource_id=p.user_id AND r.staff_resource_id=p.staff_id)),
 'excluded_dismissed_pairs',(SELECT count(*) FROM raw_pairs p WHERE EXISTS (
    SELECT 1 FROM records r WHERE r.status='dismissed' AND r.user_resource_id=p.user_id AND r.staff_resource_id=p.staff_id)),
 'excluded_merged_pairs',(SELECT count(*) FROM raw_pairs p WHERE EXISTS (
    SELECT 1 FROM records r WHERE r.status='merged' AND r.user_resource_id=p.user_id AND r.staff_resource_id=p.staff_id)),
 'survivor_cards_excluded_both_sides',(SELECT count(*) FROM cards WHERE survivor),
 'user_survivors_excluded',(SELECT count(*) FROM cards WHERE survivor AND role<=2),
 'staff_survivors_excluded',(SELECT count(*) FROM cards WHERE survivor AND role>=3),
 'user_cards_nonpublic_excluded',(SELECT count(*) FROM cards WHERE role<=2 AND status<>0),
 'user_cards_handed_over_excluded',(SELECT count(*) FROM cards WHERE role<=2 AND publisher_left_at IS NOT NULL),
 'user_cards_without_external_excluded',(SELECT count(*) FROM cards WHERE role<=2 AND external_links=0),
 'cards_invalid_section_excluded',(SELECT count(*) FROM cards WHERE section NOT IN ('galgame','patch')),
 'candidate_user_cards',(SELECT count(DISTINCT user_id) FROM classified),
 'candidate_staff_cards',(SELECT count(DISTINCT staff_id) FROM classified),
 'candidate_pairs',(SELECT count(*) FROM classified),
 'high_confidence_pairs',(SELECT count(*) FROM classified WHERE high),
 'manual_pairs',(SELECT count(*) FROM classified WHERE NOT high),
 'manual_staff_cards',(SELECT count(DISTINCT staff_id) FROM classified WHERE NOT high),
 'manual_staff_cards_with_non_touchgal',(SELECT count(DISTINCT staff_id) FROM classified WHERE NOT high AND staff_link_not_touchgal),
 'by_class_section_status',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT CASE WHEN high THEN 'high' ELSE 'manual' END AS pair_class,section,staff_status,
     count(*) pairs,count(DISTINCT user_id) user_cards,count(DISTINCT staff_id) staff_cards,
     count(*) FILTER (WHERE no_current_blocks) proven_no_current_blocks,
     count(*) FILTER (WHERE has_known_block) known_blocked_pairs,
     count(DISTINCT staff_id) FILTER (WHERE has_known_block) known_blocked_staff_cards,
     count(*) FILTER (WHERE case_check_unknown) case_check_unknown_pairs,
     count(*) FILTER (WHERE staff_not_public) staff_not_public,
     count(*) FILTER (WHERE game_not_public) game_not_public,
     count(*) FILTER (WHERE staff_link_not_touchgal) staff_link_not_touchgal,
     CASE WHEN bool_or(case_check_unknown) THEN NULL::bigint
       ELSE count(*) FILTER (WHERE staff_case_open) END staff_case_open,
     count(*) FILTER (WHERE note_too_long) note_too_long
   FROM classified GROUP BY high,section,staff_status ORDER BY high DESC,section,staff_status
 ) x),
 'manual_staff_link_storage',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT CASE WHEN l.storage IN ('touchgal','user','s3') THEN l.storage ELSE 'other' END storage,
     count(*) links,count(DISTINCT l.resource_id) staff_cards
   FROM public.patch_resource_link l JOIN (SELECT DISTINCT staff_id FROM classified WHERE NOT high) m
     ON m.staff_id=l.resource_id GROUP BY 1 ORDER BY 1
 ) x),
 'card_counts_by_role_section_status',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT CASE WHEN role<=2 THEN 'user' ELSE 'staff' END author_class,section,status,
     count(*) cards FROM cards GROUP BY 1,section,status ORDER BY 1,section,status
 ) x),
 'record_counts',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT status,count(*) records FROM records GROUP BY status ORDER BY status) x)
) AS aggregates`

const createdGroupsSql = (hasAttached: boolean) => `
SELECT to_char(l.created,'YYYY-MM-DD HH24:MI:SS.MS') AS link_created,
 count(*)::bigint link_count,count(*)>50 stamp_candidate,
 CASE WHEN count(*)>50 THEN 'suspected_source_unverified' ELSE 'source_evidence_insufficient' END provenance,
 count(DISTINCT l.resource_id) resource_count,
 min(r.created)::text earliest_resource_created,max(r.created)::text latest_resource_created,
 count(*) FILTER (WHERE l.created>r.created)::bigint link_created_after_resource,
 count(*) FILTER (WHERE l.created=r.created)::bigint link_created_equal_resource,
 count(*) FILTER (WHERE l.created<r.created)::bigint link_created_before_resource,
 count(*) FILTER (WHERE r.id IS NULL)::bigint orphan_links,
 count(*) FILTER (WHERE l.storage='touchgal')::bigint touchgal_links,
 count(*) FILTER (WHERE l.storage='user')::bigint external_links,
 count(*) FILTER (WHERE l.storage='s3')::bigint s3_links,
 count(*) FILTER (WHERE l.storage NOT IN ('touchgal','user','s3'))::bigint other_storage_links,
 count(*) FILTER (WHERE l.created=l.updated)::bigint created_equals_updated,
 ${hasAttached ? `count(*) FILTER (WHERE l.attached_at IS NULL)` : 'count(*)'}::bigint needs_fill,
 ${hasAttached ? `count(*) FILTER (WHERE l.attached_at IS NOT NULL)` : '0'}::bigint already_nonnull
FROM public.patch_resource_link l LEFT JOIN public.patch_resource r ON r.id=l.resource_id
GROUP BY l.created ORDER BY count(*) DESC,l.created`

const catalogSql = `SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,
 datetime_precision,character_maximum_length FROM information_schema.columns
 WHERE table_schema='public' AND (
 (table_name='patch_resource' AND column_name IN ('publisher_left_at')) OR
 (table_name='patch_resource_link' AND column_name IN ('attached_at','click')) OR
 table_name IN ('patch_resource_backup_state','patch_resource_merge_record',
 'patch_resource_file_cleanup','patch_resource_link_attached_at_fill')) ORDER BY table_name,ordinal_position`
const tablesSql = `SELECT required.name,
 to_regclass('public.' || required.name) IS NOT NULL AS present FROM (VALUES
 ('patch_resource'),('patch_resource_link'),('patch'),('user'),('ops_case'),
 ('patch_resource_backup_state'),('patch_resource_merge_record'),
 ('patch_resource_file_cleanup'),('patch_resource_link_attached_at_fill')) required(name)`
const casesSql = `WITH wanted(kind) AS (VALUES ('takedown_request'),('mirror_version_check'))
 SELECT w.kind,count(c.id)::bigint total,
 count(c.id) FILTER (WHERE c.status IN ('open','waiting_reporter','waiting_owner'))::bigint open,
 count(c.id) FILTER (WHERE c.status IN ('resolved','rejected','merged'))::bigint historical_closed,
 count(c.id) FILTER (WHERE c.status NOT IN ('open','waiting_reporter','waiting_owner','resolved','rejected','merged'))::bigint other_status,
 min(c.created)::text earliest_created,max(c.updated)::text latest_updated,
 CASE WHEN count(c.id)=0 THEN 'may_enter_reviewed_type_cleanup_after_fresh_recheck'
 ELSE 'retain_type_and_history_no_automatic_cleanup' END disposition
 FROM wanted w LEFT JOIN public.ops_case c ON c.kind=w.kind GROUP BY w.kind ORDER BY w.kind`
const fillSql = `SELECT f.fill_source,count(*)::bigint manifest_rows,
 count(*) FILTER (WHERE l.id IS NULL)::bigint missing_links,
 count(*) FILTER (WHERE l.attached_at IS DISTINCT FROM f.filled_value)::bigint current_value_differs,
 count(*) FILTER (WHERE f.fill_source='resource_created' AND f.filled_value IS DISTINCT FROM f.resource_created)::bigint incorrect_resource_formula,
 count(*) FILTER (WHERE f.fill_source='greatest' AND f.filled_value IS DISTINCT FROM greatest(f.link_created,f.resource_created))::bigint incorrect_greatest_formula,
 count(*) FILTER (WHERE f.fill_source NOT IN ('resource_created','greatest'))::bigint unknown_fill_source,
 min(f.created)::text earliest_manifest_created,max(f.created)::text latest_manifest_created
 FROM public.patch_resource_link_attached_at_fill f LEFT JOIN public.patch_resource_link l ON l.id=f.link_id
 GROUP BY f.fill_source ORDER BY f.fill_source`
const freshnessSql = `SELECT count(*)::bigint resources,min(created)::text earliest_created,
 max(created)::text latest_created,max(updated)::text latest_updated FROM public.patch_resource`
const postflightPath = sourceFiles[6]
const postflightSql = () => readFileSync(resolve(root, postflightPath), 'utf8')
  .replace(/^\\set .*$/gm, '').replace(/^BEGIN TRANSACTION READ ONLY;\s*$/gm, '')
  .replace(/^COMMIT;\s*$/gm, '')

const rules = {
  candidates: 'Current author role <=2 vs >=3; galgame/patch; same patch and section; user status=0, storage=user exists, no handover; staff status unrestricted; survivors excluded both sides; dismissed/merged pairs excluded before reciprocal uniqueness.',
  high: 'Staff status=0, staff.created strictly later, type/language/platform equal as sorted multisets, reciprocal unique; priority only, never proof of same content.',
  blocks: 'Missing ops_case leaves case clearance unknown, never zero or merge permission. Staff/game nonpublic, staff non-touchgal link, open resource/link case, merged note >10007 UTF-16 code units. Counts overlap. Same-content confirmation and preview basis remain mandatory.',
  timestamps: 'All created groups including <=50; >50 is suspected only. Link split code writes CURRENT_TIMESTAMP in one transaction, but does not prove any observed group originated there. No confirmed/rejected migration lists are generated.',
  manifest: 'Existing fill_source records are prior recorded decisions; formulas can be checked, origin still needs reviewed migration logs and target/snapshot provenance.',
  missingModuleColumns: 'For pre-migration inventory only, absent publisher_left_at means no handover and absent merge table means no prior module records; absence fails deployment readiness.',
  cases: 'Count both kinds across every status including closed history. Any record means preserve type/history; zero permits only reviewed cleanup after fresh target recheck.',
  privacy: 'No link content, extraction/password, object keys, profiles, sessions or case dialogue selected/output. Output contains aggregates, schema metadata and timestamps only.'
}

type AuditTarget = {
  url: URL | null
  container?: { id: string; database: string }
  public: {
    configured: boolean
    targetFingerprint?: string
    appearsSynthetic?: boolean
    [key: string]: unknown
  }
}

/** One psql session with JSON-only rows and explicit error markers. */
class ContainerReadOnlyClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending: {
    token: string; rows: string[]; error?: string
    resolve: (value: { rows: Record<string, unknown>[] }) => void
    reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>
  } | null = null
  private buffer = ''
  private sequence = 0
  private readonly target: { id: string; database: string }
  constructor(target: { id: string; database: string }) { this.target = target }
  async connect() {
    this.child = spawn('docker', [
      'exec', '-i', '-u', 'postgres', this.target.id,
      'sh', '-c', 'exec psql -X -w -q -A -t -U "${POSTGRES_USER:?database_role_metadata_unavailable}" -d "$1" --set=ON_ERROR_STOP=off --set=VERBOSITY=sqlstate',
      'official-mirror-audit', this.target.database
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, '')
        this.buffer = this.buffer.slice(newline + 1)
        const pending = this.pending
        if (!pending) continue
        if (line === pending.token + '_END') {
          clearTimeout(pending.timer)
          this.pending = null
          if (pending.error) {
            pending.reject(Object.assign(new Error('container_query_failed'), { code: pending.error }))
          } else {
            try { pending.resolve({ rows: pending.rows.filter(Boolean).map((row) => JSON.parse(row)) }) }
            catch { pending.reject(new Error('container_result_protocol_failed')) }
          }
        } else if (line.startsWith(pending.token + '_ERROR ')) {
          const code = line.slice((pending.token + '_ERROR ').length).trim()
          pending.error = /^[A-Z0-9]{5}$/.test(code) ? code : 'container_query_failed'
        } else if (line.trim()) pending.rows.push(line)
      }
    })
    // psql reports server errors as SQLSTATE through the stdout protocol. Never
    // echo raw stderr: authentication/connection errors may contain private data.
    this.child.stderr.resume()
    this.child.on('error', () => this.rejectPending('container_process_failed'))
    this.child.on('close', () => this.rejectPending('container_connection_closed'))
  }
  private rejectPending(reason: string) {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(new Error(reason))
    this.pending = null
  }
  async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    if (!this.child || this.child.exitCode !== null) throw new Error('container_not_connected')
    if (this.pending) throw new Error('concurrent_container_query_refused')
    const token = `__om_audit_${process.pid}_${++this.sequence}__`
    const statement = sql.replace(/^--[^\n]*$/gm, '').trim().replace(/;\s*$/, '')
    const command = /^(SELECT|WITH)\b/i.test(statement)
      ? `SELECT row_to_json(_audit_row)::text FROM (${statement}) _audit_row;`
      : `${statement};`
    return new Promise((resolveQuery, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending('container_query_timeout')
        this.child?.kill('SIGTERM')
      }, 35000)
      this.pending = { token, rows: [], resolve: resolveQuery, reject, timer }
      this.child!.stdin.write(`${command}\n\\if :ERROR\n\\echo ${token}_ERROR :SQLSTATE\n\\endif\n\\echo ${token}_END\n`)
    })
  }
  async end() {
    this.rejectPending('container_session_ended')
    this.child?.stdin.end('\\q\n')
  }
}

const inspectTarget = (): AuditTarget => {
  const containerName = flag('container')
  const database = flag('database')
  if (containerName || database) {
    if (!containerName || !database || !/^[A-Za-z0-9_.-]+$/.test(containerName) || !/^[A-Za-z0-9_-]+$/.test(database)) {
      throw new Error('explicit_container_and_database_required')
    }
    let metadata: { id: string; image: string; created: string; started: string; running: boolean }
    try {
      metadata = JSON.parse(execFileSync('docker', ['inspect', '--format',
        '{"id":"{{.Id}}","image":"{{.Config.Image}}","created":"{{.Created}}","started":"{{.State.StartedAt}}","running":{{.State.Running}}}',
        containerName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    } catch { throw new Error('container_metadata_unavailable') }
    if (!metadata.running || !/^[0-9a-f]{64}$/.test(metadata.id)) throw new Error('existing_running_container_required')
    return { url: null, container: { id: metadata.id, database }, public: {
      configured: true, configurationSource: 'container_local_identity',
      targetFingerprint: hash(`${metadata.id}:${database}`).slice(0,16),
      database, containerId: metadata.id.slice(0,12), image: metadata.image,
      containerCreated: metadata.created, containerStarted: metadata.started,
      hostClass: 'existing_local_container',
      appearsSynthetic: /(?:^|[_-])(e2e|test|synthetic)(?:$|[_-])/i.test(database)
    } }
  }

  const processConfigured = Boolean(process.env.KUN_DATABASE_URL)
  const envPath = resolve(root, '.env')
  if (existsSync(envPath)) {
    if (lstatSync(envPath).isSymbolicLink()) throw new Error('dotenv_symlink_refused')
    dotenv.config({ path: envPath, quiet: true })
  }
  const raw = process.env.KUN_DATABASE_URL
  if (!raw) return { public: { configured: false, dotenvPresent: existsSync(envPath) }, url: null }
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('invalid_database_url') }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('invalid_database_protocol')
  const identity = `${url.hostname}:${url.port || '5432'}${url.pathname}`
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  return { url, public: {
    configured: true, configurationSource: processConfigured ? 'process' : 'workspace_dotenv',
    targetFingerprint: hash(identity).slice(0, 16),
    hostClass: ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? 'loopback' : 'remote',
    port: url.port || '5432',
    appearsSynthetic: /(?:^|[_-])(e2e|test|synthetic)(?:$|[_-])/i.test(databaseName)
  } }
}

const save = (report: unknown) => {
  const output = flag('out')
  if (!output) return
  const path = resolve(root, output)
  if (!inRoot(path) || !relative(root,path).startsWith(`.deploy${sep}module06-data-audit${sep}`)) {
    throw new Error('out_must_be_under_ignored_.deploy/module06-data-audit')
  }
  // Reject symlinked parents, including existing directory ancestors.
  let cursor = dirname(path)
  while (cursor !== root) {
    if (existsSync(cursor) && (lstatSync(cursor).isSymbolicLink() || !inRoot(realpathSync(cursor)))) {
      throw new Error('output_symlink_refused')
    }
    cursor = dirname(cursor)
  }
  if (existsSync(path)) throw new Error('output_already_exists')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(report,null,2) + '\n', { mode: 0o600, flag: 'wx' })
}

async function main() {
  const evidence = source()
  if (args.includes('--sql')) {
    console.log(JSON.stringify({ source: evidence, rules, transaction: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout=30000; SET LOCAL lock_timeout=2000;', queries: {
      catalog: catalogSql,tables: tablesSql,candidatesCurrent: candidatesSql(true,true,true),
      candidatesBeforeMigration: candidatesSql(false,false,true),
      candidatesLegacyDump: candidatesSql(false,false,false),cases: casesSql,
      createdGroupsCurrent: createdGroupsSql(true),createdGroupsBeforeMigration: createdGroupsSql(false),
      fillManifest: fillSql,postflight: postflightSql()
    } },null,2))
    return
  }
  const target = inspectTarget()
  if (args.includes('--inspect-target')) {
    const report = { auditDate: new Date().toISOString(), source: evidence, target: target.public, databaseConnected: false }
    save(report)
    console.log(JSON.stringify(report,null,2))
    if (!target.public.configured) process.exitCode=2
    return
  }
  if (!args.includes('--run')) throw new Error('use_--inspect-target_--sql_or_--run')
  if (!target.public.configured) throw new Error('database_not_configured')
  if (target.public.appearsSynthetic) throw new Error('synthetic_target_refused_real_data_audit')
  if (flag('confirm-target') !== target.public.targetFingerprint) throw new Error('target_fingerprint_confirmation_required')
  const sourceKind = flag('source-kind')
  const sourceAsOf = flag('source-as-of')
  if (!['live','verified-snapshot','existing-dump'].includes(sourceKind ?? '')) throw new Error('source_kind_required')
  const unverifiedDumpTime = sourceKind === 'existing-dump' && sourceAsOf === 'unverified'
  if (sourceKind === 'existing-dump' && (!target.container || !/^otoame.*dump$/i.test(target.container.database))) throw new Error('existing_otoame_dump_identity_required')
  if (!unverifiedDumpTime && (!sourceAsOf || !/(?:Z|[+-]\d{2}:\d{2})$/.test(sourceAsOf) || !Number.isFinite(Date.parse(sourceAsOf)))) throw new Error('source_as_of_with_timezone_required')
  const url = target.url ? new URL(target.url) : null
  url?.searchParams.delete('schema')
  const client = target.container ? new ContainerReadOnlyClient(target.container) : new pg.Client({
    connectionString: url!.toString(), connectionTimeoutMillis: 10000, query_timeout: 35000,
    application_name: 'official_mirror_readonly_audit',
    options: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000' })
  const results: Record<string, unknown> = {}
  const failures: { query: string; code: string }[] = []
  let connected = false
  const run = async (name: string, sql: string) => {
    await client.query('SAVEPOINT audit_query')
    try {
      const result = await client.query(sql)
      const sets = (Array.isArray(result) ? result : [result]).map((item) => item.rows)
      results[name] = sets.length===1 ? sets[0] : sets
      await client.query('RELEASE SAVEPOINT audit_query')
      return sets.flat()
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT audit_query')
      await client.query('RELEASE SAVEPOINT audit_query')
      failures.push({query:name,code: safeErrorCode(error)})
      return null
    }
  }
  try {
    await client.connect(); connected=true
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout='30s'")
    await client.query("SET LOCAL lock_timeout='2s'")
    await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'")
    const session = await run('session', `SELECT transaction_timestamp()::text transaction_time,
      current_setting('transaction_read_only') read_only,
      current_setting('transaction_isolation') isolation,
      current_setting('statement_timeout') statement_timeout,
      current_setting('lock_timeout') lock_timeout,
      pg_is_in_recovery() recovery,pg_last_xact_replay_timestamp()::text last_replay,
      current_setting('server_version') server_version,current_database() database`)
    if (!session || session[0]?.read_only !== 'on') throw new Error('readonly_not_confirmed')
    if (target.container && session[0]?.database !== target.container.database) throw new Error('container_database_identity_mismatch')
    const markers = await run('synthetic_markers', `SELECT count(*)::bigint markers FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND (c.relname LIKE '%e2e%marker%' OR c.relname LIKE '%e2e%identity%')`)
    if (markers && Number(markers[0]?.markers)>0) throw new Error('synthetic_marker_refused')
    const tableRows = await run('tables', tablesSql)
    const tables = new Set((tableRows ?? []).filter((row) => row.present).map((row) => row.name))
    const columns = await run('module_columns',catalogSql)
    const hasColumn = (table: string,column: string) => (columns ?? []).some((row) => row.table_name===table && row.column_name===column)
    const missingBase = ['patch_resource','patch_resource_link','patch','user'].filter((name) => !tables.has(name))
    if (missingBase.length) throw new Error('required_base_tables_missing')
    await run('patch_freshness', `SELECT count(*)::bigint patches,min(created)::text earliest_created,
      max(created)::text latest_created,max(updated)::text latest_updated FROM public.patch`)
    await run('resource_freshness',freshnessSql)
    await run('link_freshness', `SELECT count(*)::bigint links,min(created)::text earliest_created,
      max(created)::text latest_created,max(updated)::text latest_updated FROM public.patch_resource_link`)
    await run('case_related_tables', `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND (table_name LIKE '%case%' OR table_name LIKE '%feedback%' OR table_name LIKE '%report%')
      ORDER BY table_name`)
    await run('database_metadata', `SELECT oid::text database_oid,
      shobj_description(oid,'pg_database') IS NOT NULL AS database_comment_present
      FROM pg_database WHERE datname=current_database()`)

    await run('current_candidates',candidatesSql(hasColumn('patch_resource','publisher_left_at'),tables.has('patch_resource_merge_record'),tables.has('ops_case')))
    if (tables.has('ops_case')) await run('reserved_case_kinds',casesSql)
    else failures.push({query:'reserved_case_kinds',code:'ops_case_missing'})
    await run('link_created_groups',createdGroupsSql(hasColumn('patch_resource_link','attached_at')))
    if (tables.has('patch_resource_link_attached_at_fill') && hasColumn('patch_resource_link','attached_at')) await run('fill_manifest',fillSql)
    else failures.push({query:'fill_manifest',code:'manifest_or_attached_at_missing'})
    await run('module_postflight_assertions',postflightSql().split('SELECT count(*)::bigint AS confirmed_stamp_links')[0])
    await client.query('ROLLBACK')
    const report = {
      auditDate: new Date().toISOString(),source:evidence,target:target.public,
      sourceKind,sourceAsOf:unverifiedDumpTime ? null : sourceAsOf,
      snapshotOriginIndependentlyVerified:sourceKind==='verified-snapshot',
      sourceIdentityConfirmedByOperator:true,
      rules,results,failures,
      queriesSucceeded:failures.length===0,
      actualBaseDataInventorySucceeded:Boolean(results.current_candidates && results.link_created_groups),
      unavailableChecks:failures.filter((item) => item.code.endsWith('_missing')).map((item) => item.query),
      deploymentDataPrerequisitesSatisfied:false,
      remaining: ['Independently reviewed source evidence for every link-created group; the threshold and existing manifest do not establish provenance.',
        'Administrator same-content confirmation for every proposed merge; counts are not permission to merge.',
        ...(failures.length ? ['Resolve failed or missing structure/data checks; this run is incomplete.'] : [])]
    }
    save(report)
    console.log(JSON.stringify(report,null,2))
    if (failures.length) process.exitCode=1
  } finally {
    if (connected) await client.query('ROLLBACK').catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}
function safeErrorCode(error: unknown) {
  if (error && typeof error==='object' && 'code' in error && typeof error.code==='string' && /^[A-Z0-9_]{2,40}$/.test(error.code)) return error.code
  if (error instanceof Error && /^[a-zA-Z0-9_.-]+$/.test(error.message)) return error.message
  return 'query_or_connection_failed_details_suppressed'
}
main().catch((error: unknown) => {
  console.error(JSON.stringify({completed:false,error:safeErrorCode(error)}))
  process.exitCode=1
})
