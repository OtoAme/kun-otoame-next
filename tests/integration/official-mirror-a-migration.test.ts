import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import pg, { type QueryResultRow } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  processResourceFileCleanup,
  queueResourceFileCleanup
} from '~/lib/resourceFileCleanup'

/**
 * Behavioral PostgreSQL proof for module 06. Skipped unless
 * KUN_OFFICIAL_MIRROR_A_TEST_DATABASE_URL names a disposable database.
 * The URL must be 127.0.0.1 on a port other than 5432, and the database must
 * contain only the tables this file creates. psql runs inside
 * KUN_OFFICIAL_MIRROR_A_PG_CONTAINER so the host does not need a client.
 */
const databaseUrl = process.env.KUN_OFFICIAL_MIRROR_A_TEST_DATABASE_URL?.trim()
const container = process.env.KUN_OFFICIAL_MIRROR_A_PG_CONTAINER?.trim()
const hash = 'ab'.repeat(32)
const objectKey = `patch/12/resource/${hash}/file.zip`

const forbiddenName = /touchgal|otoame_prod|postgres|template0|template1/i

const parseSafeUrl = (value: string) => {
  const parsed = new URL(value)
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const port = parsed.port
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('official mirror test database must use postgresql')
  }
  if (parsed.hostname !== '127.0.0.1' || !port || port === '5432') {
    throw new Error(
      'official mirror test database must be 127.0.0.1 on a port other than 5432'
    )
  }
  if (!name || forbiddenName.test(name) || name === 'official_mirror_a_20261104') {
    throw new Error('official mirror test database name is not disposable')
  }
  if (!container || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
    throw new Error('KUN_OFFICIAL_MIRROR_A_PG_CONTAINER must name the disposable container')
  }
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port,
    database: name,
    container
  }
}

const decisions = (stampConfirmed: string, stampRejected = 'none') => ({
  stamp_confirmed: stampConfirmed,
  stamp_rejected: stampRejected,
  small_stamp_review: 'acknowledged'
})

