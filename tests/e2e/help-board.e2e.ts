/**
 * Help board acceptance (module 07, E07-01 to E07-04) against a production
 * build. Every user action goes through the real HTTP API or the browser.
 * The database is used to seed this run's users, games and resource, to
 * check results, and for a few setup steps no user action covers: clearing
 * the run's daily counters, refunding balances, deleting a game and hiding
 * one answer.
 *
 * Run a sole server built from the commit under test, bound to
 * KUN_E2E_DATABASE_URL (a disposable *_e2e database with the help migration
 * applied) and an isolated Redis port. Leave KUN_DATABASE_URL unset or point it
 * elsewhere; the target guard refuses the application database:
 *
 *   KUN_E2E_BASE_URL=http://127.0.0.1:3180 \
 *   KUN_E2E_DATABASE_URL=postgresql://…/help_accept_e2e \
 *   REDIS_PORT=16481 JWT_ISS=… JWT_AUD=… JWT_SECRET=… \
 *   pnpm exec esno tests/e2e/help-board.e2e.ts
 *
 * Optional: KUN_E2E_BROWSER_PATH, KUN_E2E_ARTIFACT_DIR. The script never
 * resets a database; it removes the rows it created when it finishes.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import pg, { type QueryResultRow } from 'pg'
import { chromium, type Browser, type Page } from 'playwright-core'
import { parseE2EDatabaseTarget } from '../../scripts/e2eDatabasePreparation'

const COOKIE = 'kun-galgame-patch-moe-token'
const REDIS_PREFIX = 'kun:touchgal'
const DAY = 86400000

const requireEnv = (name: string) => {
  const value = process.env[name]
  assert(value, `${name} is required`)
  return value
}

const BASE_URL = requireEnv('KUN_E2E_BASE_URL').replace(/\/+$/, '')
assert(
  /^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL),
  'KUN_E2E_BASE_URL must be a local http://127.0.0.1:<port> server'
)
const target = parseE2EDatabaseTarget(
  requireEnv('KUN_E2E_DATABASE_URL'),
  process.env.KUN_DATABASE_URL
)
assert(
  ['127.0.0.1', 'localhost'].includes(target.host),
  'E2E database must be local'
)
const redisPort = Number(requireEnv('REDIS_PORT'))
assert(
  Number.isInteger(redisPort) && redisPort > 0 && redisPort !== 6379,
  'Use an isolated Redis port'
)

const suffix = randomBytes(3).toString('hex')
const artifactDir = resolve(
  process.env.KUN_E2E_ARTIFACT_DIR ?? `/private/tmp/otoame-help-e2e-${suffix}`
)
const db = new pg.Pool({
  connectionString: target.connectionUrl.toString(),
  max: 2,
  connectionTimeoutMillis: 5000
})
const redis = new Redis({
  host: '127.0.0.1',
  port: redisPort,
  lazyConnect: true,
  maxRetriesPerRequest: 1
})

type User = { id: number; name: string; token: string }
const results: { name: string; milliseconds: number }[] = []
const pageErrors: string[] = []
const created = { users: [] as number[], patches: [] as number[] }
let browser: Browser | undefined
let currentPage: Page | undefined

const check = async (name: string, run: () => Promise<void>) => {
  const started = Date.now()
  await run()
  results.push({ name, milliseconds: Date.now() - started })
  console.log(`PASS ${name}`)
}

const one = async <T extends QueryResultRow>(
  sql: string,
  values: unknown[] = []
) => {
  const result = await db.query<T>(sql, values)
  assert.equal(result.rows.length, 1, `expected one row: ${sql}`)
  return result.rows[0]
}

const balance = async (uid: number) =>
  Number(
    (
      await one<{ moemoepoint: number }>(
        'SELECT moemoepoint FROM public."user" WHERE id = $1',
        [uid]
      )
    ).moemoepoint
  )

const seedUser = async (
  tag: string,
  options: { days?: number; points?: number; role?: number } = {}
): Promise<User> => {
  const name = `h${tag}${suffix}`.slice(0, 17)
  const row = await one<{ id: number }>(
    `INSERT INTO public."user"
       (name, email, password, role, moemoepoint, register_time, enable_email_notice, updated)
     VALUES ($1, $2, 'not-used', $3, $4, $5, false, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      name,
      `${name}@example.invalid`,
      options.role ?? 1,
      options.points ?? 100,
      new Date(Date.now() - (options.days ?? 30) * DAY)
    ]
  )
  created.users.push(row.id)
  const role = options.role ?? 1
  const jti = randomUUID()
  const token = jwt.sign(
    {
      iss: requireEnv('JWT_ISS'),
      aud: requireEnv('JWT_AUD'),
      jti,
      uid: row.id,
      name,
      role
    },
    requireEnv('JWT_SECRET'),
    { expiresIn: '1h' }
  )
  const now = Date.now()
  await redis.setex(
    `${REDIS_PREFIX}:access:session:${row.id}:${jti}`,
    3600,
    JSON.stringify({ uid: row.id, jti, name, role, createdAt: now })
  )
  await redis.zadd(`${REDIS_PREFIX}:access:sessions:${row.id}`, now, jti)
  return { id: row.id, name, token }
}

const api = async <T = unknown>(
  method: string,
  path: string,
  user: User | null,
  body?: unknown
) => {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'kun-fetch',
      origin: BASE_URL,
      ...(user ? { cookie: `${COOKIE}=${user.token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  assert(response.status < 500, `${method} ${path} -> ${response.status}`)
  return (await response.json()) as T
}

// The daily limit is proven once below; other scenarios post more than three
// times, so the run clears its own day counter before each post.
const resetDay = (uid: number) =>
  db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [uid])

const post = async (
  user: User,
  body: Record<string, unknown> = {},
  requestId = randomUUID(),
  options: { keepDay?: boolean } = {}
) => {
  if (!options.keepDay) await resetDay(user.id)
  return postRaw(user, body, requestId)
}

const postRaw = (
  user: User,
  body: Record<string, unknown>,
  requestId: string
) =>
  api<{ postId: number } | string>('POST', '/help/post', user, {
    requestId,
    category: 'runtime',
    title: `验收求助 ${suffix}`,
    content: '系统 Windows 11，启动后黑屏，已装运行库',
    ...body
  })

const postId = (value: { postId: number } | string) => {
  assert.equal(typeof value, 'object', `post failed: ${String(value)}`)
  return (value as { postId: number }).postId
}

const answer = async (user: User, id: number, content = '更新显卡驱动试试') => {
  const result = await api<{ answerId: number } | string>(
    'POST',
    '/help/answer',
    user,
    { postId: id, requestId: randomUUID(), content }
  )
  assert.equal(typeof result, 'object', `answer failed: ${String(result)}`)
  return (result as { answerId: number }).answerId
}

const report = (user: User, targetType: string, targetId: number) =>
  api<Record<string, unknown> | string>('POST', '/case', user, {
    kind: 'content_violation',
    targetType,
    targetId,
    content: '这条内容在打广告，留联系方式引流'
  })

const main = async () => {
  await mkdir(artifactDir, { recursive: true })
  const identity = await one<{ database: string }>(
    'SELECT current_database() AS database'
  )
  assert.equal(identity.database, target.databaseName)

  const asker = await seedUser('ask')
  const answerer = await seedUser('ans', { points: 20 })
  const other = await seedUser('oth', { points: 20 })
  const newcomer = await seedUser('new', { days: 1, points: 20 })
  const admin = await seedUser('adm', { role: 3 })
  const reporters = await Promise.all(
    [1, 2, 3].map((n) => seedUser(`r${n}`, { points: 0 }))
  )
  const youngReporter = await seedUser('ry', { days: 2, points: 0 })

  const sfw = await one<{ id: number; unique_id: string }>(
    `INSERT INTO public.patch (unique_id, name, content_limit, user_id, type, language, engine, platform, updated)
     VALUES ($1, $2, 'sfw', $3, '{}', '{}', '{}', '{}', CURRENT_TIMESTAMP) RETURNING id, unique_id`,
    [`hs${suffix}`.padEnd(8, '0').slice(0, 8), `验收游戏 ${suffix}`, admin.id]
  )
  const nsfw = await one<{ id: number; unique_id: string }>(
    `INSERT INTO public.patch (unique_id, name, content_limit, user_id, type, language, engine, platform, updated)
     VALUES ($1, $2, 'nsfw', $3, '{}', '{}', '{}', '{}', CURRENT_TIMESTAMP) RETURNING id, unique_id`,
    [
      `hn${suffix}`.padEnd(8, '0').slice(0, 8),
      `验收成人游戏 ${suffix}`,
      admin.id
    ]
  )
  created.patches.push(sfw.id, nsfw.id)
  const resource = await one<{ id: number }>(
    `INSERT INTO public.patch_resource (patch_id, user_id, name, section, type, language, platform, status, updated)
     VALUES ($1, $2, $3, 'galgame', '{pc}', '{zh-Hans}', '{windows}', 0, CURRENT_TIMESTAMP) RETURNING id`,
    [sfw.id, other.id, `验收资源 ${suffix}`]
  )

  await check(
    'server reads this run’s fixture from the isolated database',
    async () => {
      const list = await api<{ total: number } | string>(
        'GET',
        '/help?page=1&limit=1',
        null
      )
      assert.equal(typeof list, 'object')
      const sidebar = await api<{ mine: unknown }>(
        'GET',
        '/help/sidebar',
        asker
      )
      assert.ok(sidebar.mine, 'session from isolated Redis is accepted')
    }
  )

  // ---- E07-01: categories, links, invalid links, deleted targets, visibility
  const byCategory: Record<string, number> = {}
  await check(
    'E07-01 every category accepts a post; daily limit holds at 3',
    async () => {
      const categories = [
        'request',
        'runtime',
        'download',
        'account',
        'recommend',
        'other'
      ]
      for (const category of categories) {
        byCategory[category] = postId(
          await post(asker, { category, title: `分类 ${category} ${suffix}` })
        )
      }
      // Three posts in one Shanghai day, then the fourth is refused.
      await resetDay(asker.id)
      for (const n of [1, 2, 3]) {
        postId(
          await post(asker, { title: `限额 ${n} ${suffix}` }, randomUUID(), {
            keepDay: true
          })
        )
      }
      const before = await balance(asker.id)
      assert.match(
        String(
          await post(asker, { title: `超额 ${suffix}` }, randomUUID(), {
            keepDay: true
          })
        ),
        /最多发布 3 条/
      )
      assert.equal(
        await balance(asker.id),
        before,
        'refused post is not charged'
      )
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  let linkedId = 0
  let nameOnlyId = 0
  let nsfwId = 0
  await check(
    'E07-01 three link modes save; invalid links are refused',
    async () => {
      linkedId = postId(
        await post(asker, { patchId: sfw.id, resourceId: resource.id })
      )
      nameOnlyId = postId(
        await post(asker, {
          category: 'request',
          gameName: '月下的约定',
          gameLinks: ['https://vndb.org/v12345', 'https://bgm.tv/subject/9876']
        })
      )
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
      nsfwId = postId(await post(asker, { patchId: nsfw.id }))
      const notice = await one<{ count: string }>(
        `SELECT COUNT(*) FROM public.user_message WHERE recipient_id = $1 AND link = $2`,
        [other.id, `/help/${linkedId}`]
      )
      assert.equal(
        Number(notice.count),
        1,
        'resource publisher was notified once'
      )
      for (const bad of [
        { patchId: 99999999 },
        { resourceId: resource.id },
        { patchId: nsfw.id, resourceId: resource.id },
        { patchId: sfw.id, gameName: '冲突' },
        { gameName: 'x', gameLinks: ['javascript:alert(1)'] },
        { gameLinks: ['https://vndb.org/v1'] }
      ]) {
        assert.equal(
          typeof (await post(asker, bad)),
          'string',
          `refused ${JSON.stringify(bad)}`
        )
      }
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  await check(
    'E07-01 visibility: guests without NSFW never see the NSFW post',
    async () => {
      const list = await api<{ posts: { id: number }[] }>(
        'GET',
        '/help?page=1&limit=50',
        null
      )
      const ids = list.posts.map((p) => p.id)
      assert(ids.includes(linkedId) && !ids.includes(nsfwId))
      assert.equal(
        typeof (await api('GET', `/help/post?postId=${nsfwId}`, null)),
        'string'
      )
      const similar = await api<{ id: number }[]>(
        'GET',
        `/help/similar?patchId=${nsfw.id}`,
        null
      )
      assert(!similar.some((p) => p.id === nsfwId))
    }
  )

  await check(
    'E07-01 deleting the linked game keeps the post as unlinked',
    async () => {
      const temp = await one<{ id: number; unique_id: string }>(
        `INSERT INTO public.patch (unique_id, name, content_limit, user_id, type, language, engine, platform, updated)
       VALUES ($1, $2, 'sfw', $3, '{}', '{}', '{}', '{}', CURRENT_TIMESTAMP) RETURNING id, unique_id`,
        [
          `ht${suffix}`.padEnd(8, '0').slice(0, 8),
          `临时游戏 ${suffix}`,
          admin.id
        ]
      )
      const id = postId(await post(asker, { patchId: temp.id }))
      await db.query('DELETE FROM public.patch WHERE id = $1', [temp.id])
      const detail = await api<{ patch: unknown; title: string } | string>(
        'GET',
        `/help/post?postId=${id}`,
        null
      )
      assert.equal(typeof detail, 'object', 'post still opens')
      assert.equal((detail as { patch: unknown }).patch, null)
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  // ---- E07-02: fee, reward once, eligibility, concurrency, ledger
  await check(
    'E07-02 fee charged once under three concurrent replays',
    async () => {
      await resetDay(asker.id)
      const before = await balance(asker.id)
      const requestId = randomUUID()
      // Concurrent replays must not each clear the day counter mid-flight.
      const replies = await Promise.all(
        [1, 2, 3].map(() =>
          post(asker, { title: `重放 ${suffix}` }, requestId, { keepDay: true })
        )
      )
      const ids = new Set(replies.map(postId))
      assert.equal(ids.size, 1)
      assert.equal(await balance(asker.id), before - 5)
      const ledger = await one<{ count: string }>(
        'SELECT COUNT(*) FROM public.user_moemoepoint_ledger WHERE idempotency_key = $1',
        [`help:${[...ids][0]}:post-fee`]
      )
      assert.equal(Number(ledger.count), 1)
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  await check(
    'E07-02 insufficient balance refuses without charging',
    async () => {
      await db.query('UPDATE public."user" SET moemoepoint = 4 WHERE id = $1', [
        newcomer.id
      ])
      assert.match(String(await post(newcomer)), /可用萌萌点不足/)
      assert.equal(await balance(newcomer.id), 4)
      await db.query(
        'UPDATE public."user" SET moemoepoint = 20 WHERE id = $1',
        [newcomer.id]
      )
    }
  )

  let rewardPost = 0
  let a1 = 0
  let a2 = 0
  await check(
    'E07-02 concurrent accept/change/cancel rewards exactly once',
    async () => {
      rewardPost = postId(await post(asker, { title: `采纳并发 ${suffix}` }))
      a1 = await answer(answerer, rewardPost)
      a2 = await answer(other, rewardPost, '换成日区运行')
      const before = (await balance(answerer.id)) + (await balance(other.id))
      await Promise.all([
        api('POST', '/help/accept', asker, {
          postId: rewardPost,
          answerId: a1
        }),
        api('POST', '/help/accept', asker, {
          postId: rewardPost,
          answerId: a2
        }),
        api('POST', '/help/accept', asker, {
          postId: rewardPost,
          answerId: null
        }),
        api('POST', '/help/accept', asker, { postId: rewardPost, answerId: a1 })
      ])
      for (const target of [a2, null, a1]) {
        await api('POST', '/help/accept', asker, {
          postId: rewardPost,
          answerId: target
        })
      }
      const after = (await balance(answerer.id)) + (await balance(other.id))
      assert.equal(after - before, 3, 'one 3-point reward in total')
      const rows = await one<{ count: string }>(
        'SELECT COUNT(*) FROM public.user_moemoepoint_ledger WHERE idempotency_key = $1',
        [`help:${rewardPost}:answer-reward`]
      )
      assert.equal(Number(rows.count), 1)
      const state = await one<{ status: string; accepted_answer_id: number }>(
        'SELECT status, accepted_answer_id FROM public.help_post WHERE id = $1',
        [rewardPost]
      )
      assert.deepEqual(state, { status: 'solved', accepted_answer_id: a1 })
    }
  )

  await check(
    'E07-02 newcomer acceptance pays nothing and keeps the slot open',
    async () => {
      const id = postId(await post(asker, { title: `资格 ${suffix}` }))
      const young = await answer(newcomer, id)
      const veteran = await answer(answerer, id, '我来回答')
      const before = await balance(answerer.id)
      const first = await api<{ rewarded: boolean }>(
        'POST',
        '/help/accept',
        asker,
        { postId: id, answerId: young }
      )
      const second = await api<{ rewarded: boolean }>(
        'POST',
        '/help/accept',
        asker,
        { postId: id, answerId: veteran }
      )
      assert.equal(first.rewarded, false)
      assert.equal(second.rewarded, true)
      assert.equal(await balance(answerer.id), before + 3)
      assert.equal(await balance(newcomer.id), 20)
    }
  )

  await check(
    'E07-02 balances match the ledger for every test user',
    async () => {
      for (const uid of created.users) {
        const row = await one<{
          total: number
          ledger: string
          first: number | null
        }>(
          `SELECT u.moemoepoint AS total,
                COALESCE(SUM(l.balance_delta), 0) AS ledger,
                (SELECT balance_after - balance_delta FROM public.user_moemoepoint_ledger WHERE user_id = u.id ORDER BY id LIMIT 1) AS first
         FROM public."user" u LEFT JOIN public.user_moemoepoint_ledger l ON l.user_id = u.id
         WHERE u.id = $1 GROUP BY u.id`,
          [uid]
        )
        if (row.first === null) continue
        assert.equal(
          Number(row.first) + Number(row.ledger),
          Number(row.total),
          `ledger for ${uid}`
        )
      }
    }
  )

  // ---- E07-03: edit/delete limits, concurrency, reports
  await check(
    'E07-03 delete only while nobody else answered; race with a new answer is decided once',
    async () => {
      const lonely = postId(await post(asker, { title: `可删 ${suffix}` }))
      await answer(asker, lonely, '自己补充一句')
      assert.deepEqual(
        await api('DELETE', `/help/post?postId=${lonely}`, asker),
        { postId: lonely }
      )
      assert.equal(
        typeof (await api('GET', `/help/post?postId=${lonely}`, null)),
        'string'
      )

      const raced = postId(await post(asker, { title: `竞争 ${suffix}` }))
      const [del, ans] = await Promise.all([
        api<{ postId: number } | string>(
          'DELETE',
          `/help/post?postId=${raced}`,
          asker
        ),
        api<{ answerId: number } | string>('POST', '/help/answer', answerer, {
          postId: raced,
          requestId: randomUUID(),
          content: '抢在删帖前回答'
        })
      ])
      const row = await one<{ deleted: boolean; answers: string }>(
        `SELECT p.deleted_at IS NOT NULL AS deleted,
              (SELECT COUNT(*) FROM public.help_answer a WHERE a.post_id = p.id) AS answers
       FROM public.help_post p WHERE p.id = $1`,
        [raced]
      )
      const deleted = typeof del === 'object'
      const answered = typeof ans === 'object'
      assert.notEqual(deleted, answered, 'exactly one side wins')
      assert.equal(row.deleted, deleted)
      assert.equal(Number(row.answers) > 0, answered)
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  await check(
    'E07-03 accepted answers cannot be deleted; only authors edit',
    async () => {
      assert.match(
        String(await api('DELETE', `/help/answer?answerId=${a1}`, answerer)),
        /已被采纳/
      )
      assert.equal(
        typeof (await api('PUT', '/help/answer', other, {
          answerId: a1,
          content: '改别人的'
        })),
        'string'
      )
      assert.equal(
        typeof (await api('PUT', '/help/answer', answerer, {
          answerId: a1,
          content: '补充说明'
        })),
        'object'
      )
      assert.equal(
        typeof (await api('PUT', '/help/post', other, {
          postId: rewardPost,
          category: 'runtime',
          title: '改别人的帖子',
          content: '这不是我的帖子内容'
        })),
        'string'
      )
    }
  )

  let reportedCase = 0
  await check(
    'E07-03 three eligible reporters hide; a 2-day account does not count',
    async () => {
      const id = postId(await post(asker, { title: `被举报 ${suffix}` }))
      await report(youngReporter, 'help', id)
      await report(reporters[0], 'help', id)
      await report(reporters[1], 'help', id)
      let row = await one<{ hidden: boolean }>(
        'SELECT hidden_at IS NOT NULL AS hidden FROM public.help_post WHERE id = $1',
        [id]
      )
      assert.equal(row.hidden, false, 'two eligible + one young do not hide')
      await report(reporters[2], 'help', id)
      row = await one<{ hidden: boolean }>(
        'SELECT hidden_at IS NOT NULL AS hidden FROM public.help_post WHERE id = $1',
        [id]
      )
      assert.equal(row.hidden, true)
      const kase = await one<{ id: number; status: string }>(
        `SELECT id, status FROM public.ops_case WHERE target_type = 'help' AND target_id = $1`,
        [id]
      )
      assert.equal(
        kase.status,
        'open',
        'temporary hide does not close the case'
      )
      reportedCase = kase.id
      assert.equal(
        typeof (await api('GET', `/help/post?postId=${id}`, null)),
        'string',
        'guests cannot open it'
      )
      assert.equal(
        typeof (await api('GET', `/help/post?postId=${id}`, asker)),
        'object',
        'the asker still can'
      )
      assert.match(String(await report(asker, 'help', id)), /不能举报自己/)

      const blocked = await api<unknown>(
        'POST',
        `/admin/case/${reportedCase}/handle`,
        admin,
        {
          action: 'resolve',
          resolution: 'not_established',
          content: '不构成违规'
        }
      )
      assert.match(JSON.stringify(blocked), /隐藏中的求助内容/)
      const restored = await api<{ changed?: boolean }>(
        'POST',
        `/admin/case/${reportedCase}/content`,
        admin,
        {
          action: 'restore',
          content: ''
        }
      )
      assert.equal(restored.changed, true)
      row = await one<{ hidden: boolean }>(
        'SELECT hidden_at IS NOT NULL AS hidden FROM public.help_post WHERE id = $1',
        [id]
      )
      assert.equal(row.hidden, false, '不成立 restores the post')

      await report(reporters[0], 'help', id)
      const rounds = await one<{ count: string }>(
        `SELECT COUNT(*) FROM public.ops_case WHERE target_type = 'help' AND target_id = $1`,
        [id]
      )
      assert.equal(Number(rounds.count), 2, 'a new round opens a new case')
      row = await one<{ hidden: boolean }>(
        'SELECT hidden_at IS NOT NULL AS hidden FROM public.help_post WHERE id = $1',
        [id]
      )
      assert.equal(
        row.hidden,
        false,
        'old reports do not count toward the new round'
      )

      const kase2 = await one<{ id: number }>(
        `SELECT id FROM public.ops_case WHERE target_type = 'help' AND target_id = $1 AND status = 'open'`,
        [id]
      )
      const hidden = await api<{ changed?: boolean }>(
        'POST',
        `/admin/case/${kase2.id}/content`,
        admin,
        {
          action: 'hide',
          content: '确认违规'
        }
      )
      assert.equal(hidden.changed, true)
      const closed = await one<{ status: string; resolution: string }>(
        'SELECT status, resolution FROM public.ops_case WHERE id = $1',
        [kase2.id]
      )
      assert.deepEqual(closed, {
        status: 'resolved',
        resolution: 'violation_hidden'
      })
      await db.query('DELETE FROM public.help_daily_quota WHERE user_id = $1', [
        asker.id
      ])
    }
  )

  await check(
    'E07-03 replies under hidden answers are refused; reply reports are accepted',
    async () => {
      const id = postId(await post(asker, { title: `楼中楼 ${suffix}` }))
      const ans = await answer(answerer, id)
      const reply = await api<{ replyId: number }>(
        'POST',
        '/help/reply',
        asker,
        {
          answerId: ans,
          requestId: randomUUID(),
          content: '还是黑屏',
          replyToUserId: answerer.id
        }
      )
      assert.equal(typeof reply, 'object')
      assert.equal(
        typeof (await report(other, 'help_reply', reply.replyId)),
        'object'
      )
      await db.query(
        'UPDATE public.help_answer SET hidden_at = now() WHERE id = $1',
        [ans]
      )
      assert.match(
        String(
          await api('POST', '/help/reply', other, {
            answerId: ans,
            requestId: randomUUID(),
            content: '再追问'
          })
        ),
        /已被隐藏/
      )
    }
  )

  // ---- E07-04: browser flows, desktop and 390px
  // Earlier scenarios spent the asker's points; the browser flow starts funded.
  await db.query(
    'UPDATE public."user" SET moemoepoint = 100 WHERE id = ANY($1)',
    [[asker.id, answerer.id, other.id]]
  )
  browser = await chromium.launch({
    executablePath:
      process.env.KUN_E2E_BROWSER_PATH ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  })
  for (const viewport of [
    { width: 1341, height: 1188, tag: 'desktop' },
    { width: 390, height: 844, tag: '390px' }
  ]) {
    await check(
      `E07-04 ${viewport.tag}: post, answer, reply, accept, change, report in the browser`,
      async () => {
        await db.query(
          'DELETE FROM public.help_daily_quota WHERE user_id IN ($1, $2)',
          [asker.id, answerer.id]
        )
        const open = async (user: User) => {
          const context = await browser!.newContext({ viewport })
          await context.route('**/*', (route) =>
            new URL(route.request().url()).hostname === '127.0.0.1'
              ? route.continue()
              : route.abort()
          )
          await context.addCookies([
            { name: COOKIE, value: user.token, url: BASE_URL }
          ])
          const page = await context.newPage()
          page.on('pageerror', (error) =>
            pageErrors.push(`${viewport.tag}: ${error.message}`)
          )
          currentPage = page
          return page
        }
        const page = await open(asker)
        await page.goto(`${BASE_URL}/help/create`)
        await page.getByRole('button', { name: /分类/ }).first().click()
        await page.getByRole('option', { name: /运行问题/ }).click()
        await page.getByRole('tab', { name: '不关联' }).click()
        const title = `浏览器 ${viewport.tag} ${suffix}`
        await page.getByRole('textbox', { name: /^标题/ }).fill(title)
        await page
          .locator('.kun-editor textarea')
          .first()
          .fill('浏览器验收：启动后黑屏，Windows 11')
        await page.getByRole('button', { name: /发布（5 萌萌点）/ }).click()
        await page.waitForURL(/\/help\/\d+$/, { timeout: 15000 })
        const id = Number(page.url().split('/').pop())

        const answerPage = await open(answerer)
        await answerPage.goto(`${BASE_URL}/help/${id}`)
        await answerPage
          .locator('.kun-editor textarea')
          .last()
          .fill('浏览器回答：更新显卡驱动')
        await answerPage.getByRole('button', { name: '发布回答' }).click()
        await answerPage
          .getByText('浏览器回答：更新显卡驱动')
          .waitFor({ timeout: 10000 })
        const overflow = await answerPage.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
        assert(overflow <= 0, `no horizontal scroll (${overflow})`)

        const otherPage = await open(other)
        await otherPage.goto(`${BASE_URL}/help/${id}`)
        await otherPage.getByText('浏览器回答：更新显卡驱动').waitFor()
        await otherPage
          .locator('[id^="answer-"]')
          .first()
          .getByRole('button', { name: '回复', exact: true })
          .first()
          .click()
        await otherPage.getByLabel('写回复').fill('浏览器回复：我也一样')
        await otherPage.getByRole('button', { name: '发布回复' }).click()
        await otherPage
          .getByText('浏览器回复：我也一样')
          .waitFor({ timeout: 10000 })
        await otherPage.getByRole('button', { name: /^关注此帖/ }).click()
        await otherPage
          .getByRole('button', { name: /^已关注此帖/ })
          .waitFor({ timeout: 10000 })

        await page.reload()
        await page
          .getByText('已有他人回答，不能删除')
          .waitFor({ timeout: 10000 })
        await page.getByRole('button', { name: '采纳', exact: true }).click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: '确认' })
          .click()
        await page.getByText('已采纳').first().waitFor({ timeout: 10000 })
        const solved = await one<{ status: string }>(
          'SELECT status FROM public.help_post WHERE id = $1',
          [id]
        )
        assert.equal(solved.status, 'solved')
        const followerNotice = await one<{ count: string }>(
          `SELECT COUNT(*) FROM public.user_message WHERE recipient_id = $1 AND content LIKE '%已解决'`,
          [other.id]
        )
        assert(Number(followerNotice.count) >= 1, 'follower notified of solved')

        await page.getByRole('button', { name: '取消采纳' }).click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: '确认' })
          .click()
        await page
          .getByRole('button', { name: '采纳', exact: true })
          .waitFor({ timeout: 10000 })

        await otherPage.goto(`${BASE_URL}/help/${id}`)
        await otherPage
          .locator('[id^="answer-"]')
          .first()
          .getByRole('button', { name: '举报' })
          .click()
        await otherPage
          .getByLabel('举报原因')
          .fill('浏览器举报：这条回答疑似广告')
        const submitted = otherPage.waitForResponse(
          (response) =>
            response.url().endsWith('/api/case') &&
            response.request().method() === 'POST'
        )
        await otherPage
          .getByRole('dialog')
          .getByRole('button', { name: /提交/ })
          .click()
        const reportResponse = await (await submitted).json()
        assert.equal(
          typeof reportResponse,
          'object',
          `report via the browser: ${JSON.stringify(reportResponse)}`
        )
        const kase = await one<{ count: string }>(
          `SELECT COUNT(*) FROM public.ops_case WHERE target_type = 'help_answer' AND reporter_id = $1`,
          [other.id]
        )
        assert(Number(kase.count) >= 1)
        await page.screenshot({
          path: resolve(artifactDir, `${viewport.tag}-detail.png`),
          fullPage: true
        })
        for (const p of [page, answerPage, otherPage]) await p.context().close()
      }
    )
  }

  await check(
    'E07-04 D40 entries still submit cases; the old home page still renders',
    async () => {
      const kase = await api<Record<string, unknown> | string>(
        'POST',
        '/case',
        answerer,
        {
          kind: 'resource_runtime',
          targetType: 'resource',
          targetId: resource.id,
          content: '解压后运行报错，缺少 dll 文件'
        }
      )
      assert.equal(
        typeof kase,
        'object',
        `D40 runtime case: ${JSON.stringify(kase)}`
      )
      const home = await fetch(`${BASE_URL}/`)
      assert.equal(home.status, 200)
      const html = await home.text()
      assert(html.includes('href="/help"'), 'home exposes the help entry')
    }
  )
}

