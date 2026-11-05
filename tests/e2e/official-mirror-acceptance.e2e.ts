/** Module 06 production-build acceptance on a disposable PostgreSQL and Redis.
 * Uses actual HTTP writes and browser UI; only explicit failure/race scenarios
 * intercept responses. Never reads an env file or contacts a real provider.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Redis from 'ioredis'
import pg from 'pg'
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core'
import { seed, session, openAs, shot, assertLongLinkFits, revealList, assertDialogFocus, openResourceMenu } from './official-mirror-ui.browser'

const ORIGIN = 'http://127.0.0.1:3100'
const required = (key: string) => {
  const value = process.env[key]
  assert(value, key + ' must explicitly identify this disposable run')
  return value
}
const database = new URL(required('KUN_E2E_DATABASE_URL'))
assert.equal(database.hostname, '127.0.0.1')
assert.equal(database.port, '55436')
assert.equal(database.pathname, '/official_mirror_e_ui_e2e')
assert.equal(database.username, 'official_mirror_e')
assert.equal(required('KUN_E2E_REDIS_URL'), 'redis://127.0.0.1:56380')
assert.equal(required('KUN_E2E_BASE_URL'), ORIGIN)
const artifacts = required('KUN_E2E_ARTIFACT_DIR')
const pool = new pg.Pool({ connectionString: database.href, max: 8 })
const redis = new Redis(required('KUN_E2E_REDIS_URL'), { maxRetriesPerRequest: 1 })
const checks: Array<{ name: string; evidence: string; at: string }> = []
let activePage: Page | undefined
const pass = (name: string, evidence = 'REAL browser / HTTP / PostgreSQL') => {
  checks.push({ name, evidence, at: new Date().toISOString() })
  console.log('PASS ' + name + ' :: ' + evidence)
}
type Ids = Awaited<ReturnType<typeof seed>>
type Pair = Ids['highA']
const responseAt = (page: Page, path: string, method = 'POST') => page.waitForResponse(
  response => new URL(response.url()).pathname === path && response.request().method() === method)
const send = async (token: string, path: string, method = 'GET', input?: unknown) => {
  const response = await fetch(ORIGIN + path, { method, headers: {
    Cookie: `kun-galgame-patch-moe-token=${token}`, Origin: ORIGIN, 'x-requested-with': 'kun-fetch',
    ...(input === undefined ? {} : { 'content-type': 'application/json' })
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
  const data = await response.json()
  return { status: response.status, data, headers: response.headers }
}
const guardBrowser = async (context: BrowserContext) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname)
      ? route.continue() : route.abort('blockedbyclient')
  })
}
const noOverflow = async (page: Page, label: string) => {
  const result = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
  assert(result.scroll <= result.width + 1, `${label} overflows: ${JSON.stringify(result)}`)
  for (const frame of page.frames().filter(frame => frame !== page.mainFrame() && frame.url().includes('/preview/'))) {
    const result = await frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert(result.scroll <= result.width + 1, `${label} preview overflows: ${JSON.stringify(result)}`)
  }
}
const groupOf = (page: Page, resourceId: number) => page.locator(`#resource-${resourceId}`).evaluate(element => {
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
const openMerge = async (page: Page, pair: Pair, tab = '', search = '') => {
  await page.goto(`${ORIGIN}/dashboard/resource-merges?id=${pair.userResourceId}${tab ? '&tab=' + tab : ''}${search ? '&search=' + encodeURIComponent(search) : ''}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: new RegExp(`用户资源 #${pair.userResourceId} ·`) }).waitFor()
  await page.getByRole('region', { name: '合并此配对的结果' }).waitFor()
  await page.getByRole('button', { name: tab === 'dismissed' ? '重开此配对' : '合并此配对', exact: true }).waitFor()
}
const confirmPair = async (page: Page, pair: Pair, add: boolean) => {
  await openMerge(page, pair)
  const trigger = page.getByRole('button', { name: add ? '加入批量合并清单' : '合并此配对', exact: true })
  await trigger.click()
  const dialog = page.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: add ? '加入清单' : '合并', exact: true })
  assert(await confirm.isDisabled(), 'same-content checkbox must gate every pair')
  assert.equal(await dialog.getByRole('checkbox').isChecked(), false)
  await dialog.getByRole('checkbox').check()
  assert(await confirm.isEnabled())
  await confirm.click()
  await dialog.waitFor({ state: 'hidden' })
}

async function layout(browser: Browser, token: string, ids: Ids) {
  for (const width of [1440, 390, 360, 768, 1024]) {
    const { page, context } = await openAs(browser, token, { width, height: 900 })
    activePage = page
    await guardBrowser(context)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let writes = 0
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (request.method() !== 'GET' && (/\/api\/admin\/(backup|resource-merges)/.test(path) || path.includes('/download/'))) writes++
    })
    try {
      await page.goto(`${ORIGIN}/dashboard/backup?id=${ids.unbacked.resourceId}&search=${encodeURIComponent('游戏')}`, { waitUntil: 'domcontentloaded' })
      await page.getByText('未备份长链').first().waitFor()
      await assertLongLinkFits(page, `${width} backup`)
      await page.getByRole('button', { name: '忽略', exact: true }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor()
      await assertDialogFocus(page, `${width} backup`, '忽略')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(writes, 0)
      await revealList(page)
      await page.getByRole('tab', { name: /待重新备份/ }).click()
      await page.getByText('重新备份游戏').first().waitFor()
      await page.getByRole('tab', { name: /已忽略/ }).click()
      await page.getByText('已忽略游戏').first().waitFor()
      await shot(page, `acceptance-${width}-backup-tabs.png`)
      await openMerge(page, ids.highA, '', '高置信')
      const userFrame = page.frameLocator(`iframe[title="用户资源 #${ids.highA.userResourceId} 预览"]`)
      await userFrame.getByText(ids.highA.userName, { exact: true }).first().waitFor()
      await userFrame.getByRole('button', { name: '下载 OtomeGame 资源', exact: true }).click()
      await userFrame.getByRole('button', { name: '下载 OtomeGame 资源', exact: true }).click()
      assert.equal(await userFrame.getByRole('button', { name: /获取下载链接|报告失效|资源操作/ }).count(), 0)
      await page.getByRole('tab', { name: '合并后预览', exact: true }).click()
      const mergedFrame = page.frameLocator(`iframe[title="合并后预览 #${ids.highA.userResourceId} ← #${ids.highA.staffResourceId}"]`)
      await mergedFrame.getByText(ids.highA.userName, { exact: true }).first().waitFor()
      await noOverflow(page, `${width} merge`)
      await shot(page, `acceptance-${width}-merge-light.png`)
      await page.getByRole('button', { name: '合并此配对', exact: true }).click()
      await dialog.waitFor()
      assert(await dialog.getByRole('button', { name: '合并', exact: true }).isDisabled())
      await assertDialogFocus(page, `${width} merge`, '合并此配对')
      await noOverflow(page, `${width} confirmation`)
      await shot(page, `acceptance-${width}-confirmation.png`)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(writes, 0, 'preview / cancellation must not call writes or downloads')
      await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
      await page.locator('html.dark').waitFor()
      await mergedFrame.locator('html.dark').waitFor()
      await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))))
      await mergedFrame.locator('html').evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))))
      await noOverflow(page, `${width} dark`)
      await shot(page, `acceptance-${width}-merge-dark.png`)
      pass(`layout ${width}px light/dark preview, backup tabs, focus, cancel zero writes`)
      if (width === 390) {
        await page.setViewportSize({ width: 390, height: 420 })
        await page.getByRole('searchbox', { name: '搜索游戏或资源', exact: true }).focus()
        await noOverflow(page, '390px focused input with reduced visual height')
        await page.getByRole('button', { name: '合并此配对', exact: true }).click()
        await dialog.waitFor()
        await assertDialogFocus(page, '390px reduced-height merge', '合并此配对')
        const box = await dialog.boundingBox()
        assert(box && box.y >= -1 && box.y + box.height <= 421, `reduced-height dialog leaves viewport: ${JSON.stringify(box)}`)
        await noOverflow(page, '390px reduced-height confirmation')
        await shot(page, 'acceptance-390-keyboard-height.png')
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(writes, 0)
        await page.setViewportSize({ width, height: 900 })
        pass('390px focused input / 420px viewport-height simulation keeps confirmation and actions reachable', 'REAL Chromium viewport resize and focus; physical OS keyboard not exercised')
      }
    } finally {
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      console.log('LAST_PAGE ' + page.url())
      await context.close()
    }
  }
}

async function backup(browser: Browser, token: string, ids: Ids) {
  const { page, context } = await openAs(browser, token, { width: 1440, height: 900 })
  activePage = page
  await guardBrowser(context)
  let ignores = 0
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/backup/ignore') ignores++
  })
  try {
    // On this run's exclusive Redis only: reads/auth still work; invalidation SCAN fails.
    await redis.call('ACL', 'SETUSER', 'default', '-scan')
    await page.goto(`${ORIGIN}/dashboard/backup?id=${ids.unbacked.resourceId}&search=${encodeURIComponent('游戏')}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '忽略', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '忽略', exact: true }).click()
    await page.getByText('已保存，页面缓存没有刷新').waitFor()
    const ignored = await pool.query('SELECT ignored_at FROM patch_resource_backup_state WHERE resource_id=$1', [ids.unbacked.resourceId])
    assert(ignored.rows[0].ignored_at)
    await redis.call('ACL', 'SETUSER', 'default', '+scan')
    const retried = responseAt(page, '/api/admin/backup/refresh-cache')
    await page.getByRole('button', { name: '仅刷新缓存', exact: true }).click()
    assert.equal((await retried).status(), 200)
    await page.getByText('已保存，页面缓存已刷新。').waitFor()
    assert.equal(ignores, 1)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource_backup_state WHERE resource_id=$1', [ids.unbacked.resourceId])).rows[0].n, 1)
    await shot(page, 'acceptance-cache-retry.png')
    pass('real Redis failure after committed ignore; refresh-only retry keeps one write', 'REAL Redis ACL temporarily denied SCAN; actual ignore/refresh HTTP and PostgreSQL')
    await page.goto(`${ORIGIN}/dashboard/backup?tab=ignored&id=${ids.unbacked.resourceId}&search=${encodeURIComponent('游戏')}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '撤销忽略', exact: true }).click()
    const unignored = responseAt(page, '/api/admin/backup/unignore')
    await page.getByRole('alertdialog').getByRole('button', { name: '撤销忽略', exact: true }).click()
    assert.equal((await unignored).status(), 200)
    const state = await pool.query('SELECT ignored_at FROM patch_resource_backup_state WHERE resource_id=$1', [ids.unbacked.resourceId])
    assert.equal(state.rows[0]?.ignored_at ?? null, null)
    pass('unignore returns card according to current facts')
  } finally {
      await redis.call('ACL', 'SETUSER', 'default', '+scan')
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      console.log('LAST_PAGE ' + page.url())
      await context.close()
    }
}

async function publicDownload(browser: Browser, token: string, ids: Ids) {
  const counters = async () => (await pool.query<{resource:number;patch:number;link:number}>(`SELECT r.download AS resource,p.download AS patch,l.download AS link
    FROM patch_resource r JOIN patch p ON p.id=r.patch_id JOIN patch_resource_link l ON l.resource_id=r.id WHERE r.id=$1`, [ids.unbacked.resourceId])).rows[0]
  const before = await counters()
  for (const width of [1440, 390]) {
    const { page, context } = await openAs(browser, token, { width, height: 900 })
    activePage = page
    await guardBrowser(context)
    try {
      await page.goto(`${ORIGIN}/${ids.unbacked.patch}?tab=resources&resourceId=${ids.unbacked.resourceId}`, { waitUntil: 'domcontentloaded' })
      const card = page.locator(`#resource-${ids.unbacked.resourceId}`)
      await card.waitFor()
      if (width === 1440) {
        await card.getByRole('button', { name: '下载 OtomeGame 资源', exact: true }).click()
        const access = responseAt(page, '/api/patch/resource/download/access')
        await card.getByRole('button', { name: '获取下载链接', exact: true }).click()
        const granted = await access
        assert.equal(granted.status(), 200)
        assert.equal((await granted.json()).access.kind, 'resource_granted')
      }
      await card.locator('a[href^="https://example.invalid/"]').first().waitFor()
      assert.deepEqual(await counters(), { resource: before.resource + 1, patch: before.patch + 1, link: before.link + 1 })
      await noOverflow(page, `${width} public revealed download`)
      await shot(page, `acceptance-${width}-public-download.png`)
      const restore = responseAt(page, '/api/patch/resource/download/access/restore')
      await page.reload({ waitUntil: 'domcontentloaded' })
      assert.equal((await restore).status(), 200)
      await card.locator('a[href^="https://example.invalid/"]').first().waitFor()
      assert.deepEqual(await counters(), { resource: before.resource + 1, patch: before.patch + 1, link: before.link + 1 })
      pass(`public ${width}px real download reveal and reload restore keep exactly one resource/patch/link count`)
    } finally {
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      await context.close()
    }
  }
}

async function previewAuthorization(admin: string, author: string, ids: Ids) {
  const paths = [`/preview/resource-card/${ids.highA.userResourceId}`,
    `/preview/resource-merge?user=${ids.highA.userResourceId}&staff=${ids.highA.staffResourceId}`]
  for (const path of paths) {
    for (const token of ['', author]) {
      const response = await fetch(ORIGIN + path, { redirect: 'manual', headers: token ? { Cookie: `kun-galgame-patch-moe-token=${token}` } : {} })
      assert([302, 303, 307, 308, 404].includes(response.status), `${path} denied: ${response.status}`)
      assert(!(await response.text()).includes(ids.highA.userName))
    }
    const allowed = await fetch(ORIGIN + path, { redirect: 'manual', headers: { Cookie: `kun-galgame-patch-moe-token=${admin}` } })
    assert.equal(allowed.status, 200)
  }
  pass('restricted resource/merged previews deny anonymous and ordinary publisher')
}

async function lateResponses(browser: Browser, token: string, ids: Ids) {
  const { page, context } = await openAs(browser, token, { width: 1440, height: 1000 })
  activePage = page
  await guardBrowser(context)
  let releaseOptions = () => {}, releaseSearch = () => {}
  try {
    await openMerge(page, ids.highC, '', '高置信')
    let optionHeld!: () => void
    const heldOptions = new Promise<void>(resolve => { optionHeld = resolve })
    const optionsGate = new Promise<void>(resolve => { releaseOptions = resolve })
    let optionDelivered!: () => void
    const deliveredOptions = new Promise<void>(resolve => { optionDelivered = resolve })
    await page.route('**/api/admin/resource-merges/options?*', async route => {
      if (new URL(route.request().url()).searchParams.get('userResourceId') !== String(ids.highA.userResourceId)) return route.continue()
      const response = await route.fetch()
      optionHeld()
      await optionsGate
      await route.fulfill({ response }).catch(() => undefined)
      optionDelivered()
    })
    await page.locator(`[data-merge-row="${ids.highA.userResourceId}"]`).click()
    await Promise.race([heldOptions, new Promise((_, reject) => setTimeout(() => reject(new Error('expected held options request')), 15000))])
    await page.locator(`[data-merge-row="${ids.highB.userResourceId}"]`).click()
    await page.getByRole('heading', { name: new RegExp(`用户资源 #${ids.highB.userResourceId} ·`) }).waitFor()
    await page.getByRole('button', { name: '合并此配对', exact: true }).waitFor()
    releaseOptions()
    await deliveredOptions
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('heading', { name: new RegExp(`用户资源 #${ids.highA.userResourceId} ·`) }).count(), 0)
    await page.getByRole('heading', { name: new RegExp(`用户资源 #${ids.highB.userResourceId} ·`) }).waitFor()
    await page.unroute('**/api/admin/resource-merges/options?*')
    pass('late real options response cannot replace the newly selected resource')

    let searchHeld!: () => void
    const heldSearch = new Promise<void>(resolve => { searchHeld = resolve })
    const searchGate = new Promise<void>(resolve => { releaseSearch = resolve })
    let searchDelivered!: () => void
    const deliveredSearch = new Promise<void>(resolve => { searchDelivered = resolve })
    await page.route('**/api/admin/resource-merges?*', async route => {
      if (new URL(route.request().url()).searchParams.get('search') !== ids.highA.userName) return route.continue()
      const response = await route.fetch()
      searchHeld()
      await searchGate
      await route.fulfill({ response }).catch(() => undefined)
      searchDelivered()
    })
    const search = page.getByRole('searchbox', { name: '搜索游戏或资源', exact: true })
    await search.fill(ids.highA.userName)
    await search.press('Enter')
    await Promise.race([heldSearch, new Promise((_, reject) => setTimeout(() => reject(new Error('expected held search request')), 15000))])
    const newest = responseAt(page, '/api/admin/resource-merges', 'GET')
    await search.fill(ids.highB.userName)
    await search.press('Enter')
    await newest
    await page.locator(`[data-merge-row="${ids.highB.userResourceId}"]`).waitFor()
    releaseSearch()
    await deliveredSearch
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.locator(`[data-merge-row="${ids.highA.userResourceId}"]`).count(), 0)
    await page.locator(`[data-merge-row="${ids.highB.userResourceId}"]`).waitFor()
    await shot(page, 'acceptance-late-response.png')
    pass('late real search response cannot replace the current query list', 'REAL fetched PostgreSQL-backed responses; route delivery deliberately reordered')
  } finally {
    releaseOptions(); releaseSearch()
    await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
    await shot(page, 'last-page.png').catch(() => undefined)
    await context.close()
  }
}