describe.skipIf(!databaseUrl)('official mirror migration on disposable Postgres', () => {
  if (!databaseUrl) return
  const target = parseSafeUrl(databaseUrl)
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000
  })
  const prismaPool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 5000
  })
  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool) })

  const query = async <T extends QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values)

  const reset = async () => {
    const extras = await query<{ relname: string }>(`
      SELECT c.relname
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT IN (
          'patch_resource',
          'patch_resource_link',
          'user_moemoepoint_ledger',
          'patch_resource_backup_state',
          'patch_resource_merge_record',
          'patch_resource_file_cleanup',
          'patch_resource_link_attached_at_fill'
        )
    `)
    if (extras.rows.length > 0) {
      throw new Error(
        `refusing to reset a database that already has ${extras.rows.map((row) => row.relname).join(', ')}`
      )
    }
    await query(`
      DROP TABLE IF EXISTS public.patch_resource_link_attached_at_fill;
      DROP TABLE IF EXISTS public.patch_resource_backup_state;
      DROP TABLE IF EXISTS public.patch_resource_merge_record;
      DROP TABLE IF EXISTS public.patch_resource_file_cleanup;
      DROP TABLE IF EXISTS public.patch_resource_link;
      DROP TABLE IF EXISTS public.patch_resource;
      DROP TABLE IF EXISTS public.user_moemoepoint_ledger;
      CREATE TABLE public.patch_resource (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
        updated TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
      );
      CREATE TABLE public.patch_resource_link (
        id INTEGER PRIMARY KEY,
        resource_id INTEGER NOT NULL REFERENCES public.patch_resource (id),
        storage VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        download INTEGER NOT NULL DEFAULT 0,
        created TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
        updated TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL
      );
      CREATE TABLE public.user_moemoepoint_ledger (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL
      );
    `)
  }

  const runFile = (
    name: string,
    variables: Record<string, string> = {}
  ) => {
    const sql = readFileSync(resolve(`migration/${name}`))
    const args = [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${target.password}`,
      '-e',
      'HOME=/tmp',
      '-e',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      target.container,
      'psql',
      '-U',
      target.user,
      '-d',
      target.database,
      '-v',
      'ON_ERROR_STOP=1',
      ...Object.entries(variables).flatMap(([key, value]) => ['-v', `${key}=${value}`]),
      '-f',
      '-'
    ]
    return spawnSync('docker', args, { input: sql, encoding: 'utf8' })
  }

  const expectSql = (name: string, variables: Record<string, string> = {}) => {
    const result = runFile(name, variables)
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    return result
  }

  const insertResource = (id: number, userId: number, created: string) =>
    query(
      `INSERT INTO public.patch_resource (id, user_id, created, updated)
       VALUES ($1, $2, $3::timestamp(3) without time zone, $3::timestamp(3) without time zone)`,
      [id, userId, created]
    )

  const insertLinks = (
    resourceId: number,
    created: string,
    count: number,
    startId: number,
    download = 4
  ) =>
    query(
      `INSERT INTO public.patch_resource_link
         (id, resource_id, storage, content, download, created, updated)
       SELECT $3 + g, $1, 's3', 'link-' || ($3 + g)::text, $4,
              $2::timestamp(3) without time zone,
              $2::timestamp(3) without time zone
       FROM generate_series(0, $5 - 1) AS g`,
      [resourceId, created, startId, download, count]
    )

  const attachedRows = () =>
    query<{
      id: number
      resource_id: number
      attached: string
      source: string | null
      download: number
      click: number
    }>(`
      SELECT link.id,
             link.resource_id,
             to_char(link.attached_at, 'YYYY-MM-DD HH24:MI:SS.MS') AS attached,
             fill.fill_source AS source,
             link.download,
             link.click
      FROM public.patch_resource_link AS link
      LEFT JOIN public.patch_resource_link_attached_at_fill AS fill
        ON fill.link_id = link.id
      ORDER BY link.id
    `)

  const columnPresent = async (table: string, column: string) => {
    const result = await query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS present`,
      [table, column]
    )
    return result.rows[0]?.present === true
  }

  beforeAll(async () => {
    const published = spawnSync(
      'docker',
      ['port', container ?? '', '5432/tcp'],
      { encoding: 'utf8' }
    )
    expect(published.status, published.stderr).toBe(0)
    expect(published.stdout).toContain(`${target.host}:${target.port}`)
    await reset()
  })

  beforeEach(async () => {
    await reset()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

  it('rolls back on a real migration lock timeout and safely reenters after release', async () => {
    await insertResource(1, 7, '2020-01-01 00:00:00.000')
    await insertLinks(1, '2024-04-04 04:04:04.004', 1, 1, 8)
    const blocker = await pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('LOCK TABLE public.patch_resource IN ACCESS EXCLUSIVE MODE')
      const result = runFile('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('lock timeout')
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
    const columns = await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='patch_resource_link' AND column_name='attached_at'`)
    expect(columns.rows).toHaveLength(0)
    expect((await query(`SELECT to_regclass('public.patch_resource_backup_state') AS name`)).rows[0].name).toBeNull()
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    const filled = (await query(`SELECT attached_at FROM public.patch_resource_link`)).rows[0].attached_at
    expect(filled).toBeInstanceOf(Date)
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    expect((await query(`SELECT attached_at FROM public.patch_resource_link`)).rows[0].attached_at).toEqual(filled)
  }, 15000)

  it('rolls back when a group larger than 50 has no stamp decision', async () => {
    await insertResource(1, 7, '2020-01-01 00:00:00.000')
    await insertLinks(1, '2024-04-04 04:04:04.004', 51, 1, 8)
    await query(
      `INSERT INTO public.user_moemoepoint_ledger (id, user_id, amount) VALUES (1, 7, 42)`
    )
    const result = runFile(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions('none')
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('more than 50 rows')
    expect(await columnPresent('patch_resource', 'publisher_left_at')).toBe(false)
    expect(await columnPresent('patch_resource_link', 'attached_at')).toBe(false)
    expect(await columnPresent('patch_resource_link', 'click')).toBe(false)
    const tables = await query<{ present: boolean }>(`
      SELECT to_regclass('public.patch_resource_backup_state') IS NOT NULL
          OR to_regclass('public.patch_resource_merge_record') IS NOT NULL
          OR to_regclass('public.patch_resource_file_cleanup') IS NOT NULL
          OR to_regclass('public.patch_resource_link_attached_at_fill') IS NOT NULL
        AS present
    `)
    expect(tables.rows[0]?.present).toBe(false)
    const ledger = await query<{ amount: number }>(
      `SELECT amount FROM public.user_moemoepoint_ledger`
    )
    expect(ledger.rows).toEqual([{ amount: 42 }])
    const downloads = await query<{ download: number }>(
      `SELECT DISTINCT download FROM public.patch_resource_link`
    )
    expect(downloads.rows).toEqual([{ download: 8 }])
  })

  it('uses GREATEST for a group of exactly 50 when no stamp is confirmed', async () => {
    await insertResource(1, 7, '2020-06-01 00:00:00.000')
    await insertLinks(1, '2020-01-01 00:00:00.000', 50, 1, 6)
    await query(
      `INSERT INTO public.user_moemoepoint_ledger (id, user_id, amount) VALUES (1, 7, 15)`
    )
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    const rows = await attachedRows()
    expect(rows.rows).toHaveLength(50)
    expect(rows.rows.every((row) => row.attached === '2020-06-01 00:00:00.000')).toBe(true)
    expect(rows.rows.every((row) => row.source === 'greatest')).toBe(true)
    expect(rows.rows.every((row) => row.click === 0 && row.download === 6)).toBe(true)
    const ledger = await query<{ amount: number; user_id: number }>(
      `SELECT user_id, amount FROM public.user_moemoepoint_ledger`
    )
    expect(ledger.rows).toEqual([{ user_id: 7, amount: 15 }])
    const publisher = await query<{ user_id: number; left_at: string | null }>(
      `SELECT user_id, publisher_left_at::text AS left_at FROM public.patch_resource`
    )
    expect(publisher.rows).toEqual([{ user_id: 7, left_at: null }])
  })

  it('stamps each confirmed link with its own card created time', async () => {
    const stamp = '2024-03-03 03:03:03.003'
    await insertResource(1, 10, '2019-01-01 00:00:00.000')
    await insertResource(2, 11, '2019-06-15 12:30:00.000')
    await insertLinks(1, stamp, 30, 1)
    await insertLinks(2, stamp, 21, 1000)
    expectSql(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions(stamp)
    )
    const rows = await attachedRows()
    expect(rows.rows).toHaveLength(51)
    expect(
      rows.rows.filter((row) => row.resource_id === 1).every((row) => row.attached === '2019-01-01 00:00:00.000')
    ).toBe(true)
    expect(
      rows.rows.filter((row) => row.resource_id === 2).every((row) => row.attached === '2019-06-15 12:30:00.000')
    ).toBe(true)
    expect(rows.rows.every((row) => row.source === 'resource_created')).toBe(true)
    expectSql('production-official-mirror-postflight-2026-11-04.sql')
    const observed = await query<{ confirmed_stamp_links: string }>(`
      SELECT count(*)::text AS confirmed_stamp_links
      FROM public.patch_resource_link_attached_at_fill
      WHERE fill_source = 'resource_created'
    `)
    expect(observed.rows[0]?.confirmed_stamp_links).toBe('51')
    const nulls = await query<{ nulls: string }>(
      `SELECT count(*)::text AS nulls FROM public.patch_resource_link WHERE attached_at IS NULL`
    )
    expect(nulls.rows[0]?.nulls).toBe('0')
  })

  it('keeps GREATEST for a rejected bulk upload when the link is later than the card', async () => {
    const stamp = '2021-02-01 08:00:00.000'
    await insertResource(1, 3, '2020-01-01 00:00:00.000')
    await insertLinks(1, stamp, 51, 1, 9)
    expectSql(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions('none', stamp)
    )
    const rows = await attachedRows()
    expect(rows.rows).toHaveLength(51)
    expect(rows.rows.every((row) => row.attached === stamp && row.source === 'greatest')).toBe(true)
    expect(rows.rows.every((row) => row.download === 9 && row.click === 0)).toBe(true)
  })

  it('uses the card created time for an explicitly confirmed small group', async () => {
    const stamp = '2022-02-02 02:02:02.002'
    await insertResource(1, 4, '2018-05-05 05:05:05.005')
    await insertLinks(1, stamp, 2, 1)
    expectSql(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions(stamp)
    )
    const rows = await attachedRows()
    expect(rows.rows.map((row) => row.attached)).toEqual([
      '2018-05-05 05:05:05.005',
      '2018-05-05 05:05:05.005'
    ])
    expect(rows.rows.every((row) => row.source === 'resource_created')).toBe(true)
  })

  it('leaves a pre-seeded attached_at out of the manifest', async () => {
    await insertResource(1, 4, '2020-06-01 00:00:00.000')
    await insertLinks(1, '2020-01-01 00:00:00.000', 2, 1)
    await query(
      `ALTER TABLE public.patch_resource_link
       ADD COLUMN attached_at TIMESTAMP(3) WITHOUT TIME ZONE`
    )
    await query(
      `UPDATE public.patch_resource_link
       SET attached_at = '1999-09-09 09:09:09.009'::timestamp(3) without time zone
       WHERE id = 1`
    )
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    const rows = await attachedRows()
    const sentinel = rows.rows.find((row) => row.id === 1)
    const filled = rows.rows.find((row) => row.id === 2)
    expect(sentinel).toMatchObject({
      attached: '1999-09-09 09:09:09.009',
      source: null
    })
    expect(filled).toMatchObject({
      attached: '2020-06-01 00:00:00.000',
      source: 'greatest'
    })
  })

  it('repeats the same decisions and rejects a different decision without rewriting fills', async () => {
    const stamp = '2023-03-03 03:03:03.003'
    await insertResource(1, 4, '2016-04-04 04:04:04.004')
    await insertLinks(1, stamp, 2, 1)
    expectSql(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions(stamp)
    )
    const first = await attachedRows()
    expectSql(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions(stamp)
    )
    expect((await attachedRows()).rows).toEqual(first.rows)
    const changed = runFile(
      'production-official-mirror-sync-2026-11-04.sql',
      decisions('none', stamp)
    )
    expect(changed.status).not.toBe(0)
    expect((await attachedRows()).rows).toEqual(first.rows)
  })

  it('corrects only manifest rows that still hold the filled value', async () => {
    const stamp = '2018-01-01 00:00:00.000'
    await insertResource(1, 4, '2017-01-01 00:00:00.000')
    await insertLinks(1, stamp, 3, 1)
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    await query(
      `UPDATE public.patch_resource_link
       SET attached_at = '2001-01-01 00:00:00.000'::timestamp(3) without time zone
       WHERE id = 2`
    )
    expectSql(
      'production-official-mirror-attached-at-correct-2026-11-04.sql',
      decisions(stamp)
    )
    const rows = await attachedRows()
    expect(rows.rows.find((row) => row.id === 1)).toMatchObject({
      attached: '2017-01-01 00:00:00.000',
      source: 'resource_created'
    })
    expect(rows.rows.find((row) => row.id === 2)).toMatchObject({
      attached: '2001-01-01 00:00:00.000',
      source: 'greatest'
    })
    expect(rows.rows.find((row) => row.id === 3)).toMatchObject({
      attached: '2017-01-01 00:00:00.000',
      source: 'resource_created'
    })
    const nulls = await query<{ nulls: string }>(
      `SELECT count(*)::text AS nulls FROM public.patch_resource_link WHERE attached_at IS NULL`
    )
    expect(nulls.rows[0]?.nulls).toBe('0')
  })

  it('gives a post-sync insert the default and does not correct it', async () => {
    const created = '2024-08-01 00:00:00.000'
    await insertResource(1, 4, '2015-01-01 00:00:00.000')
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    await query(
      `INSERT INTO public.patch_resource_link
         (id, resource_id, storage, content, download, created, updated)
       VALUES (9, 1, 's3', 'after-go-live', 3,
               $1::timestamp(3) without time zone,
               $1::timestamp(3) without time zone)`,
      [created]
    )
    const before = await attachedRows()
    const inserted = before.rows.find((row) => row.id === 9)
    expect(inserted?.source).toBeNull()
    expect(inserted?.click).toBe(0)
    expect(inserted?.download).toBe(3)
    expect(inserted?.attached).not.toBe(created)
    expect(inserted?.attached).not.toBe('2015-01-01 00:00:00.000')
    expectSql(
      'production-official-mirror-attached-at-correct-2026-11-04.sql',
      decisions(created)
    )
    const after = await attachedRows()
    expect(after.rows.find((row) => row.id === 9)).toEqual(inserted)
  })

  it('keeps one pending cleanup row when two transactions queue the same key', async () => {
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    let started = 0
    let releaseSecond: () => void = () => undefined
    const secondStarted = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const queueOnce = () =>
      prisma.$transaction(async (tx) => {
        started += 1
        if (started === 1) await secondStarted
        else releaseSecond()
        return queueResourceFileCleanup(tx, {
          resourceId: 12,
          links: [
            { storage: 's3', content: objectKey },
            { storage: 's3', content: objectKey },
            { storage: 'user', content: 'https://example.test/not-s3' }
          ],
          publicBases: []
        })
      })
    const [first, second] = await Promise.all([queueOnce(), queueOnce()])
    expect(new Set([...first.jobIds, ...second.jobIds]).size).toBe(1)
    const rows = await query<{ status: string; failure_category: string | null; total: string }>(`
      SELECT status, failure_category, count(*)::text AS total
      FROM public.patch_resource_file_cleanup
      GROUP BY status, failure_category
    `)
    expect(rows.rows).toEqual([
      { status: 'pending', failure_category: null, total: '1' }
    ])
  })

  it('leaves no cleanup row when the caller rolls the transaction back', async () => {
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    await expect(
      prisma.$transaction(async (tx) => {
        await queueResourceFileCleanup(tx, {
          resourceId: 12,
          links: [{ storage: 's3', content: objectKey }],
          publicBases: []
        })
        throw new Error('abort-cleanup')
      })
    ).rejects.toThrow('abort-cleanup')
    const rows = await query<{ total: string }>(
      `SELECT count(*)::text AS total FROM public.patch_resource_file_cleanup`
    )
    expect(rows.rows[0]?.total).toBe('0')
  })

  it('deletes a committed object once, cancels a live reference, and stores a delete failure without the key', async () => {
    expectSql('production-official-mirror-sync-2026-11-04.sql', decisions('none'))
    await insertResource(12, 4, '2020-01-01 00:00:00.000')
    const queued = await prisma.$transaction((tx) =>
      queueResourceFileCleanup(tx, {
        resourceId: 12,
        links: [{ storage: 's3', content: objectKey }],
        publicBases: []
      })
    )
    let deleted = 0
    const completed = await processResourceFileCleanup(prisma, {
      ids: queued.jobIds,
      deleteObject: async () => {
        deleted += 1
        return 'deleted'
      }
    })
    expect(deleted).toBe(1)
    expect(completed).toMatchObject({ examined: 1, completed: 1, cancelled: 0, failed: 0 })

    await prisma.$transaction((tx) =>
      queueResourceFileCleanup(tx, {
        resourceId: 12,
        links: [{ storage: 's3', content: objectKey }],
        publicBases: []
      })
    )
    await query(
      `INSERT INTO public.patch_resource_link
         (id, resource_id, storage, content, download, created, updated)
       VALUES (1, 12, 'user', $1, 2, '2020-01-01 00:00:00.000', '2020-01-01 00:00:00.000')`,
      [objectKey]
    )
    let cancelledDeletes = 0
    const cancelled = await processResourceFileCleanup(prisma, {
      deleteObject: async () => {
        cancelledDeletes += 1
        return 'deleted'
      }
    })
    expect(cancelledDeletes).toBe(0)
    expect(cancelled.cancelled).toBe(1)
    const cancelledRow = await query<{ status: string }>(
      `SELECT status FROM public.patch_resource_file_cleanup WHERE object_key = $1`,
      [objectKey]
    )
    expect(cancelledRow.rows[0]?.status).toBe('cancelled')

    await prisma.$transaction((tx) =>
      queueResourceFileCleanup(tx, {
        resourceId: 12,
        links: [{ storage: 's3', content: objectKey }],
        publicBases: []
      })
    )
    await query(`DELETE FROM public.patch_resource_link WHERE id = 1`)
    const logs: unknown[] = []
    const failed = await processResourceFileCleanup(prisma, {
      deleteObject: async () => {
        throw new Error('https://cdn.example.test/secret-token?password=hidden')
      },
      log: (event) => logs.push(event)
    })
    expect(failed.failed).toBe(1)
    const failedRow = await query<{ status: string; failure_category: string }>(
      `SELECT status, failure_category FROM public.patch_resource_file_cleanup WHERE object_key = $1`,
      [objectKey]
    )
    expect(failedRow.rows).toEqual([
      { status: 'failed', failure_category: 'delete_failed' }
    ])
    const logText = JSON.stringify(logs)
    expect(logText).not.toContain(objectKey)
    expect(logText).not.toContain('secret-token')
    expect(logText).not.toContain('password')
    expect(logText).not.toContain('https://')
  })
})
