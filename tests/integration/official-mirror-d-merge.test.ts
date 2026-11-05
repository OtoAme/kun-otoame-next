import pg, { type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Real PostgreSQL proof for module 06 merges. Runs only when
 * KUN_OFFICIAL_MIRROR_D_TEST_DATABASE_URL is exactly the disposable database
 * official_mirror_d_e2e on 127.0.0.1:55433. Cache stand-ins stay in process.
 */
const databaseUrl = process.env.KUN_OFFICIAL_MIRROR_D_TEST_DATABASE_URL?.trim()

vi.mock('~/lib/redis', () => {
  const idle = () => async () => undefined
  const redis = {
    on: () => redis,
    quit: async () => undefined,
    disconnect: () => undefined,
    status: 'end'
  }
  return new Proxy(
    { redis, default: redis },
    {
      get(target, prop) {
        if (prop === 'then') return undefined
        if (Reflect.has(target, prop)) return Reflect.get(target, prop)
        return idle()
      }
    }
  )
})

vi.mock('~/lib/s3', () => {
  const idle = () => async () => undefined
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined
        if (prop === 's3') return {}
        return idle()
      }
    }
  )
})

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: async () => undefined,
  invalidatePatchListCaches: async () => undefined
}))

vi.mock('~/lib/officialMirror/cache', () => ({
  refreshAfterCommit: async () => true,
  refreshOfficialMirrorPresentation: async () => undefined
}))

type MergeModule = typeof import('~/lib/officialMirror/mergeService')

const assertDisposableUrl = (value: string) => {
  const parsed = new URL(value)
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('official mirror D test database must use postgresql')
  }
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55433') {
    throw new Error('official mirror D test database must be 127.0.0.1:55433')
  }
  if (parsed.username !== 'official_mirror_d' || name !== 'official_mirror_d_e2e') {
    throw new Error('official mirror D test database must be official_mirror_d_e2e')
  }
  if (/official_mirror_a|touchgal|otoame_prod/i.test(name)) {
    throw new Error('official mirror D test database points at a forbidden target')
  }
  return value
}