async function mergeFlows(browser: Browser, token: string, ids: Ids) {
  const { page, context } = await openAs(browser, token, { width: 1440, height: 1000 })
  activePage = page
  await guardBrowser(context)
  try {
    await openMerge(page, ids.highA, '', '高置信')
    let dismisses = 0
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/resource-merges/dismiss-card') dismisses++
    })
    await page.getByRole('button', { name: '驳回全部配对', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
    assert.equal(dismisses, 0)
    await page.getByRole('button', { name: '驳回全部配对', exact: true }).click()
    const dismissal = responseAt(page, '/api/admin/resource-merges/dismiss-card')
    await page.getByRole('alertdialog').getByRole('button', { name: '驳回', exact: true }).click()
    assert.equal((await dismissal).status(), 200)
    assert.equal(dismisses, 1)
    assert.equal((await pool.query('SELECT status FROM patch_resource_merge_record WHERE user_resource_id=$1 AND staff_resource_id=$2', [ids.highA.userResourceId, ids.highA.staffResourceId])).rows[0].status, 'dismissed')
    await openMerge(page, ids.highA, 'dismissed')
    await page.getByRole('button', { name: '重开此配对', exact: true }).click()
    const reopening = responseAt(page, '/api/admin/resource-merges/reopen')
    await page.getByRole('alertdialog').getByRole('button', { name: '重开', exact: true }).click()
    assert.equal((await reopening).status(), 200)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource_merge_record WHERE user_resource_id=$1 AND status=\'dismissed\'', [ids.highA.userResourceId])).rows[0].n, 0)
    pass('whole-card dismissal cancellation, real dismissal, reopen')

    await confirmPair(page, ids.highB, true)
    // Each opening, including another pair, starts unchecked.
    await confirmPair(page, ids.highC, true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /批量合并清单（2）/ }).waitFor()
    const restored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('otoame:resource-merge-batch:v1') ?? '[]'))
    assert.equal(restored.length, 2)
    assert(restored.every((item: { contentConfirmed: boolean }) => item.contentConfirmed === true))
    pass('browser-tab reload restores the two individually confirmed batch entries')
    // Mutate a synthetic card after confirmation: a genuine stale basis produces a partial batch failure.
    await pool.query('UPDATE patch_resource SET note=note || $2, updated=CURRENT_TIMESTAMP WHERE id=$1', [ids.highC.staffResourceId, '\nChanged after confirmation'])
    await page.getByRole('button', { name: /批量合并清单（2）/ }).click()
    const sheet = page.getByRole('dialog', { name: '批量合并清单', exact: true })
    await sheet.getByRole('button', { name: '合并 2 对', exact: true }).click()
    const batchResponse = responseAt(page, '/api/admin/resource-merges/batch')
    await page.getByRole('alertdialog').getByRole('button', { name: '合并', exact: true }).click()
    const batch = await batchResponse
    assert.equal(batch.status(), 200)
    const requestBody = batch.request().postDataJSON()
    assert.equal(requestBody.pairs.length, 2)
    assert(requestBody.pairs.every((pair: { contentConfirmed: boolean }) => pair.contentConfirmed === true))
    const result = await batch.json()
    await writeFile(join(artifacts, 'batch-result.json'), JSON.stringify(result, null, 2))
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1', [ids.highB.staffResourceId])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1', [ids.highC.staffResourceId])).rows[0].n, 1)
    await sheet.getByRole('region', { name: '上次结果' }).waitFor()
    await shot(page, 'acceptance-batch-partial-result.png')
    pass('per-pair confirmation and batch partial stale-basis failure', 'REAL two-pair batch, one committed + one retained in PostgreSQL')
    await page.keyboard.press('Escape')

    await page.goto(`${ORIGIN}/${ids.highA.patch}?tab=resources&resourceSection=galgame`, { waitUntil: 'domcontentloaded' })
    await page.locator(`#resource-${ids.highA.staffResourceId}`).waitFor()
    assert.equal(await groupOf(page, ids.highA.userResourceId), 'community')
    assert.equal(await groupOf(page, ids.highA.staffResourceId), 'official')
    await confirmPair(page, ids.highA, false)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1', [ids.highA.staffResourceId])).rows[0].n, 0)
    pass('single merge commits once')
    await page.goto(`${ORIGIN}/${ids.highA.patch}?tab=resources&resourceId=${ids.highA.staffResourceId}`, { waitUntil: 'domcontentloaded' })
    await page.locator(`#resource-${ids.highA.userResourceId}`).waitFor()
    await page.waitForURL(url => url.searchParams.get('resourceId') === String(ids.highA.userResourceId))
    assert.equal(await page.locator(`#resource-${ids.highA.staffResourceId}`).count(), 0)
    assert.equal(await groupOf(page, ids.highA.userResourceId), 'community')
    await shot(page, 'acceptance-old-resource-id.png')
    pass('old resource ID resolves to surviving community card; original backup card remains official before merge')
    await pool.query('UPDATE public."user" SET moemoepoint=100 WHERE id=$1', [ids.adminId])
    // Only the synthetic administrator in this owned DB: reset unrelated module-07 fixture quota for reruns.
    await pool.query('DELETE FROM help_daily_quota WHERE user_id=$1', [ids.adminId])
    await page.goto(`${ORIGIN}/help/create?patch=${ids.highA.patch}&resource=${ids.highA.staffResourceId}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('已带上来源资源，资源发布者会收到提醒。', { exact: true }).waitFor()
    await page.getByRole('button', { name: /分类/ }).click()
    await page.getByRole('option', { name: /下载与解压/ }).click()
    await page.getByRole('textbox', { name: /^标题/ }).fill('Synthetic merged resource help acceptance')
    await page.locator('textarea').fill('Synthetic extraction question posted from an old merged resource URL for acceptance only.')
    const [help] = await Promise.all([responseAt(page, '/api/help/post'), page.getByRole('button', { name: /^发布（/ }).click()])
    assert.equal(help.request().postDataJSON().resourceId, ids.highA.userResourceId)
    const helpResult = await help.json()
    assert.equal(typeof helpResult.postId, 'number', JSON.stringify(helpResult))
    assert.equal((await pool.query('SELECT resource_id FROM help_post WHERE id=$1', [helpResult.postId])).rows[0].resource_id, ids.highA.userResourceId)
    await page.waitForURL(url => url.pathname === `/help/${helpResult.postId}`)
    await shot(page, 'acceptance-old-id-help-created.png')
    pass('old resource ID prefills surviving resource in help-create and actual posted record')
    const destination = (await pool.query(`INSERT INTO patch(unique_id,name,user_id,content_limit,type,language,engine,platform,updated)
      VALUES($1,'Synthetic current game after move',$2,'sfw',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],CURRENT_TIMESTAMP) RETURNING id,unique_id`, [ids.highA.patch.slice(0,6)+'ff',ids.authorId])).rows[0]
    await pool.query('UPDATE patch_resource SET patch_id=$2 WHERE id=$1', [ids.highA.userResourceId,destination.id])
    await page.goto(`${ORIGIN}/${ids.highA.patch}?tab=resources&resourceId=${ids.highA.staffResourceId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(url=>url.pathname===`/${destination.unique_id}` && url.searchParams.get('resourceId')===String(ids.highA.userResourceId))
    await page.locator(`#resource-${ids.highA.userResourceId}`).waitFor()
    await shot(page,'acceptance-old-id-current-game.png')
    await page.goto(`${ORIGIN}/help/create?patch=${ids.highA.patch}&resource=${ids.highA.staffResourceId}`, { waitUntil: 'domcontentloaded' })
    await page.locator(`a[href="/${destination.unique_id}"]`).getByText('Synthetic current game after move',{exact:true}).waitFor()
    await page.getByText('已带上来源资源，资源发布者会收到提醒。',{exact:true}).waitFor()
    pass('old resource ID and help preset follow the survivor current game without a redirect loop')
  } finally {
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      console.log('LAST_PAGE ' + page.url())
      await context.close()
    }
}

