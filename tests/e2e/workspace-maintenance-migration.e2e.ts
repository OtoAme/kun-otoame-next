/** PostgreSQL migration rehearsal. Requires a fresh, disposable pre-maintenance schema. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { Pool } from 'pg'

const url = new URL(process.env.KUN_E2E_DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert(url.pathname.endsWith('_e2e'))
assert(url.port && url.port !== '5432')
const pool = new Pool({ connectionString: url.href, max: 4 })
const artifactDir = process.env.KUN_E2E_ARTIFACT_DIR
assert(artifactDir)
const migration = (phase: string) =>
  readFile(
    new URL(
      `../../migration/production-link-maintenance-${phase}-2026-10-19.sql`,
      import.meta.url
    ),
    'utf8'
  )
const runSql = async (sql: string, readonly = false) => {
  const client = await pool.connect()
  try {
    await client.query(
      `SET default_transaction_read_only = ${readonly ? 'on' : 'off'}`
    )
    // pg already stops on an error; only remove psql's client-side directive.
    await client.query(sql.replace(/^\\set ON_ERROR_STOP on\r?\n/, ''))
  } finally {
    await client.query('ROLLBACK')
    await client.query('SET default_transaction_read_only = off')
    client.release()
  }
}
const maintenanceSnapshot = async () => {
  const result: Record<string, unknown[]> = {}
  for (const table of [
    'patch_resource_link_maintenance',
    'patch_resource_link_maintenance_event',
    'patch_resource_link_maintenance_participant'
  ]) {
    result[table] = (
      await pool.query(
        `SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`
      )
    ).rows
  }
  return result
}
const healthChecks = async () =>
  (
    await pool.query(`
  SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid IN ('patch_resource_link'::regclass, 'patch_resource_link_report'::regclass,
    'patch_resource_link_check'::regclass, 'patch_resource_link_history'::regclass)
  AND contype='c' ORDER BY conname
`)
  ).rows
const checks: string[] = []
const pass = (name: string) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}

try {
  assert.equal(
    (await pool.query('SELECT current_database() AS database')).rows[0]
      .database,
    url.pathname.slice(1)
  )
  const beforeChecks = await healthChecks()
  assert(
    JSON.stringify(beforeChecks).includes('share_blocked'),
    'Install the existing health and blocked CHECK migrations first'
  )
  const sync = await migration('sync')
  if (process.env.KUN_E2E_MIGRATION_PHASE === 'postruntime') {
    const before = await maintenanceSnapshot()
    await runSql(sync)
    assert.deepEqual(await maintenanceSnapshot(), before)
    assert.deepEqual(await healthChecks(), beforeChecks)
    await runSql(await migration('postflight'), true)
    pass(
      'rerunning sync preserves live maintenance events, revisions, participants and notifications'
    )
  } else {
    assert.equal(
      (
        await pool.query(
          "SELECT to_regclass('public.patch_resource_link_maintenance') AS relation"
        )
      ).rows[0].relation,
      null,
      'Install rehearsal requires a fresh pre-maintenance database'
    )
    const stamp = `m${Date.now().toString(36)}`
    const owner = (
      await pool.query(
        `INSERT INTO "user" (name,email,password,role,updated) VALUES ($1,$2,'synthetic',1,now()) RETURNING id`,
        [stamp, `${stamp}@example.invalid`]
      )
    ).rows[0].id as number
    const reporter = (
      await pool.query(
        `INSERT INTO "user" (name,email,password,role,updated) VALUES ($1,$2,'synthetic',1,now()) RETURNING id`,
        [`${stamp}r`, `${stamp}r@example.invalid`]
      )
    ).rows[0].id as number
    const patch = (
      await pool.query(
        `INSERT INTO patch (unique_id,name,user_id,updated) VALUES ($1,$2,$3,now()) RETURNING id`,
        [stamp.slice(-8), `${stamp} migration`, owner]
      )
    ).rows[0].id as number
    const resource = (
      await pool.query(
        `INSERT INTO patch_resource (section,name,user_id,patch_id,updated) VALUES ('galgame',$1,$2,$3,now()) RETURNING id`,
        [stamp, owner, patch]
      )
    ).rows[0].id as number
    const happened = new Date(Date.now() - 8 * 86400000)
    const candidates: {
      id: number
      linkId: number
      eligible: boolean
      label: string
    }[] = []
    for (const label of [
      'eligible',
      'invalid-latest',
      'responded',
      'staff-dispute',
      'old-version',
      'no-report',
      'zero-weight',
      'closed'
    ]) {
      const health = label === 'staff-dispute' ? 'disputed' : 'suspect'
      const linkId = (
        await pool.query(
          `INSERT INTO patch_resource_link (resource_id,storage,content,health,health_changed_at,updated) VALUES ($1,'user','https://example.invalid/synthetic',$2,$3,now()) RETURNING id`,
          [resource, health, happened.toISOString()]
        )
      ).rows[0].id as number
      const context = {
        patchId: patch,
        resourceId: resource,
        linkId,
        linkVersion: label === 'old-version' ? 2 : 1,
        evidenceRound: 0,
        health,
        healthChangedAt: happened.toISOString(),
        source:
          label === 'staff-dispute' ? 'owner_verification' : 'user_reports'
      }
      const caseId = (
        await pool.query(
          `INSERT INTO ops_case (kind,target_type,target_id,patch_id,owner_type,owner_id,status,public,source,status_changed_at,queue_entered_at,first_owner_response_at,updated)
        VALUES ($1,'link',$2,$3,$4,$5,$6,true,'system',$7,$7,$8,now()) RETURNING id`,
          [
            `link_${health}`,
            linkId,
            patch,
            label === 'staff-dispute' ? 'staff' : 'publisher',
            label === 'staff-dispute' ? null : owner,
            label === 'closed' ? 'resolved' : 'open',
            happened.toISOString(),
            label === 'responded' ? new Date().toISOString() : null
          ]
        )
      ).rows[0].id as number
      await pool.query('UPDATE ops_case SET dedup_key=$1 WHERE id=$2', [
        `link:${linkId}:v:1`,
        caseId
      ])
      await pool.query(
        `INSERT INTO ops_case_message (case_id,kind,event,body,payload) VALUES ($1,'system','opened','synthetic',$2)`,
        [caseId, JSON.stringify({ link_health: context })]
      )
      if (label === 'invalid-latest') {
        await pool.query(
          `INSERT INTO ops_case_message (case_id,kind,event,body,payload) VALUES ($1,'system','opened','synthetic invalid latest',$2)`,
          [
            caseId,
            JSON.stringify({ link_health: { ...context, linkId: 'invalid' } })
          ]
        )
      }
      if (label !== 'no-report') {
        await pool.query(
          `INSERT INTO patch_resource_link_report (link_id,link_version,evidence_round,user_id,reason,weight,ever_counted) VALUES ($1,1,0,$2,'deleted',$3,$4)`,
          [
            linkId,
            reporter,
            label === 'zero-weight' ? 0 : 1,
            label !== 'zero-weight'
          ]
        )
      }
      candidates.push({
        id: caseId,
        linkId,
        eligible: label === 'eligible',
        label
      })
    }
    const caseSnapshot = async () =>
      (
        await pool.query(
          'SELECT row_to_json(c) AS row FROM ops_case c WHERE id=ANY($1::int[]) ORDER BY id',
          [candidates.map((row) => row.id)]
        )
      ).rows
    const contextSnapshot = async () =>
      (
        await pool.query(
          'SELECT row_to_json(m) AS row FROM ops_case_message m WHERE case_id=ANY($1::int[]) ORDER BY id',
          [candidates.map((row) => row.id)]
        )
      ).rows
    const priorCases = await caseSnapshot()
    const priorContexts = await contextSnapshot()
    await runSql(await migration('preflight'), true)
    pass(
      'preflight is executable in a read-only PostgreSQL session before first installation'
    )

    const locker = await pool.connect()
    try {
      await locker.query('BEGIN')
      await locker.query(
        'LOCK TABLE patch_resource_link IN ACCESS EXCLUSIVE MODE'
      )
      const started = Date.now()
      await assert.rejects(
        runSql(sync),
        (error: unknown) =>
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '55P03'
      )
      assert(
        Date.now() - started < 20000,
        'Sync must have a bounded lock timeout'
      )
    } finally {
      await locker.query('ROLLBACK')
      locker.release()
    }
    assert.equal(
      (
        await pool.query(
          "SELECT to_regclass('public.patch_resource_link_maintenance') AS relation"
        )
      ).rows[0].relation,
      null
    )
    assert.deepEqual(await caseSnapshot(), priorCases)
    pass(
      'lock timeout rolls back the entire first installation without touching existing cases'
    )

    await runSql(sync)
    await runSql(await migration('postflight'), true)
    const controls = (
      await pool.query(
        'SELECT id,original_link_id FROM patch_resource_link_maintenance WHERE original_link_id=ANY($1::int[])',
        [candidates.map((row) => row.linkId)]
      )
    ).rows
    assert.deepEqual(
      controls.map((row) => row.original_link_id),
      candidates.filter((row) => row.eligible).map((row) => row.linkId)
    )
    const events = (
      await pool.query(
        'SELECT * FROM patch_resource_link_maintenance_event WHERE control_id=ANY($1::int[])',
        [controls.map((row) => row.id)]
      )
    ).rows
    assert.equal(events.length, 1)
    assert.equal(events[0].source, 'migrated')
    assert.equal(events[0].state, 'pending')
    assert.equal(events[0].case_id, candidates[0].id)
    assert.equal(events[0].publisher_notified_at, null)
    assert.equal(events[0].result_notified_at, null)
    assert.equal(
      (
        await pool.query(
          'SELECT count(*) FROM user_message WHERE recipient_id=ANY($1::int[])',
          [[owner, reporter]]
        )
      ).rows[0].count,
      '0'
    )
    assert.deepEqual(await caseSnapshot(), priorCases)
    assert.deepEqual(await contextSnapshot(), priorContexts)
    assert.deepEqual(await healthChecks(), beforeChecks)
    pass(
      'only the current-version unanswered publisher case with counted evidence is continued; clocks, contexts and health CHECKs are preserved'
    )
    const installed = await maintenanceSnapshot()
    await runSql(sync)
    assert.deepEqual(await maintenanceSnapshot(), installed)
    await runSql(await migration('postflight'), true)
    pass('second sync and read-only postflight are idempotent')
  }
  await mkdir(artifactDir, { recursive: true })
  await writeFile(
    `${artifactDir}/migration-${process.env.KUN_E2E_MIGRATION_PHASE ?? 'install'}.json`,
    JSON.stringify({ checks, passed: true }, null, 2)
  )
} finally {
  await pool.end()
}