describe.skipIf(!databaseUrl)('official mirror merge on disposable Postgres', () => {
  if (!databaseUrl) return
  const url = assertDisposableUrl(databaseUrl)
  const pool = new pg.Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 5000
  })
  let merge: MergeModule
  let updateHelpPost: (typeof import('~/app/api/help/service'))['updateHelpPost']

  const query = async <T extends QueryResultRow>(text: string, values: unknown[] = []) =>
    pool.query<T>(text, values)

  const wipe = async () => {
    const tables = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    )
    if (!tables.rows.length) return
    const list = tables.rows
      .map((row) => `"${row.tablename.replace(/"/g, '""')}"`)
      .join(', ')
    await query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  }

  const setval = async (table: string) => {
    const relation = table.replace(/"/g, '')
    await query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${table}))`,
      [relation]
    )
  }

  const user = async (
    id: number,
    name: string,
    role: number,
    moemoepoint = 0
  ) => {
    await query(
      `INSERT INTO "user" (id, name, email, password, role, moemoepoint, updated)
       VALUES ($1, $2, $3, 'not-used', $4, $5, CURRENT_TIMESTAMP)`,
      [id, name, `${name}@e2e.invalid`, role, moemoepoint]
    )
  }

  const stamp = (value: string) => new Date(value)

  beforeAll(async () => {
    process.env.KUN_DATABASE_URL = url
    process.env.REDIS_HOST = '127.0.0.1'
    process.env.REDIS_PORT = '1'
    process.env.REDIS_PASSWORD = ''
    const identity = await query<{ db: string }>(`SELECT current_database() AS db`)
    if (identity.rows[0]?.db !== 'official_mirror_d_e2e') {
      throw new Error('connected database is not official_mirror_d_e2e')
    }
    const handled = await query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'patch_resource_merge_record' AND column_name = 'handled_at'`
    )
    if (handled.rows[0]?.data_type !== 'timestamp without time zone') {
      throw new Error('merge handled_at is not timestamp without time zone')
    }
    const indexes = await query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN (
         'patch_resource_merge_record_pair_key',
         'patch_resource_merge_record_staff_status_idx'
       )`
    )
    expect(indexes.rows).toHaveLength(2)
    merge = await import('~/lib/officialMirror/mergeService')
    updateHelpPost = (await import('~/app/api/help/service')).updateHelpPost
  }, 30000)

  afterAll(async () => {
    const prisma = await import('~/prisma/index')
    await prisma.disconnectPrismaAdapter()
    await pool.end()
  })

  const seedGame = async () => {
    await wipe()
    await user(1, 'd-pub', 1, 3)
    await user(2, 'd-staff', 3)
    await user(4, 'd-admin', 4)
    await user(5, 'd-liker', 1)
    await user(6, 'd-old', 3)
    await query(
      `INSERT INTO patch (
         id, unique_id, name, user_id, type, language, engine, platform, download, updated
       ) VALUES (
         10, 'd0e2e001', '隔离游戏', 4, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 9, CURRENT_TIMESTAMP
       )`
    )
    const insertCard = async (
      id: number,
      ownerId: number,
      name: string,
      created: string,
      download: number,
      note = ''
    ) => {
      await query(
        `INSERT INTO patch_resource (
           id, section, name, note, type, language, platform, download, status,
           user_id, patch_id, created, updated
         ) VALUES (
           $1, 'galgame', $2, $3, ARRAY['游戏']::text[], ARRAY['日语']::text[], ARRAY['Windows']::text[],
           $4, 0, $5, 10, $6, CURRENT_TIMESTAMP
         )`,
        [id, name, note, download, ownerId, stamp(created)]
      )
    }
    await insertCard(1, 1, '用户卡', '2026-01-01T00:00:00.000Z', 2)
    await insertCard(2, 2, '站方卡', '2026-03-01T00:00:00.000Z', 5, '备份')
    await insertCard(4, 6, '已留下', '2026-02-01T00:00:00.000Z', 1)
    await query(
      `INSERT INTO patch_resource_link (
         id, storage, content, code, password, hash, sort_order, version, resource_id, attached_at, updated
       ) VALUES
         (11, 'user', 'https://example.test/user', '', '', '', 4, 1, 1, $1, CURRENT_TIMESTAMP),
         (40, 'touchgal', 'https://example.test/early', 'secret-code', 'secret-pass', 'abchash', 1, 2, 2, $1, CURRENT_TIMESTAMP),
         (30, 'touchgal', 'https://example.test/late', '', '', '', 5, 3, 2, $1, CURRENT_TIMESTAMP)`,
      [stamp('2026-03-02T00:00:00.000Z')]
    )
    await query(
      `INSERT INTO patch_resource_link_history (
         resource_id, link_id, from_version, reason, operator_user_id
       ) VALUES (2, 30, 1, 'edit', 2)`
    )
    await query(
      `INSERT INTO patch_resource_link_check (
         link_id, patch_id, resource_id, link_version, evidence_round, health,
         request_id, input_signature, requested_at, completed_at, verdict,
         reason, cached, failed
       ) VALUES (
         30, 10, 2, 3, 1, 'ok', '00000000-0000-4000-8000-000000000001',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         $1, $1, 'ok', 'none', false, false
       )`,
      [stamp('2026-03-03T00:00:00.000Z')]
    )
    await query(
      `INSERT INTO patch_resource_link_maintenance (
         original_link_id, link_version, patch_id, link_id, resource_id, updated
       ) VALUES (40, 2, 10, 40, 2, CURRENT_TIMESTAMP)`
    )
    const later = stamp('2026-08-01T00:00:00.000Z')
    const earlier = stamp('2026-06-01T00:00:00.000Z')
    const equal = stamp('2026-07-15T12:34:56.789Z')
    const quotaExpires = stamp('2026-05-01T00:00:00.000Z')
    const revealExpires = stamp('2026-09-01T00:00:00.000Z')
    await query(
      `INSERT INTO patch_resource_access_grant (actor_key, resource_id, expires) VALUES
         ('visitor-a', 1, $1),
         ('visitor-a', 2, $2),
         ('visitor-b', 1, $3),
         ('visitor-b', 2, $3)`,
      [earlier, later, equal]
    )
    await query(
      `INSERT INTO patch_resource_access (
         actor_type, access_kind, section, storage, expires, patch_id, resource_id, link_id, updated
       ) VALUES
         ('user', 'quota', 'galgame', 'touchgal', $1, 10, 2, NULL, CURRENT_TIMESTAMP),
         ('user', 'link_reveal', 'galgame', 'touchgal', $2, 10, 2, 30, CURRENT_TIMESTAMP)`,
      [quotaExpires, revealExpires]
    )
    await query(
      `INSERT INTO help_post (user_id, request_id, category, title, content, resource_id, updated)
       VALUES (1, 'd-help-1', 'game', '求助', '内容', 2, CURRENT_TIMESTAMP)`
    )
    await query(
      `INSERT INTO ops_case (kind, target_type, target_id, owner_type, status, revision, patch_id, updated)
       VALUES ('feedback', 'resource', 2, 'staff', 'resolved', 3, 10, CURRENT_TIMESTAMP)`
    )
    await query(
      `INSERT INTO user_patch_resource_like_relation (user_id, resource_id, updated)
       VALUES (5, 2, CURRENT_TIMESTAMP)`
    )
    await query(
      `INSERT INTO patch_resource_link_report (
         link_id, link_version, evidence_round, user_id, reason, weight, ever_counted
       ) VALUES (30, 3, 1, 5, 'broken', 1.0, true)`
    )
    await query(
      `INSERT INTO user_moemoepoint_ledger (
         user_id, kind, balance_delta, reserved_delta, balance_after, reserved_after,
         reason_code, reason
       ) VALUES (1, 'publish', 1, 0, 3, 0, 'publish_reward', '历史发布')`
    )
    await query(
      `INSERT INTO patch_resource_merge_record (
         user_resource_id, staff_resource_id, patch_id, section, status,
         handled_at, handled_by_user_id, detail
       ) VALUES (4, 99, 10, 'galgame', 'merged', $1, 4, '{}'::jsonb)`,
      [stamp('2026-02-02T00:00:00.000Z')]
    )
    for (const table of [
      '"user"',
      'patch',
      'patch_resource',
      'patch_resource_link'
    ]) {
      await setval(table)
    }
  }

  const pairBasis = async (userResourceId: number, staffResourceId: number) => {
    const preview = await merge.previewResourceMerge({ userResourceId, staffResourceId })
    if (typeof preview === 'string') throw new Error(preview)
    return preview
  }

  it('moves every referenced row once and keeps the ledger unchanged', async () => {
    await seedGame()
    const ledgerBefore = await query(
      `SELECT id, user_id, kind, balance_delta, reserved_delta, balance_after, reason
       FROM user_moemoepoint_ledger ORDER BY id`
    )
    const preview = await pairBasis(1, 2)
    expect(preview.classification).toBe('high')
    expect(preview.survivorPreview.links.map((item) => [item.id, item.sortOrder])).toEqual([
      [11, 4],
      [40, 5],
      [30, 6]
    ])
    const merged = await merge.mergeStaffIntoUser(
      {
        userResourceId: 1,
        staffResourceId: 2,
        basis: preview.basis,
        contentConfirmed: true
      },
      4,
      true
    )
    expect(merged).toMatchObject({
      alreadyMerged: false,
      userResourceId: 1,
      staffResourceId: 2,
      movedLinkIds: [40, 30]
    })

    const cards = await query<{ id: number; user_id: number; download: number; note: string }>(
      `SELECT id, user_id, download, note FROM patch_resource ORDER BY id`
    )
    expect(cards.rows.map((row) => row.id)).toEqual([1, 4])
    expect(cards.rows[0]).toMatchObject({ user_id: 1, download: 7 })
    expect(cards.rows[0]?.note).toContain('站方备份说明：备份')
    expect(cards.rows[0]?.note).not.toContain('secret-pass')

    const links = await query<{ id: number; resource_id: number; sort_order: number; password: string }>(
      `SELECT id, resource_id, sort_order, password FROM patch_resource_link ORDER BY sort_order, id`
    )
    expect(links.rows.map((row) => [row.id, row.resource_id, row.sort_order])).toEqual([
      [11, 1, 4],
      [40, 1, 5],
      [30, 1, 6]
    ])
    expect(links.rows.find((row) => row.id === 40)?.password).toBe('secret-pass')

    const history = await query<{ resource_id: number; link_id: number; reason: string }>(
      `SELECT resource_id, link_id, reason FROM patch_resource_link_history ORDER BY id`
    )
    expect(history.rows).toEqual([
      { resource_id: 1, link_id: 30, reason: 'edit' },
      { resource_id: 1, link_id: 40, reason: 'merge' },
      { resource_id: 1, link_id: 30, reason: 'merge' }
    ])
    const checks = await query<{ resource_id: number }>(
      `SELECT resource_id FROM patch_resource_link_check`
    )
    expect(checks.rows).toEqual([{ resource_id: 1 }])
    const maintenance = await query<{ resource_id: number; link_id: number }>(
      `SELECT resource_id, link_id FROM patch_resource_link_maintenance`
    )
    expect(maintenance.rows).toEqual([{ resource_id: 1, link_id: 40 }])
    const help = await query<{ resource_id: number }>(`SELECT resource_id FROM help_post`)
    expect(help.rows).toEqual([{ resource_id: 1 }])
    const closed = await query<{ target_id: number; status: string }>(
      `SELECT target_id, status FROM ops_case`
    )
    expect(closed.rows).toEqual([{ target_id: 1, status: 'resolved' }])
    const likes = await query(`SELECT id FROM user_patch_resource_like_relation`)
    expect(likes.rows).toHaveLength(0)
    const reports = await query<{ link_id: number }>(
      `SELECT link_id FROM patch_resource_link_report`
    )
    expect(reports.rows).toEqual([{ link_id: 30 }])

    const access = await query<{
      access_kind: string
      resource_id: number
      link_id: number | null
      expires: Date
    }>(
      `SELECT access_kind, resource_id, link_id, expires
       FROM patch_resource_access ORDER BY access_kind`
    )
    expect(access.rows).toEqual([
      {
        access_kind: 'link_reveal',
        resource_id: 1,
        link_id: 30,
        expires: stamp('2026-09-01T00:00:00.000Z')
      },
      {
        access_kind: 'quota',
        resource_id: 1,
        link_id: null,
        expires: stamp('2026-05-01T00:00:00.000Z')
      }
    ])
    const grants = await query<{ actor_key: string; resource_id: number; expires: Date }>(
      `SELECT actor_key, resource_id, expires FROM patch_resource_access_grant ORDER BY actor_key`
    )
    expect(grants.rows).toEqual([
      { actor_key: 'visitor-a', resource_id: 1, expires: stamp('2026-08-01T00:00:00.000Z') },
      { actor_key: 'visitor-b', resource_id: 1, expires: stamp('2026-07-15T12:34:56.789Z') }
    ])
    const freshWindow = Date.now() + 24 * 60 * 60 * 1000
    for (const grant of grants.rows) {
      expect(Math.abs(grant.expires.getTime() - freshWindow)).toBeGreaterThan(60 * 60 * 1000)
    }

    const game = await query<{ download: number }>(`SELECT download FROM patch WHERE id = 10`)
    expect(game.rows[0]?.download).toBe(9)
    const points = await query<{ moemoepoint: number }>(
      `SELECT moemoepoint FROM "user" WHERE id = 1`
    )
    expect(points.rows[0]?.moemoepoint).toBe(3)
    const ledgerAfter = await query(
      `SELECT id, user_id, kind, balance_delta, reserved_delta, balance_after, reason
       FROM user_moemoepoint_ledger ORDER BY id`
    )
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows)

    const record = await query<{ status: string; detail: string }>(
      `SELECT status, detail::text AS detail FROM patch_resource_merge_record
       WHERE user_resource_id = 1 AND staff_resource_id = 2`
    )
    expect(record.rows[0]?.status).toBe('merged')
    expect(record.rows[0]?.detail).not.toMatch(/secret-pass|secret-code|abchash|https?:/)
    const log = await query<{ content: string }>(
      `SELECT content FROM admin_log WHERE type = 'resource_merge'`
    )
    expect(log.rows).toHaveLength(1)
    expect(log.rows[0]?.content).not.toMatch(/secret-pass|secret-code|abchash|https?:/)

    const replay = await merge.mergeStaffIntoUser(
      {
        userResourceId: 1,
        staffResourceId: 2,
        basis: preview.basis,
        contentConfirmed: true
      },
      4,
      true
    )
    expect(replay).toMatchObject({ alreadyMerged: true, userResourceId: 1, staffResourceId: 2 })
    const download = await query<{ download: number }>(
      `SELECT download FROM patch_resource WHERE id = 1`
    )
    expect(download.rows[0]?.download).toBe(7)
    const records = await query(
      `SELECT id FROM patch_resource_merge_record WHERE user_resource_id = 1 AND staff_resource_id = 2`
    )
    expect(records.rows).toHaveLength(1)
    const dismissed = await merge.dismissResourceMerge(
      { userResourceId: 1, staffResourceId: 2 },
      4
    )
    expect(dismissed).toBe('这一对已经合并')
    expect(record.rows[0]?.status).toBe('merged')
  }, 30000)

  it('lets one of two pairs take the survivor and leaves the other pair unmerged', async () => {
    await wipe()
    await user(1, 'd-pub', 1)
    await user(2, 'd-staff', 3)
    await user(3, 'd-staff2', 3)
    await user(4, 'd-admin', 4)
    await query(
      `INSERT INTO patch (
         id, unique_id, name, user_id, type, language, engine, platform, updated
       ) VALUES (
         10, 'd0e2e002', '隔离游戏', 4, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP
       )`
    )
    await query(
      `INSERT INTO patch_resource (
         id, section, name, type, language, platform, download, status, user_id, patch_id, created, updated
       ) VALUES
         (21, 'galgame', '用户卡', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 1, 0, 1, 10, $1, CURRENT_TIMESTAMP),
         (22, 'galgame', '站方甲', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 3, 0, 2, 10, $2, CURRENT_TIMESTAMP),
         (23, 'galgame', '站方乙', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 4, 0, 3, 10, $2, CURRENT_TIMESTAMP)`,
      [stamp('2026-01-01T00:00:00.000Z'), stamp('2026-03-01T00:00:00.000Z')]
    )
    await query(
      `INSERT INTO patch_resource_link (storage, content, sort_order, resource_id, updated) VALUES
         ('user', 'https://example.test/user', 0, 21, CURRENT_TIMESTAMP),
         ('touchgal', 'https://example.test/a', 0, 22, CURRENT_TIMESTAMP),
         ('touchgal', 'https://example.test/b', 0, 23, CURRENT_TIMESTAMP)`
    )
    for (const table of ['"user"', 'patch', 'patch_resource', 'patch_resource_link']) {
      await setval(table)
    }
    const first = await pairBasis(21, 22)
    const second = await pairBasis(21, 23)
    const [left, right] = await Promise.all([
      merge.mergeStaffIntoUser(
        {
          userResourceId: 21,
          staffResourceId: 22,
          basis: first.basis,
          contentConfirmed: true
        },
        4
      ),
      merge.mergeStaffIntoUser(
        {
          userResourceId: 21,
          staffResourceId: 23,
          basis: second.basis,
          contentConfirmed: true
        },
        4
      )
    ])
    const outcomes = [left, right]
    const merged = outcomes.filter((item) => typeof item !== 'string')
    const skipped = outcomes.filter((item): item is string => typeof item === 'string')
    expect(merged).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatch(/已与其他卡片合并|合并冲突/)
    const card = await query<{ download: number }>(
      `SELECT download FROM patch_resource WHERE id = 21`
    )
    expect([4, 5]).toContain(card.rows[0]?.download)
    const survivors = await query<{ id: number }>(
      `SELECT id FROM patch_resource WHERE id IN (22, 23) ORDER BY id`
    )
    expect(survivors.rows).toHaveLength(1)
    const records = await query(
      `SELECT id FROM patch_resource_merge_record WHERE user_resource_id = 21 AND status = 'merged'`
    )
    expect(records.rows).toHaveLength(1)
  }, 30000)

  it('dismisses once, reopens once, and refuses a handed-over user card', async () => {
    await wipe()
    await user(1, 'd-pub', 1)
    await user(2, 'd-staff', 3)
    await user(4, 'd-admin', 4)
    await query(
      `INSERT INTO patch (
         id, unique_id, name, user_id, type, language, engine, platform, updated
       ) VALUES (
         10, 'd0e2e003', '隔离游戏', 4, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP
       )`
    )
    await query(
      `INSERT INTO patch_resource (
         id, section, name, type, language, platform, status, user_id, patch_id, updated
       ) VALUES
         (31, 'galgame', '用户卡', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 0, 1, 10, CURRENT_TIMESTAMP),
         (32, 'galgame', '站方卡', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 0, 2, 10, CURRENT_TIMESTAMP)`
    )
    await query(
      `INSERT INTO patch_resource_link (storage, content, resource_id, updated) VALUES
         ('user', 'https://example.test/user', 31, CURRENT_TIMESTAMP),
         ('touchgal', 'https://example.test/staff', 32, CURRENT_TIMESTAMP)`
    )
    for (const table of ['"user"', 'patch', 'patch_resource', 'patch_resource_link']) {
      await setval(table)
    }
    expect(await merge.dismissResourceMerge({ userResourceId: 31, staffResourceId: 32 }, 4)).toEqual({
      changed: true
    })
    expect(await merge.dismissResourceMerge({ userResourceId: 31, staffResourceId: 32 }, 4)).toEqual({
      changed: false
    })
    const dismissed = await query<{ status: string }>(
      `SELECT status FROM patch_resource_merge_record WHERE user_resource_id = 31`
    )
    expect(dismissed.rows).toEqual([{ status: 'dismissed' }])
    expect(await merge.reopenResourceMerge({ userResourceId: 31, staffResourceId: 32 }, 4)).toEqual({
      changed: true
    })
    expect(await merge.reopenResourceMerge({ userResourceId: 31, staffResourceId: 32 }, 4)).toEqual({
      changed: false
    })
    expect(
      (await query(`SELECT id FROM patch_resource_merge_record WHERE user_resource_id = 31`)).rows
    ).toHaveLength(0)

    await query(`UPDATE patch_resource SET publisher_left_at = $1 WHERE id = 31`, [
      stamp('2026-04-01T00:00:00.000Z')
    ])
    expect(await merge.dismissResourceMerge({ userResourceId: 31, staffResourceId: 32 }, 4)).toBe(
      '用户卡片已交接'
    )
    expect(
      (await query(`SELECT id FROM patch_resource_merge_record WHERE user_resource_id = 31`)).rows
    ).toHaveLength(0)
  }, 30000)

  it('sees a link case committed while the staff link lock is held', async () => {
    await wipe()
    await user(1, 'd-pub', 1)
    await user(2, 'd-staff', 3)
    await user(4, 'd-admin', 4)
    await query(
      `INSERT INTO patch (
         id, unique_id, name, user_id, type, language, engine, platform, updated
       ) VALUES (
         10, 'd0e2e004', '隔离游戏', 4, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP
       )`
    )
    await query(
      `INSERT INTO patch_resource (
         id, section, name, type, language, platform, status, user_id, patch_id, created, updated
       ) VALUES
         (41, 'galgame', '用户卡', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 0, 1, 10, $1, CURRENT_TIMESTAMP),
         (42, 'galgame', '站方卡', ARRAY['游戏'], ARRAY['日语'], ARRAY['Windows'], 0, 2, 10, $2, CURRENT_TIMESTAMP)`,
      [stamp('2026-01-01T00:00:00.000Z'), stamp('2026-03-01T00:00:00.000Z')]
    )
    const link = await query<{ id: number }>(
      `INSERT INTO patch_resource_link (storage, content, sort_order, resource_id, updated) VALUES
         ('user', 'https://example.test/user', 0, 41, CURRENT_TIMESTAMP),
         ('touchgal', 'https://example.test/staff', 0, 42, CURRENT_TIMESTAMP)
       RETURNING id`
    )
    const staffLinkId = link.rows[1]?.id
    if (!staffLinkId) throw new Error('staff link was not inserted')
    for (const table of ['"user"', 'patch', 'patch_resource', 'patch_resource_link']) {
      await setval(table)
    }
    const preview = await pairBasis(41, 42)
    const holder = await pool.connect()
    let committed = false
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT id FROM patch_resource_link WHERE id = $1 FOR UPDATE', [
        staffLinkId
      ])
      const pending = merge.mergeStaffIntoUser(
        {
          userResourceId: 41,
          staffResourceId: 42,
          basis: preview.basis,
          contentConfirmed: true
        },
        4
      )
      const started = Date.now()
      let waiting = false
      while (Date.now() - started < 3000) {
        const locks = await query(
          `SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
             AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock'
           LIMIT 1`
        )
        if (locks.rowCount) {
          waiting = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      expect(waiting).toBe(true)
      await holder.query(
        `INSERT INTO ops_case (kind, target_type, target_id, owner_type, status, revision, updated)
         VALUES ('feedback', 'link', $1, 'staff', 'open', 1, CURRENT_TIMESTAMP)`,
        [staffLinkId]
      )
      await holder.query('COMMIT')
      committed = true
      expect(await pending).toBe('站方卡片有未结事项')
    } finally {
      if (!committed) await holder.query('ROLLBACK')
      holder.release()
    }
    const cards = await query<{ id: number; download: number }>(
      `SELECT id, download FROM patch_resource WHERE id IN (41, 42) ORDER BY id`
    )
    expect(cards.rows).toEqual([
      { id: 41, download: 0 },
      { id: 42, download: 0 }
    ])
    expect(
      (await query(`SELECT id FROM patch_resource_merge_record`)).rows
    ).toHaveLength(0)
  }, 30000)

  it('an edit waits on the resource locks a merge already holds and does not lock the help post first', async () => {
    await wipe()
    await user(1, 'd-asker', 1)
    await user(2, 'd-staff', 3)
    await query(
      `INSERT INTO patch (
         id, unique_id, name, user_id, type, language, engine, platform, download, updated
       ) VALUES (
         10, 'd0lock01', '锁序', 1, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 0, CURRENT_TIMESTAMP
       )`
    )
    await query(
      `INSERT INTO patch_resource (
         id, section, name, type, language, platform, status, user_id, patch_id, created, updated
       ) VALUES
         (1, 'galgame', '幸存卡', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 0, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
         (2, 'galgame', '旧站方卡', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 0, 2, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    const inserted = await query<{ id: number }>(
      `INSERT INTO help_post (
         user_id, request_id, category, title, content, patch_id, resource_id, updated
       ) VALUES (
         1, 'd-help-lock', 'runtime', '旧标题', '旧正文', 10, 2, CURRENT_TIMESTAMP
       ) RETURNING id`
    )
    const postId = inserted.rows[0]!.id
    const holder = await pool.connect()
    let committed = false
    let edit: Promise<unknown> | undefined
    try {
      await holder.query('BEGIN')
      await holder.query(`SET lock_timeout = '4s'`)
      const holderPid = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      const pid = holderPid.rows[0]!.pid
      await holder.query(
        'SELECT id FROM patch_resource WHERE id IN (1, 2) ORDER BY id FOR UPDATE'
      )
      edit = updateHelpPost(
        {
          postId,
          category: 'runtime',
          title: '编辑后的标题',
          content: '编辑后的正文',
          gameName: '',
          gameLinks: [],
          patchId: 10,
          resourceId: 2
        },
        1
      )
      const started = Date.now()
      let waitingOnResource = false
      let heldHelpPost = false
      while (Date.now() - started < 2500) {
        const locks = await query<{
          wait_event_type: string | null
          query: string
          relname: string | null
          granted: boolean | null
          locktype: string | null
        }>(
          `SELECT a.wait_event_type, a.query, c.relname, l.granted, l.locktype
           FROM pg_stat_activity a
           LEFT JOIN pg_locks l ON l.pid = a.pid
           LEFT JOIN pg_class c ON c.oid = l.relation
           WHERE a.datname = current_database()
             AND a.pid <> $1
             AND a.pid <> pg_backend_pid()`,
          [pid]
        )
        waitingOnResource = locks.rows.some(
          (row) =>
            row.wait_event_type === 'Lock' &&
            row.query.includes('om:lock-help-resource')
        )
        heldHelpPost = locks.rows.some(
          (row) =>
            row.relname === 'help_post' &&
            row.locktype === 'tuple' &&
            row.granted === true
        )
        if (waitingOnResource) break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      expect(waitingOnResource).toBe(true)
      expect(heldHelpPost).toBe(false)
      await holder.query('UPDATE help_post SET resource_id = 1 WHERE resource_id = 2')
      await holder.query('DELETE FROM patch_resource WHERE id = 2')
      await holder.query(
        `INSERT INTO patch_resource_merge_record (
           user_resource_id, staff_resource_id, patch_id, section, status,
           handled_at, handled_by_user_id, detail
         ) VALUES (1, 2, 10, 'galgame', 'merged', '2026-11-04 00:00:00.000', 2, '{}'::jsonb)`
      )
      await holder.query('COMMIT')
      committed = true
    } finally {
      if (!committed) await holder.query('ROLLBACK')
      holder.release()
    }
    await expect(edit).resolves.toEqual({ postId })
    const saved = await query<{ resource_id: number; title: string }>(
      'SELECT resource_id, title FROM help_post WHERE id = $1',
      [postId]
    )
    expect(saved.rows[0]).toEqual({ resource_id: 1, title: '编辑后的标题' })
  }, 30000)
})
