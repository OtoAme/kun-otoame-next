/**
 * Module 06 E browser acceptance against the isolated production server.
 *
 * Requires the disposable database official_mirror_e_ui_e2e on
 * 127.0.0.1:55436, Redis on 127.0.0.1:56380, and the production build on
 * http://127.0.0.1:3100. Missing environment or a flow that does not run
 * exits 1. This file does not read an env file and does not start Next.
 *
 * REAL means the browser called the running server. INTERCEPT means this
 * script changed one ignore response so cacheRefreshed is false after that
 * real write; the following cache retry is not intercepted.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import pg, { type Pool } from 'pg'
import { chromium, type Browser, type Page } from 'playwright-core'

const ORIGIN = 'http://127.0.0.1:3100'
const COOKIE = 'kun-galgame-patch-moe-token'
const REDIS_PREFIX = 'kun:touchgal'
const DATABASE_NAME = 'official_mirror_e_ui_e2e'
const LONG_LINK = `https://example.invalid/${'long-link-'.repeat(24)}`
const ARTIFACT_DIR =
  process.env.KUN_E2E_ARTIFACT_DIR ||
  '/private/tmp/official-mirror-e-ui/artifacts'

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required; refusing to exit 0`)
  }
  return value
}

const redact = (value: string) =>
  value.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://redacted')

type Ids = {
  authorId: number
  adminId: number
  unbacked: { patch: string; resourceId: number }
  rebackup: { patch: string; resourceId: number }
  ignored: { patch: string; resourceId: number }
  highA: Pair
  highB: Pair
  highC: Pair
  manual: Pair
  handover: { patch: string; resourceId: number }
  remove: { patch: string; resourceId: number }
  mobileHandover: { patch: string; resourceId: number }
  mobileRemove: { patch: string; resourceId: number }
  mobileHigh: Pair
}

type Pair = {
  patch: string
  userResourceId: number
  staffResourceId: number
  userName: string
}

const main = async () => {
  const databaseUrl = new URL(requireEnv('KUN_E2E_DATABASE_URL'))
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''))
  assert.equal(databaseUrl.hostname, '127.0.0.1')
  assert.equal(databaseUrl.port, '55436')
  assert.equal(databaseName, DATABASE_NAME)
  if (process.env.KUN_DATABASE_URL === databaseUrl.toString()) {
    throw new Error('E database URL matches KUN_DATABASE_URL')
  }
  const redisUrl = new URL(requireEnv('KUN_E2E_REDIS_URL'))
  assert.equal(redisUrl.hostname, '127.0.0.1')
  assert.equal(redisUrl.port, '56380')
  assert.equal(requireEnv('KUN_E2E_BASE_URL').replace(/\/+$/, ''), ORIGIN)

  const pool = new pg.Pool({
    connectionString: databaseUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5000
  })
  const redis = new Redis(redisUrl.toString(), {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  })
  try {
    const marker = await pool.query<{ database: string }>(
      'SELECT current_database() AS database'
    )
    assert.equal(marker.rows[0]?.database, DATABASE_NAME)
    console.log(`PASS database-marker ${DATABASE_NAME}`)

    const sentinel = await fetch(`${ORIGIN}/api/patch?uniqueId=e2e00001`)
    const sentinelBody = (await sentinel.json()) as { name?: string }
    assert.equal(sentinel.status, 200)
    assert.equal(sentinelBody.name, 'E2E Rewrite Fixture')
    console.log('PASS sentinel anonymous GET /api/patch before any session')

    const ids = await seed(pool)
    const admin = await session(redis, ids.adminId, 'e2e_admin', 4)
    const author = await session(redis, ids.authorId, 'eui_author', 1)
    await mkdir(ARTIFACT_DIR, { recursive: true })

    await layoutPass(browser, admin, ids, 'desktop', { width: 1280, height: 800 })
    await layoutPass(browser, admin, ids, 'mobile', { width: 390, height: 844 })
    await writePass(browser, admin, author, ids, pool)
    await writePassMobile(browser, admin, author, ids, pool)
    console.log(`PASS artifacts ${ARTIFACT_DIR}`)
  } finally {
    await browser.close().catch(() => undefined)
    await redis.quit().catch(() => undefined)
    await pool.end().catch(() => undefined)
  }
}

const session = async (
  redis: Redis,
  uid: number,
  name: string,
  role: number
) => {
  const jti = randomUUID()
  const createdAt = Date.now()
  const token = jwt.sign(
    {
      iss: requireEnv('JWT_ISS'),
      aud: requireEnv('JWT_AUD'),
      jti,
      uid,
      name,
      role
    },
    requireEnv('JWT_SECRET'),
    { expiresIn: '2h' }
  )
  const record = { uid, jti, name, role, createdAt }
  await redis.set(
    `${REDIS_PREFIX}:access:session:${uid}:${jti}`,
    JSON.stringify(record),
    'EX',
    7200
  )
  await redis.zadd(`${REDIS_PREFIX}:access:sessions:${uid}`, createdAt, jti)
  return token
}

const seed = async (pool: Pool): Promise<Ids> => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM public.patch WHERE unique_id LIKE 'e2eui%' OR unique_id LIKE 'e2eu%'`
    )
    const stamp = randomBytes(1).toString('hex')
    const patchUid = (suffix: string) => `e2eu${stamp}${suffix}`
    await client.query(`DELETE FROM public."user" WHERE name = 'eui_author'`)
    const admin = await client.query<{ id: number }>(
      `SELECT id FROM public."user" WHERE name = 'e2e_admin'`
    )
    const adminId = admin.rows[0]?.id
    assert.ok(adminId, 'preparer admin is missing')
    const author = await client.query<{ id: number }>(
      `
        INSERT INTO public."user"
          (name, email, password, role, moemoepoint, enable_email_notice, updated)
        VALUES
          ('eui_author', 'eui_author@example.invalid', 'not-used', 1, 20, false, CURRENT_TIMESTAMP)
        RETURNING id
      `
    )
    const authorId = author.rows[0].id
    const patch = async (uniqueId: string, name: string) => {
      const row = await client.query<{ id: number }>(
        `
          INSERT INTO public.patch
            (unique_id, name, banner, introduction, released, content_limit,
             type, language, engine, platform, user_id, updated)
          VALUES
            ($1, $2, '', 'Disposable official-mirror UI fixture.',
             '2026-11-01', 'sfw', ARRAY[]::varchar[], ARRAY[]::varchar[],
             ARRAY[]::varchar[], ARRAY[]::varchar[], $3, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [uniqueId, name, authorId]
      )
      await client.query(
        `INSERT INTO public.patch_rating_stat (patch_id, updated) VALUES ($1, CURRENT_TIMESTAMP)`,
        [row.rows[0].id]
      )
      return row.rows[0].id
    }
    const resource = async (input: {
      patchId: number
      userId: number
      name: string
      created: string
      type?: string[]
      note?: string
    }) => {
      const row = await client.query<{ id: number }>(
        `
          INSERT INTO public.patch_resource
            (section, name, note, type, language, platform, status,
             user_id, patch_id, created, updated)
          VALUES
            ('galgame', $1, $2, $3::varchar[], ARRAY['zh-Hans']::varchar[],
             ARRAY['windows']::varchar[], 0, $4, $5, $6, $6)
          RETURNING id
        `,
        [
          input.name,
          input.note ?? '',
          input.type ?? ['pc'],
          input.userId,
          input.patchId,
          input.created
        ]
      )
      return row.rows[0].id
    }
    const link = async (input: {
      resourceId: number
      storage: 'user' | 'touchgal'
      content: string
      changedAt: string
      size?: string
    }) => {
      await client.query(
        `
          INSERT INTO public.patch_resource_link
            (storage, content, size, sort_order, content_changed_at,
             attached_at, resource_id, created, updated)
          VALUES
            ($1, $2, $3, 1, $4, $4, $5, $4, $4)
        `,
        [
          input.storage,
          input.content,
          input.size ?? '',
          input.changedAt,
          input.resourceId
        ]
      )
    }
    const pair = async (input: {
      uniqueId: string
      userName: string
      staffName: string
      userType?: string[]
      staffType?: string[]
      longStaffLink?: boolean
    }): Promise<Pair> => {
      const patchId = await patch(input.uniqueId, input.userName)
      const userResourceId = await resource({
        patchId,
        userId: authorId,
        name: input.userName,
        created: '2026-11-01T00:00:00.000Z',
        type: input.userType,
        note: '用户备注'
      })
      const staffResourceId = await resource({
        patchId,
        userId: adminId,
        name: input.staffName,
        created: '2026-11-02T00:00:00.000Z',
        type: input.staffType,
        note: '站方备注'
      })
      await link({
        resourceId: userResourceId,
        storage: 'user',
        content: 'https://example.invalid/user-link',
        changedAt: '2026-11-01T00:00:00.000Z'
      })
      await link({
        resourceId: staffResourceId,
        storage: 'touchgal',
        content: input.longStaffLink ? LONG_LINK : 'https://example.invalid/touchgal',
        changedAt: '2026-11-02T01:00:00.000Z',
        size: '12MB'
      })
      return {
        patch: input.uniqueId,
        userResourceId,
        staffResourceId,
        userName: input.userName
      }
    }

    const unbackedPatch = await patch(patchUid('a1'), '未备份游戏')
    const unbackedId = await resource({
      patchId: unbackedPatch,
      userId: authorId,
      name: '未备份长链',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: unbackedId,
      storage: 'user',
      content: LONG_LINK,
      changedAt: '2026-11-01T00:00:00.000Z'
    })

    const rebackupPatch = await patch(patchUid('a2'), '重新备份游戏')
    const rebackupId = await resource({
      patchId: rebackupPatch,
      userId: authorId,
      name: '待重新备份卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: rebackupId,
      storage: 'touchgal',
      content: 'https://example.invalid/backup',
      changedAt: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: rebackupId,
      storage: 'user',
      content: 'https://example.invalid/changed',
      changedAt: '2026-11-03T00:00:00.000Z'
    })

    const ignoredPatch = await patch(patchUid('a3'), '已忽略游戏')
    const ignoredId = await resource({
      patchId: ignoredPatch,
      userId: authorId,
      name: '已忽略卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: ignoredId,
      storage: 'user',
      content: 'https://example.invalid/ignored',
      changedAt: '2026-11-01T00:00:00.000Z'
    })
    await client.query(
      `
        INSERT INTO public.patch_resource_backup_state
          (resource_id, ignored_at, ignored_by_user_id, ignore_reason)
        VALUES ($1, CURRENT_TIMESTAMP, $2, 'seeded')
      `,
      [ignoredId, adminId]
    )

    const handoverPatch = await patch(patchUid('c1'), '交接游戏')
    const handoverId = await resource({
      patchId: handoverPatch,
      userId: authorId,
      name: '交接卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: handoverId,
      storage: 'user',
      content: 'https://example.invalid/handover-user',
      changedAt: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: handoverId,
      storage: 'touchgal',
      content: 'https://example.invalid/handover-backup',
      changedAt: '2026-11-02T00:00:00.000Z'
    })

    const removePatch = await patch(patchUid('c2'), '删除游戏')
    const removeId = await resource({
      patchId: removePatch,
      userId: authorId,
      name: '无备份删除卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: removeId,
      storage: 'user',
      content: 'https://example.invalid/delete-me',
      changedAt: '2026-11-01T00:00:00.000Z'
    })

    const mobileHandoverPatch = await patch(patchUid('d1'), '手机交接游戏')
    const mobileHandoverId = await resource({
      patchId: mobileHandoverPatch,
      userId: authorId,
      name: '手机交接卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: mobileHandoverId,
      storage: 'user',
      content: 'https://example.invalid/mobile-handover-user',
      changedAt: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: mobileHandoverId,
      storage: 'touchgal',
      content: 'https://example.invalid/mobile-handover-backup',
      changedAt: '2026-11-02T00:00:00.000Z'
    })
    const mobileRemovePatch = await patch(patchUid('d2'), '手机删除游戏')
    const mobileRemoveId = await resource({
      patchId: mobileRemovePatch,
      userId: authorId,
      name: '手机无备份删除卡',
      created: '2026-11-01T00:00:00.000Z'
    })
    await link({
      resourceId: mobileRemoveId,
      storage: 'user',
      content: 'https://example.invalid/mobile-delete',
      changedAt: '2026-11-01T00:00:00.000Z'
    })

    const ids: Ids = {
      authorId,
      adminId,
      unbacked: { patch: patchUid('a1'), resourceId: unbackedId },
      rebackup: { patch: patchUid('a2'), resourceId: rebackupId },
      ignored: { patch: patchUid('a3'), resourceId: ignoredId },
      highA: await pair({
        uniqueId: patchUid('b1'),
        userName: '高置信甲',
        staffName: '站方甲',
        longStaffLink: true
      }),
      highB: await pair({
        uniqueId: patchUid('b2'),
        userName: '高置信乙',
        staffName: '站方乙'
      }),
      highC: await pair({
        uniqueId: patchUid('b3'),
        userName: '高置信丙',
        staffName: '站方丙'
      }),
      manual: await pair({
        uniqueId: patchUid('b4'),
        userName: '人工核对卡',
        staffName: '站方人工',
        staffType: ['mobile']
      }),
      handover: { patch: patchUid('c1'), resourceId: handoverId },
      remove: { patch: patchUid('c2'), resourceId: removeId },
      mobileHandover: { patch: patchUid('d1'), resourceId: mobileHandoverId },
      mobileRemove: { patch: patchUid('d2'), resourceId: mobileRemoveId },
      mobileHigh: await pair({
        uniqueId: patchUid('d3'),
        userName: '手机高置信',
        staffName: '手机站方'
      })
    }
    await client.query('COMMIT')
    return ids
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const openAs = async (
  browser: Browser,
  token: string,
  viewport: { width: number; height: number }
) => {
  const context = await browser.newContext({ viewport })
  await context.addCookies([
    { name: COOKIE, value: token, url: ORIGIN, sameSite: 'Lax' }
  ])
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => {
    console.log(`PAGEERROR ${error.message}`)
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const path = response.url().split('?')[0] ?? response.url()
    if (!path.includes('/api/')) return
    console.log(`HTTP ${response.status()} ${path}`)
  })
  return { context, page }
}

const shot = async (page: Page, name: string) => {
  const path = join(ARTIFACT_DIR, name)
  await page.screenshot({ path, fullPage: true })
  console.log(`SHOT ${path}`)
}

const assertLongLinkFits = async (page: Page, label: string) => {
  const link = page.locator('.break-all', { hasText: 'long-link-' }).first()
  await link.waitFor()
  await link.scrollIntoViewIfNeeded()
  const box = await link.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && viewport, `${label} long link has no box`)
  assert.ok(
    box.x + box.width <= viewport.width + 1,
    `${label} long link overflows the viewport (${box.x + box.width} > ${viewport.width})`
  )
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  )
  const clientWidth = await page.evaluate(
    () => document.documentElement.clientWidth
  )
  assert.ok(
    scrollWidth <= clientWidth + 1,
    `${label} page scrolls sideways (${scrollWidth} > ${clientWidth})`
  )
}

const revealList = async (page: Page) => {
  const overlay = page.locator('[data-slot="sheet-overlay"]')
  const back = page.getByRole('button', { name: '返回列表' })
  let closed = false
  if (await back.isVisible().catch(() => false)) {
    await back.click()
    closed = true
  } else if ((await overlay.count()) > 0) {
    await page.keyboard.press('Escape')
    closed = true
  } else {
    const closeDetail = page.getByRole('button', { name: '关闭详情' })
    if (await closeDetail.isVisible().catch(() => false)) {
      await closeDetail.click()
      closed = true
    }
  }
  await overlay.waitFor({ state: 'detached' })
  if (closed) {
    await page.waitForFunction(
      () => !new URLSearchParams(location.search).has('id')
    )
  }
}

const layoutPass = async (
  browser: Browser,
  adminToken: string,
  ids: Ids,
  label: string,
  viewport: { width: number; height: number }
) => {
  const { context, page } = await openAs(browser, adminToken, viewport)
  try {
    await page.goto(
      `${ORIGIN}/dashboard/backup?id=${ids.unbacked.resourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByText('未备份长链').first().waitFor()
    await assertLongLinkFits(page, label)
    await shot(page, `${label}-backup-long-link.png`)
    await revealList(page)
    await page.getByRole('tab', { name: /未备份/ }).waitFor()
    await page.getByRole('tab', { name: /待重新备份/ }).click()
    await page.getByText('待重新备份卡').first().waitFor()
    await page.getByRole('tab', { name: /已忽略/ }).click()
    await page.getByText('已忽略卡').first().waitFor()
    await page.getByRole('tab', { name: /未备份/ }).click()
    await page.getByText('未备份长链').first().waitFor()
    let ignoreCalls = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/admin/backup/ignore')
      ) {
        ignoreCalls += 1
      }
    })
    await page.goto(
      `${ORIGIN}/dashboard/backup?id=${ids.unbacked.resourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByRole('button', { name: '忽略', exact: true }).click()
    await page.getByRole('alertdialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
    assert.equal(ignoreCalls, 0, `${label} Escape sent an ignore write`)
    await shot(page, `${label}-keyboard-cancel.png`)
    console.log(`PASS ${label} backup tabs, long link, keyboard cancel wrote nothing`)

    await page.goto(
      `${ORIGIN}/dashboard/resource-merges?id=${ids.highA.userResourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByText('合并后的卡片').waitFor()
    await page.getByText('字段对照').waitFor()
    await page.getByText('分类：').waitFor()
    await page.getByText('候选站方卡片').waitFor()
    await page.getByText('已附上站方备注').waitFor()
    await assertLongLinkFits(page, `${label} preview`)
    await shot(page, `${label}-merge-preview.png`)
    console.log(`PASS ${label} merge preview`)

    const resourcesLoaded = page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'GET' || response.status() !== 200) {
          return false
        }
        return new URL(response.url()).pathname === '/api/patch/resource'
      },
      { timeout: 45000 }
    )
    await page.goto(
      `${ORIGIN}/${ids.highA.patch}?tab=resources&resourceSection=galgame`,
      { waitUntil: 'domcontentloaded' }
    )
    const listResponse = await resourcesLoaded
    const listText = await listResponse.text()
    console.log(
      `RESOURCE LIST ${listResponse.status()} ${listText.slice(0, 80).replace(/\s+/g, ' ')}`
    )
    const communityHeading = page.getByText(/社区下载资源/)
    try {
      await communityHeading.waitFor({ timeout: 45000 })
    } catch (error) {
      const excerpt = (await page.locator('body').innerText())
        .replace(/\s+/g, ' ')
        .slice(0, 400)
      console.log(`GROUP MISS ${page.url()} :: ${excerpt}`)
      await shot(page, `${label}-grouping-miss.png`)
      throw error
    }
    await page.getByText(/官方 \(推荐下载\)/).waitFor()
    const groupOf = (resourceId: number) =>
      page.locator(`#resource-${resourceId}`).evaluate((element) => {
        let node = element.parentElement
        while (node) {
          const text = node.textContent ?? ''
          const community = text.includes('社区下载资源')
          const official = text.includes('官方 (推荐下载)')
          if (community !== official) return community ? 'community' : 'official'
          node = node.parentElement
        }
        return 'unclear'
      })
    assert.equal(await groupOf(ids.highA.userResourceId), 'community', `${label} user card group`)
    assert.equal(await groupOf(ids.highA.staffResourceId), 'official', `${label} staff card group`)
    await shot(page, `${label}-grouping.png`)
    console.log(`PASS ${label} community grouping`)
  } finally {
    await context.close()
  }
}

const clickInDetail = async (
  page: Page,
  locator: ReturnType<Page['getByRole']>
) => {
  await locator.waitFor()
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  })
  try {
    await locator.click({ timeout: 2000 })
  } catch {
    await locator.evaluate((element) => {
      if (element instanceof HTMLElement) element.click()
    })
  }
}

const confirmPair = async (page: Page, name: string) => {
  if (!page.url().includes('/dashboard/resource-merges')) {
    await page.goto(`${ORIGIN}/dashboard/resource-merges`, {
      waitUntil: 'domcontentloaded'
    })
    await page.getByRole('tab', { name: /待处理/ }).waitFor()
  } else {
    await revealList(page)
  }
  await page.getByText(name, { exact: true }).first().click()
  await page.getByText('合并后的卡片').waitFor()
  const box = page.getByRole('checkbox', { name: '确认这两张卡片是同一份内容' })
  await clickInDetail(page, box)
  await page.waitForFunction(() => {
    const found = [...document.querySelectorAll('[role="checkbox"]')].find((item) =>
      item.closest('div')?.textContent?.includes('确认这两张卡片是同一份内容')
    )
    return found?.getAttribute('aria-checked') === 'true'
  })
}

const writePass = async (
  browser: Browser,
  adminToken: string,
  authorToken: string,
  ids: Ids,
  pool: Pool
) => {
  const desktop = { width: 1280, height: 800 }
  const mobile = { width: 390, height: 844 }
  const { context, page } = await openAs(browser, adminToken, desktop)
  try {
    let ignoreCalls = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/admin/backup/ignore')
      ) {
        ignoreCalls += 1
      }
    })
    await page.route('**/api/admin/backup/ignore', async (route) => {
      const response = await route.fetch()
      const text = await response.text()
      let body = text
      try {
        const parsed = JSON.parse(text) as { cacheRefreshed?: boolean }
        if (parsed && typeof parsed === 'object') {
          console.log(
            `INTERCEPT ignore response cacheRefreshed ${String(parsed.cacheRefreshed)} -> false after the REAL write`
          )
          parsed.cacheRefreshed = false
          body = JSON.stringify(parsed)
        }
      } catch {
        body = text
      }
      const headers = response.headers()
      delete headers['content-length']
      await route.fulfill({ status: response.status(), headers, body })
    })
    await page.goto(
      `${ORIGIN}/dashboard/backup?id=${ids.unbacked.resourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByRole('button', { name: '忽略', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '忽略', exact: true }).click()
    await page.getByText('已保存，页面缓存没有刷新').waitFor()
    await page.locator('.break-all', { hasText: 'long-link-' }).waitFor({
      state: 'detached'
    })
    await page.getByRole('button', { name: '仅刷新缓存', exact: true }).waitFor()
    await page.setViewportSize(mobile)
    await shot(page, 'mobile-cache-retained.png')
    await page.setViewportSize(desktop)
    await shot(page, 'desktop-cache-retained.png')
    const refreshResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/admin/backup/refresh-cache')
    )
    await page.getByRole('button', { name: '仅刷新缓存', exact: true }).click()
    const refreshResponse = await refreshResponsePromise
    const refreshRequestBody = refreshResponse.request().postDataJSON() as {
      uniqueIds?: string[]
      authorIds?: number[]
    }
    const refreshResult = (await refreshResponse.json()) as {
      uniqueIds?: string[]
      cacheRefreshed?: boolean
    }
    assert.equal(refreshResponse.status(), 200)
    assert.equal(refreshResult.cacheRefreshed, true)
    assert.deepEqual(refreshRequestBody.uniqueIds, [ids.unbacked.patch])
    assert.deepEqual(refreshRequestBody.authorIds, [ids.authorId])
    assert.deepEqual(refreshResult.uniqueIds, [ids.unbacked.patch])
    await page.getByText('已保存，页面缓存已刷新。').waitFor()
    assert.equal(ignoreCalls, 1, 'cache retry repeated the ignore write')
    console.log(
      'REAL POST /api/admin/backup/refresh-cache; INTERCEPT ignore stayed at 1 after retry'
    )
    await page.unroute('**/api/admin/backup/ignore')

    await page.goto(`${ORIGIN}/dashboard/backup?tab=ignored`, {
      waitUntil: 'domcontentloaded'
    })
    await page.getByRole('tab', { name: /已忽略/ }).waitFor()
    await page.getByText('未备份长链').first().click()
    await page.getByRole('button', { name: '撤销忽略', exact: true }).click()
    const unignoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/admin/backup/unignore') &&
        response.status() === 200
    )
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '撤销忽略', exact: true })
      .click()
    await unignoreResponse
    const ignored = await pool.query<{ ignored_at: Date | null }>(
      `SELECT ignored_at FROM public.patch_resource_backup_state WHERE resource_id = $1`,
      [ids.unbacked.resourceId]
    )
    assert.equal(ignored.rows[0]?.ignored_at ?? null, null)
    console.log('REAL POST /api/admin/backup/unignore cleared ignored_at')

    await confirmPair(page, ids.highB.userName)
    await confirmPair(page, ids.highC.userName)
    await revealList(page)
    await page.getByRole('button', { name: /筛选/ }).click()
    await page.locator('#merge-class').click()
    await page.getByRole('option', { name: '高置信' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '合并所选', exact: true }).click()
    const batchRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/admin/resource-merges/batch')
    )
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '合并所选', exact: true })
      .click()
    const batch = await batchRequest
    const batchBody = batch.postDataJSON() as {
      pairs: Array<{ userResourceId: number; contentConfirmed: boolean }>
    }
    const batchIds = batchBody.pairs.map((item) => item.userResourceId).sort()
    assert.deepEqual(batchIds, [ids.highB.userResourceId, ids.highC.userResourceId].sort())
    assert.ok(batchBody.pairs.every((item) => item.contentConfirmed === true))
    assert.ok(!batchIds.includes(ids.manual.userResourceId))
    await page.getByText(`#${ids.highB.userResourceId} / #${ids.highB.staffResourceId} 已合并`).waitFor()
    await page.getByText(`#${ids.highC.userResourceId} / #${ids.highC.staffResourceId} 已合并`).waitFor()
    await page.setViewportSize(mobile)
    await shot(page, 'mobile-batch-result.png')
    await page.setViewportSize(desktop)
    await shot(page, 'desktop-batch-result.png')
    console.log('REAL POST /api/admin/resource-merges/batch excluded the manual pair')

    await page.goto(
      `${ORIGIN}/dashboard/resource-merges?id=${ids.highA.userResourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByText('合并后的卡片').waitFor()
    await clickInDetail(
      page,
      page.getByRole('checkbox', { name: '确认这两张卡片是同一份内容' })
    )
    await page.waitForFunction(() => {
      const found = [...document.querySelectorAll('[role="checkbox"]')].find((item) =>
        item.closest('div')?.textContent?.includes('确认这两张卡片是同一份内容')
      )
      return found?.getAttribute('aria-checked') === 'true'
    })
    await clickInDetail(
      page,
      page.getByRole('button', { name: '合并这一对', exact: true })
    )
    const mergeRequest = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/admin/resource-merges/merge')
    )
    await page.getByRole('alertdialog').getByRole('button', { name: '合并', exact: true }).click()
    const mergeResponse = await mergeRequest
    assert.equal(mergeResponse.status(), 200)
    console.log('REAL POST /api/admin/resource-merges/merge')

    const relocated = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/patch/resource/resolve') &&
        response.status() === 200,
      { timeout: 45000 }
    )
    await page.goto(
      `${ORIGIN}/${ids.highA.patch}?tab=resources&resourceId=${ids.highA.staffResourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await relocated
    await page.waitForURL(new RegExp(`resourceId=${ids.highA.userResourceId}`), {
      timeout: 45000
    })
    await page.locator(`#resource-${ids.highA.userResourceId}`).waitFor({
      timeout: 45000
    })
    await page.setViewportSize(mobile)
    await shot(page, 'mobile-old-id.png')
    await page.setViewportSize(desktop)
    await shot(page, 'desktop-old-id.png')
    console.log('REAL GET /api/patch/resource/resolve relocated the old staff id')
  } finally {
    await context.close()
  }

  const authorContext = await openAs(browser, authorToken, desktop)
  try {
    const authorPage = authorContext.page
    let deletes = 0
    authorPage.on('request', (request) => {
      if (request.method() === 'DELETE' && request.url().includes('/api/patch/resource')) {
        deletes += 1
      }
    })
    await authorPage.goto(
      `${ORIGIN}/${ids.remove.patch}?tab=resources&resourceSection=galgame`,
      { waitUntil: 'domcontentloaded' }
    )
    const removeCard = authorPage.locator(`#resource-${ids.remove.resourceId}`)
    await removeCard.waitFor()
    await openResourceMenu(authorPage, removeCard, '删除')
    await authorPage.getByText('您确定要删除这条资源链接吗').waitFor()
    await authorPage.keyboard.press('Escape')
    await authorPage.getByText('您确定要删除这条资源链接吗').waitFor({ state: 'hidden' })
    assert.equal(deletes, 0, 'Escape deleted a resource')
    const stillThere = await pool.query(
      `SELECT id FROM public.patch_resource WHERE id = $1`,
      [ids.remove.resourceId]
    )
    assert.equal(stillThere.rowCount, 1)
    await authorPage.setViewportSize(mobile)
    await shot(authorPage, 'mobile-delete-cancel.png')
    await authorPage.setViewportSize(desktop)
    console.log('PASS keyboard cancel on delete wrote nothing')

    await openResourceMenu(authorPage, removeCard, '删除')
    await authorPage.getByRole('button', { name: '删除资源', exact: true }).click()
    await removeCard.waitFor({ state: 'detached' })
    const removed = await pool.query(
      `SELECT id FROM public.patch_resource WHERE id = $1`,
      [ids.remove.resourceId]
    )
    assert.equal(removed.rowCount, 0)
    console.log('REAL DELETE /api/patch/resource action=delete')

    const handoverResources = authorPage.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/patch/resource' &&
        response.status() === 200,
      { timeout: 45000 }
    )
    await authorPage.goto(
      `${ORIGIN}/${ids.handover.patch}?tab=resources&resourceSection=galgame`,
      { waitUntil: 'domcontentloaded' }
    )
    await handoverResources
    const handoverCard = authorPage.locator(`#resource-${ids.handover.resourceId}`)
    await handoverCard.waitFor()
    let handoverOpened = false
    for (let attempt = 0; attempt < 3 && !handoverOpened; attempt += 1) {
      await handoverCard.getByRole('button', { name: '资源操作' }).click()
      const item = authorPage.getByRole('menuitem', { name: '交由站方维护' })
      try {
        await item.click({ timeout: 4000 })
        handoverOpened = true
      } catch (error) {
        if (attempt === 2) throw error
        await authorPage.keyboard.press('Escape').catch(() => undefined)
      }
    }
    await authorPage.getByText('交由站方维护后，你添加的链接会被移除').waitFor()
    await authorPage.getByRole('button', { name: '交由站方维护', exact: true }).click()
    await authorPage.getByText('已交由站方维护，你仍可在个人主页查看发布记录').waitFor()
    await handoverCard.waitFor()
    const link = authorPage.getByRole('link', { name: '查看发布记录' })
    await link.waitFor()
    assert.equal(
      await link.getAttribute('href'),
      `/user/${ids.authorId}/resource`
    )
    const handed = await pool.query<{ user_id: number; left: boolean }>(
      `
        SELECT user_id, publisher_left_at IS NOT NULL AS left
        FROM public.patch_resource WHERE id = $1
      `,
      [ids.handover.resourceId]
    )
    assert.equal(handed.rows[0]?.user_id, ids.authorId)
    assert.equal(handed.rows[0]?.left, true)
    await authorPage.setViewportSize(mobile)
    await shot(authorPage, 'mobile-handover.png')
    await authorPage.setViewportSize(desktop)
    await shot(authorPage, 'desktop-handover.png')
    console.log('REAL DELETE /api/patch/resource action=handover kept the card and user_id')
  } finally {
    await authorContext.context.close()
  }
}