let failure: unknown
try {
  await redis.connect()
  await main()
} catch (error) {
  failure = error
  console.error(error instanceof Error ? error.stack : 'E2E failed')
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .screenshot({ path: resolve(artifactDir, 'failure.png'), fullPage: true })
      .catch(() => {})
  }
} finally {
  await browser?.close()
  if (created.users.length) {
    await db.query(
      `DELETE FROM public.ops_case WHERE target_type LIKE 'help%' AND target_id IN
         (SELECT id FROM public.help_post WHERE user_id = ANY($1)
          UNION SELECT id FROM public.help_answer WHERE user_id = ANY($1)
          UNION SELECT id FROM public.help_reply WHERE user_id = ANY($1))`,
      [created.users]
    )
    await db.query('DELETE FROM public.ops_case WHERE reporter_id = ANY($1)', [
      created.users
    ])
    await db.query('DELETE FROM public.help_post WHERE user_id = ANY($1)', [
      created.users
    ])
    await db.query('DELETE FROM public.patch WHERE id = ANY($1)', [
      created.patches
    ])
    await db.query('DELETE FROM public."user" WHERE id = ANY($1)', [
      created.users
    ])
    const keys = await redis.keys(`${REDIS_PREFIX}:access:session*`)
    if (keys.length) await redis.del(...keys)
  }
  redis.disconnect()
  await db.end()
  await writeFile(
    resolve(artifactDir, 'report.json'),
    JSON.stringify(
      {
        passed: !failure,
        error: failure instanceof Error ? failure.message : undefined,
        checks: results,
        pageErrors,
        cleanup: 'test users, posts, cases, games and sessions removed'
      },
      null,
      2
    )
  )
}
if (failure) process.exitCode = 1
else
  console.log(
    `PASS ${results.length} help board checks; artifacts: ${artifactDir}`
  )
