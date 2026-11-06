import pg, { type QueryResultRow } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Real PostgreSQL proof for the handover/reopen lock order. Runs only when
 * KUN_OFFICIAL_MIRROR_B_REOPEN_TEST_DATABASE_URL is exactly the disposable
 * database official_mirror_b_reopen_e2e on 127.0.0.1:55436. It never reads
 * KUN_DATABASE_URL as a fallback.
 */
const databaseUrl =
  process.env.KUN_OFFICIAL_MIRROR_B_REOPEN_TEST_DATABASE_URL?.trim()

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

const assertDisposableUrl = (value: string) => {
  const parsed = new URL(value)
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('reopen proof database must use postgresql')
  }
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55436') {
    throw new Error('reopen proof database must be 127.0.0.1:55436')
  }
  if (
    parsed.username !== 'official_mirror_b' ||
    name !== 'official_mirror_b_reopen_e2e'
  ) {
    throw new Error(
      'reopen proof database must be official_mirror_b_reopen_e2e'
    )
  }
  if (
    /official_mirror_a|official_mirror_c|official_mirror_d|touchgal|otoame_prod|55432|55433|55435/i.test(
      `${parsed.hostname}:${parsed.port}/${name}/${parsed.username}`
    )
  ) {
    throw new Error('reopen proof database points at a forbidden target')
  }
  return value
}

const now = new Date('2026-11-04T00:00:00.000Z')
const withinWindow = new Date('2026-11-03T00:00:00.000Z')
const outsideWindow = new Date('2026-10-01T00:00:00.000Z')