async function publisherFlows(browser: Browser, token: string, ids: Ids) {
  for (const width of [1440, 390]) {
    const { page, context } = await openAs(browser, token, { width, height: 900 })
    activePage = page
    await guardBrowser(context)
    const remove = width === 390 ? ids.mobileRemove : ids.remove
    const handover = width === 390 ? ids.mobileHandover : ids.handover
    let writes = 0
    page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === '/api/patch/resource') writes++ })
    try {
      await page.goto(`${ORIGIN}/${remove.patch}?tab=resources&resourceSection=galgame`, { waitUntil: 'domcontentloaded' })
      const card = page.locator(`#resource-${remove.resourceId}`)
      await card.waitFor()
      await openResourceMenu(page, card, '删除')
      await page.getByText('您确定要删除这条资源链接吗').waitFor()
      await assertDialogFocus(page, `${width} delete`, '您确定要删除这条资源链接吗')
      await page.keyboard.press('Escape')
      await page.getByText('您确定要删除这条资源链接吗').waitFor({ state: 'hidden' })
      assert.equal(writes, 0)
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1', [remove.resourceId])).rows[0].n, 1)
      await openResourceMenu(page, card, '删除')
      await page.getByRole('button', { name: '删除资源', exact: true }).click()
      await card.waitFor({ state: 'detached' })
      assert.equal(writes, 1)
      await page.goto(`${ORIGIN}/${handover.patch}?tab=resources&resourceSection=galgame`, { waitUntil: 'domcontentloaded' })
      const handedCard = page.locator(`#resource-${handover.resourceId}`)
      await handedCard.waitFor()
      await openResourceMenu(page, handedCard, '交由站方维护')
      await page.getByText('交由站方维护后，你添加的链接会被移除').waitFor()
      await assertDialogFocus(page, `${width} handover`, '交由站方维护后，你添加的链接会被移除')
      await page.keyboard.press('Escape')
      await page.getByText('交由站方维护后，你添加的链接会被移除').waitFor({ state: 'hidden' })
      assert.equal(writes, 1)
      await openResourceMenu(page, handedCard, '交由站方维护')
      await page.getByRole('button', { name: '交由站方维护', exact: true }).click()
      await page.getByText('已交由站方维护，你仍可在个人主页查看发布记录').waitFor()
      await handedCard.waitFor()
      assert.equal(await groupOf(page, handover.resourceId), 'community')
      assert.equal(await handedCard.getByRole('button', { name: '资源操作', exact: true }).count(), 0)
      assert.equal(await page.getByRole('link', { name: '查看发布记录' }).getAttribute('href'), `/user/${ids.authorId}/resource`)
      assert.equal(writes, 2)
      const state = (await pool.query('SELECT user_id,publisher_left_at FROM patch_resource WHERE id=$1', [handover.resourceId])).rows[0]
      assert.equal(state.user_id, ids.authorId)
      assert(state.publisher_left_at)
      assert.deepEqual((await pool.query('SELECT storage FROM patch_resource_link WHERE resource_id=$1', [handover.resourceId])).rows.map(row => row.storage), ['touchgal'])
      await shot(page, `acceptance-${width}-handover.png`)
      const publication = page.locator(`a[href*="resourceId=${handover.resourceId}"]`)
      await page.getByRole('link', { name: '查看发布记录', exact: true }).click()
      await publication.getByText('站方维护', { exact: true }).waitFor()
      const workspace = await send(token, '/api/workspace/resources?page=1&limit=50&status=all&section=all')
      assert.equal(workspace.status, 200)
      assert(!workspace.data.items.some((item: { id: number }) => item.id === handover.resourceId))
      await page.goto(ORIGIN + '/workspace/resources', { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: '我维护的资源', exact: true }).waitFor()
      assert.equal(await page.locator(`a[href="/workspace/resources/${handover.resourceId}"]`).count(), 0)
      await shot(page, `acceptance-${width}-maintenance-excludes-handover.png`)
      pass(`publisher ${width}px delete, handover, cancellation, retained community card, publication badge and maintenance exclusion`)
    } finally {
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      console.log('LAST_PAGE ' + page.url())
      await context.close()
    }
  }
}