const assertDialogFocus = async (page: Page, label: string, text: string) => {
  const focused = await page.evaluate((expected) => {
    const active = document.activeElement
    if (!(active instanceof Element)) return false
    const dialog = active.closest('[role="dialog"], [role="alertdialog"]')
    return Boolean(dialog?.textContent?.includes(expected))
  }, text)
  assert.ok(focused, `${label} dialog did not hold focus`)
}

const openResourceMenu = async (
  page: Page,
  card: ReturnType<Page['locator']>,
  itemName: string
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await card.getByRole('button', { name: '资源操作' }).click()
    const item = page.getByRole('menuitem', { name: itemName, exact: true })
    try {
      await item.click({ timeout: 4000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
      await page.keyboard.press('Escape').catch(() => undefined)
    }
  }
}

const writePassMobile = async (
  browser: Browser,
  adminToken: string,
  authorToken: string,
  ids: Ids,
  pool: Pool
) => {
  const mobile = { width: 390, height: 844 }
  const adminContext = await openAs(browser, adminToken, mobile)
  try {
    const page = adminContext.page
    let mergePosts = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/admin/resource-merges/merge')
      ) {
        mergePosts += 1
      }
    })
    await page.goto(
      `${ORIGIN}/dashboard/resource-merges?id=${ids.mobileHigh.userResourceId}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page.getByText('合并后的卡片').waitFor()
    await clickInDetail(
      page,
      page.getByRole('checkbox', { name: '确认这两张卡片是同一份内容' })
    )
    await page.waitForFunction(() => {
      const found = [...document.querySelectorAll('[role="checkbox"]')].find(
        (item) =>
          item.closest('div')?.textContent?.includes('确认这两张卡片是同一份内容')
      )
      return found?.getAttribute('aria-checked') === 'true'
    })
    await page.getByRole('button', { name: '合并这一对', exact: true }).click()
    const mergeDialog = page.getByRole('alertdialog')
    await mergeDialog.waitFor()
    await assertDialogFocus(page, 'mobile merge', '站方卡片并入这张用户卡片')
    await mergeDialog.screenshot({
      path: join(ARTIFACT_DIR, 'mobile-merge-cancel.png')
    })
    console.log('SHOT mobile-merge-cancel.png dialog')
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
    assert.equal(mergePosts, 0, 'mobile Escape submitted a merge')
    console.log('PASS mobile merge cancel wrote nothing')
    await page.getByRole('button', { name: '合并这一对', exact: true }).click()
    const mergeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/admin/resource-merges/merge')
    )
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '合并', exact: true })
      .click()
    const mergeResponse = await mergeResponsePromise
    assert.equal(mergeResponse.status(), 200)
    assert.equal(mergePosts, 1, 'mobile merge was not the one real write')
    await shot(page, 'mobile-merge-submit.png')
    console.log('REAL POST /api/admin/resource-merges/merge at 390')
  } finally {
    await adminContext.context.close()
  }

  const authorContext = await openAs(browser, authorToken, mobile)
  try {
    const page = authorContext.page
    const deletes: string[] = []
    page.on('request', (request) => {
      if (
        request.method() === 'DELETE' &&
        request.url().includes('/api/patch/resource')
      ) {
        deletes.push(new URL(request.url()).search)
      }
    })
    const resourcesLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/patch/resource' &&
        response.status() === 200,
      { timeout: 45000 }
    )
    await page.goto(
      `${ORIGIN}/${ids.mobileRemove.patch}?tab=resources&resourceSection=galgame`,
      { waitUntil: 'domcontentloaded' }
    )
    await resourcesLoaded
    const removeCard = page.locator(`#resource-${ids.mobileRemove.resourceId}`)
    await removeCard.waitFor()
    await openResourceMenu(page, removeCard, '删除')
    await page.getByText('您确定要删除这条资源链接吗').waitFor()
    await assertDialogFocus(page, 'mobile delete', '您确定要删除这条资源链接吗')
    await shot(page, 'mobile-delete-cancel.png')
    await page.keyboard.press('Escape')
    await page.getByText('您确定要删除这条资源链接吗').waitFor({ state: 'hidden' })
    assert.equal(deletes.length, 0, 'mobile Escape deleted a resource')
    const stillThere = await pool.query(
      `SELECT id FROM public.patch_resource WHERE id = $1`,
      [ids.mobileRemove.resourceId]
    )
    assert.equal(stillThere.rowCount, 1)
    console.log('PASS mobile delete cancel wrote nothing')
    await openResourceMenu(page, removeCard, '删除')
    await page.getByRole('button', { name: '删除资源', exact: true }).click()
    await removeCard.waitFor({ state: 'detached' })
    assert.equal(deletes.length, 1)
    assert.ok(deletes[0]?.includes('action=delete'), deletes[0])
    const removed = await pool.query(
      `SELECT id FROM public.patch_resource WHERE id = $1`,
      [ids.mobileRemove.resourceId]
    )
    assert.equal(removed.rowCount, 0)
    console.log('REAL DELETE /api/patch/resource action=delete at 390')

    const handoverResources = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/patch/resource' &&
        response.status() === 200,
      { timeout: 45000 }
    )
    await page.goto(
      `${ORIGIN}/${ids.mobileHandover.patch}?tab=resources&resourceSection=galgame`,
      { waitUntil: 'domcontentloaded' }
    )
    await handoverResources
    const handoverCard = page.locator(`#resource-${ids.mobileHandover.resourceId}`)
    await handoverCard.waitFor()
    await openResourceMenu(page, handoverCard, '交由站方维护')
    await page.getByText('交由站方维护后，你添加的链接会被移除').waitFor()
    await assertDialogFocus(
      page,
      'mobile handover',
      '交由站方维护后，你添加的链接会被移除'
    )
    await page.keyboard.press('Escape')
    await page
      .getByText('交由站方维护后，你添加的链接会被移除')
      .waitFor({ state: 'hidden' })
    assert.equal(deletes.length, 1, 'mobile Escape handed over a resource')
    console.log('PASS mobile handover cancel wrote nothing')
    await openResourceMenu(page, handoverCard, '交由站方维护')
    await page.getByRole('button', { name: '交由站方维护', exact: true }).click()
    await page.getByText('已交由站方维护，你仍可在个人主页查看发布记录').waitFor()
    await handoverCard.waitFor()
    const recordLink = page.getByRole('link', { name: '查看发布记录' })
    await recordLink.waitFor()
    assert.equal(
      await recordLink.getAttribute('href'),
      `/user/${ids.authorId}/resource`
    )
    assert.equal(deletes.length, 2)
    assert.ok(deletes[1]?.includes('action=handover'), deletes[1])
    const handed = await pool.query<{ user_id: number; left: boolean }>(
      `
        SELECT user_id, publisher_left_at IS NOT NULL AS left
        FROM public.patch_resource WHERE id = $1
      `,
      [ids.mobileHandover.resourceId]
    )
    assert.equal(handed.rows[0]?.user_id, ids.authorId)
    assert.equal(handed.rows[0]?.left, true)
    await page
      .getByText('交由站方维护后，你添加的链接会被移除')
      .waitFor({ state: 'hidden' })
    await shot(page, 'mobile-handover.png')
    console.log('REAL DELETE /api/patch/resource action=handover at 390')
  } finally {
    await authorContext.context.close()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(redact(message))
  process.exitCode = 1
})