describe.skipIf(!databaseUrl)(
  'official mirror handover reopen race on disposable Postgres',
  () => {
    if (!databaseUrl) return
    const url = assertDisposableUrl(databaseUrl)
    const pool = new pg.Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 5000
    })
    let prisma: Awaited<typeof import('~/prisma/index')>['prisma']
    let disconnect: Awaited<
      typeof import('~/prisma/index')
    >['disconnectPrismaAdapter']
    let reopenCase: Awaited<
      typeof import('~/app/api/case/service')
    >['reopenCase']
    let transferPublisherCasesOnHandover: Awaited<
      typeof import('~/app/api/case/service')
    >['transferPublisherCasesOnHandover']

    const query = async <T extends QueryResultRow>(
      text: string,
      values: unknown[] = []
    ) => pool.query<T>(text, values)

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

    const seed = async (closedAt: Date, reopenedCount = 0) => {
      const publisher = await prisma.user.create({
        data: {
          name: 'bpub',
          email: 'bpub@reopen.e2e',
          password: 'not-used',
          role: 2
        }
      })
      const reporter = await prisma.user.create({
        data: {
          name: 'breport',
          email: 'breport@reopen.e2e',
          password: 'not-used',
          role: 1
        }
      })
      const staff = await prisma.user.create({
        data: {
          name: 'bstaff',
          email: 'bstaff@reopen.e2e',
          password: 'not-used',
          role: 3
        }
      })
      const follower = await prisma.user.create({
        data: {
          name: 'bfollow',
          email: 'bfollow@reopen.e2e',
          password: 'not-used',
          role: 1
        }
      })
      const patch = await prisma.patch.create({
        data: {
          unique_id: 'b0000001',
          name: '条目',
          user_id: publisher.id,
          type: [],
          language: [],
          engine: [],
          platform: []
        }
      })
      const resource = await prisma.patch_resource.create({
        data: {
          patch_id: patch.id,
          user_id: publisher.id,
          section: 'galgame',
          name: '卡片',
          type: [],
          language: [],
          platform: [],
          publisher_left_at: null
        }
      })
      const created = await prisma.ops_case.create({
        data: {
          kind: 'resource_mismatch',
          target_type: 'resource',
          target_id: resource.id,
          patch_id: patch.id,
          reporter_id: reporter.id,
          owner_type: 'publisher',
          owner_id: publisher.id,
          status: 'resolved',
          resolution: 'repaired',
          public: false,
          source: 'user',
          closed_at: closedAt,
          reopened_count: reopenedCount,
          revision: 1,
          status_changed_at: closedAt,
          queue_entered_at: closedAt
        }
      })
      await prisma.ops_case_subscriber.create({
        data: { case_id: created.id, user_id: follower.id }
      })
      return {
        caseId: created.id,
        resourceId: resource.id,
        reporterId: reporter.id,
        publisherId: publisher.id,
        staffId: staff.id,
        followerId: follower.id
      }
    }

    const commitHandover = async (resourceId: number) => {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM patch_resource WHERE id = ${resourceId} FOR UPDATE
          `
          const marked = await tx.patch_resource.updateMany({
            where: { id: resourceId, publisher_left_at: null },
            data: { publisher_left_at: now, updated: now }
          })
          if (marked.count !== 1) {
            throw new Error('handover did not mark the resource')
          }
          await transferPublisherCasesOnHandover(tx, resourceId, now)
        },
        { timeout: 20000, maxWait: 5000 }
      )
    }

    const readState = async (caseId: number, resourceId: number) => {
      const [row, resource, subscribers, messages, notices] = await Promise.all(
        [
          prisma.ops_case.findUniqueOrThrow({ where: { id: caseId } }),
          prisma.patch_resource.findUniqueOrThrow({ where: { id: resourceId } }),
          prisma.ops_case_subscriber.findMany({ where: { case_id: caseId } }),
          prisma.ops_case_message.findMany({
            where: { case_id: caseId },
            orderBy: { id: 'asc' }
          }),
          prisma.user_message.findMany({ orderBy: { id: 'asc' } })
        ]
      )
      return { row, resource, subscribers, messages, notices }
    }

    const waitForResourceLock = async () => {
      const started = Date.now()
      while (Date.now() - started < 3000) {
        const waiting = await query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND wait_event_type = 'Lock'`
        )
        if (waiting.rows.length > 0) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('reopen did not wait on the resource lock')
    }

    beforeAll(async () => {
      const identity = await query<{ db: string; usr: string }>(
        'SELECT current_database() AS db, current_user AS usr'
      )
      if (
        identity.rows[0]?.db !== 'official_mirror_b_reopen_e2e' ||
        identity.rows[0]?.usr !== 'official_mirror_b'
      ) {
        throw new Error('connected database is not the reopen proof database')
      }
      const column = await query<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'patch_resource'
           AND column_name = 'publisher_left_at'`
      )
      if (column.rows[0]?.data_type !== 'timestamp without time zone') {
        throw new Error('publisher_left_at is not timestamp without time zone')
      }
      process.env.KUN_DATABASE_URL = url
      process.env.REDIS_HOST = '127.0.0.1'
      process.env.REDIS_PORT = '1'
      process.env.REDIS_PASSWORD = ''
      const prismaModule = await import('~/prisma/index')
      prisma = prismaModule.prisma
      disconnect = prismaModule.disconnectPrismaAdapter
      const caseModule = await import('~/app/api/case/service')
      reopenCase = caseModule.reopenCase
      transferPublisherCasesOnHandover =
        caseModule.transferPublisherCasesOnHandover
    }, 30000)

    beforeEach(async () => {
      await wipe()
    })

    afterAll(async () => {
      if (disconnect) await disconnect()
      await pool.end()
    })

    it('opens onto staff when handover commits left while reopen waits on the resource', async () => {
      const seeded = await seed(withinWindow)
      let releaseWrite: () => void = () => undefined
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      let markLocked: () => void = () => undefined
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve
      })
      const handover = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM patch_resource WHERE id = ${seeded.resourceId} FOR UPDATE
          `
          markLocked()
          await writeGate
          const marked = await tx.patch_resource.updateMany({
            where: { id: seeded.resourceId, publisher_left_at: null },
            data: { publisher_left_at: now, updated: now }
          })
          if (marked.count !== 1) {
            throw new Error('handover did not mark the resource')
          }
          await transferPublisherCasesOnHandover(tx, seeded.resourceId, now)
        },
        { timeout: 20000, maxWait: 5000 }
      )
      await locked
      const reopening = reopenCase(seeded.caseId, seeded.reporterId, '请继续处理', {
        now,
        db: prisma
      })
      const finishedFirst = await Promise.race([
        waitForResourceLock().then(() => 'waiting' as const),
        reopening.then(() => 'finished' as const)
      ])
      expect(finishedFirst).toBe('waiting')
      const blocked = await readState(seeded.caseId, seeded.resourceId)
      expect(blocked.row.status).toBe('resolved')
      expect(blocked.row.owner_type).toBe('publisher')
      expect(blocked.row.owner_id).toBe(seeded.publisherId)
      expect(blocked.resource.publisher_left_at).toBeNull()
      releaseWrite()
      await handover
      const result = await reopening
      expect(result).toMatchObject({ changed: true })
      const finalState = await readState(seeded.caseId, seeded.resourceId)
      expect(finalState.row.status).toBe('open')
      expect(finalState.row.owner_type).toBe('staff')
      expect(finalState.row.owner_id).toBeNull()
      expect(finalState.row.reopened_count).toBe(1)
      expect(finalState.resource.publisher_left_at).toEqual(now)
      expect(finalState.messages.map((message) => message.body)).toEqual([
        '问题已重新提交，处理方会继续跟进。',
        '请继续处理'
      ])
      expect(
        finalState.messages.some((message) => message.event === 'escalated')
      ).toBe(false)
      expect(finalState.subscribers.map((row) => row.user_id)).toEqual([
        seeded.followerId
      ])
      expect(finalState.notices.map((notice) => notice.recipient_id)).toEqual([
        seeded.staffId
      ])
      expect(finalState.notices[0]?.content).toContain('重新打开')
      await expect(
        reopenCase(seeded.caseId, seeded.reporterId, '再次重开', {
          now,
          db: prisma
        })
      ).resolves.toBe('当前问题尚未结案')
      const afterSecond = await readState(seeded.caseId, seeded.resourceId)
      expect(afterSecond.row.status).toBe('open')
      expect(afterSecond.row.reopened_count).toBe(1)
      expect(afterSecond.row.owner_type).toBe('staff')
      expect(afterSecond.subscribers).toHaveLength(1)
    }, 20000)

    it('lets a later handover move the case reopen already opened for the publisher', async () => {
      const seeded = await seed(withinWindow)
      const result = await reopenCase(
        seeded.caseId,
        seeded.reporterId,
        '请继续处理',
        { now, db: prisma }
      )
      expect(result).toMatchObject({ changed: true })
      const opened = await readState(seeded.caseId, seeded.resourceId)
      expect(opened.row.status).toBe('open')
      expect(opened.row.owner_type).toBe('publisher')
      expect(opened.row.owner_id).toBe(seeded.publisherId)
      expect(opened.row.reopened_count).toBe(1)
      expect(opened.resource.publisher_left_at).toBeNull()
      expect(opened.notices.map((notice) => notice.recipient_id)).toEqual([
        seeded.publisherId
      ])
      expect(opened.subscribers.map((row) => row.user_id)).toEqual([
        seeded.followerId
      ])
      await commitHandover(seeded.resourceId)
      const handed = await readState(seeded.caseId, seeded.resourceId)
      expect(handed.row.status).toBe('open')
      expect(handed.row.owner_type).toBe('staff')
      expect(handed.row.owner_id).toBeNull()
      expect(handed.row.reopened_count).toBe(1)
      expect(handed.resource.publisher_left_at).toEqual(now)
      expect(handed.messages.map((message) => message.event)).toEqual([
        'reopened',
        null,
        'escalated'
      ])
      expect(handed.messages[2]?.body).toBe(
        '发布者已交由站方维护，问题改由网站管理员处理。'
      )
      expect(handed.notices.map((notice) => notice.recipient_id)).toEqual([
        seeded.publisherId
      ])
      expect(handed.subscribers.map((row) => row.user_id)).toEqual([
        seeded.followerId
      ])
    }, 20000)

    it('still refuses a closed case that was already reopened once', async () => {
      const seeded = await seed(withinWindow, 1)
      await expect(
        reopenCase(seeded.caseId, seeded.reporterId, '请继续处理', {
          now,
          db: prisma
        })
      ).resolves.toBe('每个问题只能重开一次')
      const state = await readState(seeded.caseId, seeded.resourceId)
      expect(state.row.status).toBe('resolved')
      expect(state.row.owner_type).toBe('publisher')
      expect(state.row.reopened_count).toBe(1)
      expect(state.resource.publisher_left_at).toBeNull()
      expect(state.messages).toHaveLength(0)
      expect(state.notices).toHaveLength(0)
      expect(state.subscribers.map((row) => row.user_id)).toEqual([
        seeded.followerId
      ])
    }, 20000)

    it('still refuses a case closed for more than 7 days', async () => {
      const seeded = await seed(outsideWindow)
      await expect(
        reopenCase(seeded.caseId, seeded.reporterId, '请继续处理', {
          now,
          db: prisma
        })
      ).resolves.toBe('该问题已超过 7 天，不能重开')
      const state = await readState(seeded.caseId, seeded.resourceId)
      expect(state.row.status).toBe('resolved')
      expect(state.row.owner_type).toBe('publisher')
      expect(state.row.reopened_count).toBe(0)
      expect(state.resource.publisher_left_at).toBeNull()
      expect(state.messages).toHaveLength(0)
      expect(state.notices).toHaveLength(0)
      expect(state.subscribers.map((row) => row.user_id)).toEqual([
        seeded.followerId
      ])
    }, 20000)
  }
)