async function mobileMerge(browser: Browser, token: string, ids: Ids) {
  const { page, context } = await openAs(browser, token, { width: 390, height: 844 })
  activePage = page
  await guardBrowser(context)
  try {
    await confirmPair(page, ids.mobileHigh, false)
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1', [ids.mobileHigh.staffResourceId])).rows[0].n, 0)
    await noOverflow(page, '390 merged')
    await shot(page, 'acceptance-390-merge-submit.png')
    pass('390px real confirmed merge')
  } finally {
      await writeFile(join(artifacts, 'last-page-body.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
      await shot(page, 'last-page.png').catch(() => undefined)
      console.log('LAST_PAGE ' + page.url())
      await context.close()
    }
}

async function main() {
  await mkdir(artifacts, { recursive: true })
  assert.equal((await pool.query('SELECT current_database() AS db,current_user AS role')).rows[0].db, 'official_mirror_e_ui_e2e')
  const sentinel = await fetch(ORIGIN + '/api/patch?uniqueId=e2e00001').then(response => response.json())
  assert.equal(sentinel.name, 'E2E Rewrite Fixture')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const ids = await seed(pool)
    await writeFile(join(artifacts, 'synthetic-fixture.json'), JSON.stringify(ids, null, 2))
    const admin = await session(redis, ids.adminId, 'e2e_admin', 4)
    const author = await session(redis, ids.authorId, 'eui_author', 1)
    const resourceIds = Object.values(ids).flatMap(value => typeof value === 'object' && value !== null ?
      ('resourceId' in value ? [value.resourceId] : 'userResourceId' in value ? [value.userResourceId, value.staffResourceId] : []) : [])
    const businessSnapshot = async () => ({
      cards: (await pool.query('SELECT id,download,publisher_left_at,updated FROM patch_resource WHERE id=ANY($1::int[]) ORDER BY id', [resourceIds])).rows,
      links: (await pool.query('SELECT id,resource_id,version,download,click,health,attached_at,content_changed_at,updated FROM patch_resource_link WHERE resource_id=ANY($1::int[]) ORDER BY id', [resourceIds])).rows,
      backups: (await pool.query('SELECT * FROM patch_resource_backup_state WHERE resource_id=ANY($1::int[]) ORDER BY resource_id', [resourceIds])).rows,
      grants: (await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource_access_grant WHERE resource_id=ANY($1::int[])', [resourceIds])).rows,
      events: (await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource_access WHERE resource_id=ANY($1::int[])', [resourceIds])).rows,
      merges: (await pool.query('SELECT COUNT(*)::int AS n FROM patch_resource_merge_record WHERE user_resource_id=ANY($1::int[]) OR staff_resource_id=ANY($1::int[])', [resourceIds])).rows,
      audit: (await pool.query('SELECT COUNT(*)::int AS n FROM admin_log')).rows
    })
    const beforeReadonly = await businessSnapshot()
    await layout(browser, admin, ids)
    assert.deepEqual(await businessSnapshot(), beforeReadonly)
    pass('all five-width restricted previews and canceled confirmations preserve the PostgreSQL business snapshot')
    await previewAuthorization(admin, author, ids)
    await lateResponses(browser, admin, ids)
    await backup(browser, admin, ids)
    await publicDownload(browser, author, ids)
    await mergeFlows(browser, admin, ids)
    await mobileMerge(browser, admin, ids)
    await publisherFlows(browser, author, ids)
    await writeFile(join(artifacts, 'acceptance-results.json'), JSON.stringify({ sourceSha: required('KUN_E2E_SOURCE_SHA'), browserVersion: browser.version(), checks, passed: true }, null, 2))
    console.log(`PASS ${checks.length} acceptance groups`)
  } catch (error) {
    if (activePage && !activePage.isClosed()) await shot(activePage, 'acceptance-failure.png').catch(() => undefined)
    await writeFile(join(artifacts, 'acceptance-results.json'), JSON.stringify({ sourceSha: required('KUN_E2E_SOURCE_SHA'), checks, passed: false, error: String(error) }, null, 2))
    throw error
  } finally {
    await browser.close()
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await redis.quit()
  await pool.end()
})
