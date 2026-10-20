/** Extension of the real disposable HTTP harness; never run independently. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PrismaClient, patch_submission } from '@prisma/client'
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Route
} from 'playwright-core'
import { storageTypes } from '../../constants/resource'
import { PATCH_SUBMISSION_REASON } from '../../constants/patchSubmission'
import type { UserSession } from '../../types/api/session'
import type { KunUploadFileResponse } from '../../types/api/upload'
import type {
  WorkspaceResourceDetail,
  WorkspaceResourcesResponse,
  WorkspaceResourceUpdateInput
} from '../../types/api/workspace'

type Actor = { id: number; name: string; role: number; token: string }
type Harness = {
  browser: Browser
  prisma: PrismaClient
  origin: string
  run: string
  artifactDir: string
  actor: (suffix: string, role: number) => Promise<Actor>
  request: (
    viewer: Actor | null,
    method: string,
    path: string,
    body?: unknown
  ) => Promise<{ status: number; data: unknown }>
  passed: (name: string) => Promise<void>
}
type Seed = Awaited<ReturnType<typeof seedResource>>
const targets = [
  { width: 360, height: 900 },
  { width: 390, height: 900 },
  { width: 1056, height: 1189 },
  { width: 1280, height: 900 }
]
const waitFor = async (
  test: () => boolean | Promise<boolean>,
  label: string
) => {
  const until = Date.now() + 15000
  while (!(await test())) {
    assert(Date.now() < until, label)
    await new Promise((done) => setTimeout(done, 40))
  }
}
const within = async (promise: Promise<void>, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 15000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
const json = <T>(result: { status: number; data: unknown }): T => {
  assert.equal(result.status, 200)
  assert.notEqual(typeof result.data, 'string', String(result.data))
  return result.data as T
}
const button = (page: Page | Locator, name: string) =>
  page.getByRole('button', { name, exact: true })
const accessiblePrefix = (value: string) =>
  new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)')
const dialog = (page: Page) => page.getByRole('alertdialog')
const confirm = (page: Page) =>
  dialog(page).getByRole('button', {
    name: /^(确认|确认删除|载入最新版本|确认载入)$/
  })
const nameInput = (page: Page) =>
  page.getByRole('textbox', { name: '资源名称', exact: true })
const reload = (page: Page) => button(page, '载入最新版本')
const resourcePath = (id: number) => `/api/workspace/resources/${id}`
const detailPath = (id: number) => `/workspace/resources/${id}`
const entryCard = (page: Page, name: string) =>
  page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .last()
const resourceCard = (page: Page, id: number) =>
  page
    .locator('li')
    .filter({ has: page.locator(`a[href="${detailPath(id)}"]`) })
    .last()
const openEditor = async (page: Page, origin: string, id: number) => {
  await page.goto(`${origin}${detailPath(id)}`, { waitUntil: 'networkidle' })
  await nameInput(page).waitFor()
}
const navigateEditor = async (page: Page, item: Seed) => {
  const marker = randomUUID()
  await page.evaluate((value) => {
    document.documentElement.dataset.alignmentDocument = value
  }, marker)
  await page.getByRole('link', { name: '返回我的资源', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索资源或游戏' }).fill(item.name)
  await button(page, '搜索').click()
  await resourceCard(page, item.id)
    .getByRole('link', { name: /编辑|查看/ })
    .click()
  await nameInput(page).waitFor()
  assert.equal(
    await page.evaluate(
      () => document.documentElement.dataset.alignmentDocument
    ),
    marker,
    'Target-change race must use client navigation, not a new document'
  )
}
const select = async (
  page: Page,
  label: string | RegExp,
  option: string | RegExp
) => {
  const trigger = page.getByRole('combobox', { name: label }).last()
  assert.equal(
    await trigger.evaluate((el) => el.tagName),
    'BUTTON',
    'Single choices must use the shadcn Select'
  )
  await trigger.focus()
  await trigger.press('ArrowDown')
  const choice = page.getByRole('option', {
    name: typeof option === 'string' ? accessiblePrefix(option) : option
  })
  assert.equal(
    await choice.count(),
    1,
    'Select label must identify one option even when its description is visible'
  )
  await choice.click()
  await page
    .getByRole('listbox', { includeHidden: true })
    .waitFor({ state: 'detached' })
}
const checkbox = async (
  page: Page,
  label: string,
  option: string,
  checked: boolean
) => {
  const trigger = page.getByRole('button', { name: label, exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  const item = page.getByRole('menuitemcheckbox', {
    name: accessiblePrefix(option)
  })
  await item.waitFor()
  assert.equal(
    await item.count(),
    1,
    'Checkbox label prefix must remain unique'
  )
  if (((await item.getAttribute('aria-checked')) === 'true') !== checked) {
    await item.focus()
    await item.press('Space')
  }
  await page.keyboard.press('Escape')
}
const noOverflow = async (page: Page, label: string) =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    ),
    true,
    label
  )
const seedResource = async (
  h: Harness,
  actor: Actor,
  patchId: number,
  name: string,
  options: {
    status?: number
    storage?: string
    second?: boolean
    section?: string
  } = {}
) =>
  h.prisma.patch_resource.create({
    data: {
      user_id: actor.id,
      patch_id: patchId,
      name,
      section: options.section ?? 'galgame',
      status: options.status ?? 0,
      type: options.section === 'patch' ? ['patch'] : ['pc', 'row'],
      language: ['ja'],
      platform: ['windows'],
      note: `${h.run} private note`,
      links: {
        create: [0, ...(options.second ? [1] : [])].map((index) => ({
          storage: index === 1 ? 'touchgal' : (options.storage ?? 'user'),
          size: '1GB',
          sort_order: index,
          content: `https://example.invalid/${h.run}/${'long-address-'.repeat(30)}/${index}`,
          code: `${h.run}-private-code`,
          password: `${h.run}-private-password`,
          hash: `${h.run}-private-hash`
        }))
      }
    },
    include: { links: { orderBy: { sort_order: 'asc' } } }
  })

export async function runWorkspaceAlignment(h: Harness) {
  const sourceSha = process.env.KUN_E2E_SOURCE_SHA
  assert(
    sourceSha && /^[a-f0-9]{40}$/.test(sourceSha),
    'KUN_E2E_SOURCE_SHA must bind the actual integrated source'
  )
  const results: { name: string; passed: boolean; error?: string }[] = []
  let activePage: Page | undefined
  const persist = () =>
    writeFile(
      resolve(h.artifactDir, 'alignment-results.json'),
      JSON.stringify(
        {
          run: h.run,
          sourceSha,
          viewports: targets,
          colorSchemes: ['light', 'dark'],
          results
        },
        null,
        2
      )
    )
  const scenario = async (name: string, work: () => Promise<void>) => {
    try {
      await work()
      results.push({ name, passed: true })
      await persist()
      await h.passed(`alignment: ${name}`)
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error)
      })
      await persist()
      if (activePage && !activePage.isClosed())
        await activePage.screenshot({
          path: resolve(
            h.artifactDir,
            `alignment-failure-${results.length}.png`
          ),
          fullPage: true
        })
      throw error
    }
  }
  const contexts: BrowserContext[] = []
  const contextFor = async (
    actor: Actor,
    viewport = targets[1],
    colorScheme: 'light' | 'dark' = 'light'
  ) => {
    const context = await h.browser.newContext({
      viewport,
      colorScheme,
      serviceWorkers: 'block'
    })
    contexts.push(context)
    await context.addCookies([
      { name: 'kun-galgame-patch-moe-token', value: actor.token, url: h.origin }
    ])
    const allowed = new Set([
      h.origin,
      new URL(process.env.KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT!).origin
    ])
    await context.route('**/*', (route) =>
      allowed.has(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort('blockedbyclient')
    )
    const page = await context.newPage()
    activePage = page
    return { context, page }
  }
  const actors: Actor[] = []
  for (let role = 1; role <= 4; role++)
    actors.push(await h.actor(`align${role}`, role))
  const owner = actors[1]
  const patch = await h.prisma.patch.create({
    data: {
      unique_id: randomUUID().replaceAll('-', '').slice(0, 8),
      name: `${h.run} ${'长游戏标题'.repeat(35)}`,
      user_id: owner.id,
      banner: '',
      introduction: '工作台一致性隔离合成条目。',
      content_limit: 'sfw',
      type: [],
      language: ['ja'],
      platform: ['windows'],
      engine: [],
      rating_stat: { create: {} }
    }
  })
  const own: Seed[] = []
  for (const actor of actors)
    own.push(
      await seedResource(
        h,
        actor,
        patch.id,
        `${h.run} role${actor.role} resource`,
        { second: actor.role < 3 }
      )
    )
  const readonly = await seedResource(
    h,
    owner,
    patch.id,
    `${h.run} banned resource`,
    { status: 1 }
  )
  const pending = await seedResource(
    h,
    owner,
    patch.id,
    `${h.run} pending resource`,
    { status: 2 }
  )
  const s3 = await seedResource(
    h,
    actors[3],
    patch.id,
    `${h.run} S3 resource`,
    { storage: 's3', section: 'patch' }
  )
  const single = await seedResource(h, owner, patch.id, `${h.run} single link`)
  const brokenPatch = await h.prisma.patch.create({
    data: {
      unique_id: randomUUID().replaceAll('-', '').slice(0, 8),
      name: `${h.run} broken banner`,
      user_id: owner.id,
      banner: '/alignment-missing-banner.avif',
      introduction: '损坏图回退。',
      content_limit: 'sfw',
      type: [],
      language: ['ja'],
      platform: ['windows'],
      engine: [],
      rating_stat: { create: {} }
    }
  })
  await seedResource(
    h,
    owner,
    brokenPatch.id,
    `${h.run} broken banner resource`
  )
  const loadedPatch = await h.prisma.patch.create({
    data: {
      unique_id: randomUUID().replaceAll('-', '').slice(0, 8),
      name: `${h.run} loaded banner`,
      user_id: owner.id,
      banner: '/favicon.webp',
      introduction: '正常封面正向展示。',
      content_limit: 'sfw',
      type: [],
      language: ['ja'],
      platform: ['windows'],
      engine: [],
      rating_stat: { create: {} }
    }
  })
  await seedResource(
    h,
    owner,
    loadedPatch.id,
    `${h.run} loaded banner resource`
  )
  const matrixEntries: { id: number; name: string; loaded: boolean }[] = []
  for (let index = 0; index < 3; index++) {
    const id = await createDraft(h, owner, `matrix entry ${index}`)
    if (index === 1)
      await h.prisma.patch_submission.update({
        where: { id },
        data: { banner_key: 'alignment-missing/banner.avif' }
      })
    if (index === 2)
      await h.prisma.patch_submission.update({
        where: { id },
        data: { banner_key: 'alignment-valid/banner.webp' }
      })
    matrixEntries.push({
      id,
      name: `${h.run} matrix entry ${index}`,
      loaded: index === 2
    })
  }
  // Persisted synthetic backlog makes independent resource/maintenance pagination observable.
  for (let index = 0; index < 22; index++) {
    const item = await seedResource(
      h,
      owner,
      patch.id,
      `${h.run} backlog ${index}`
    )
    const control = await h.prisma.patch_resource_link_maintenance.create({
      data: {
        original_link_id: item.links[0].id,
        link_id: item.links[0].id,
        link_version: 1,
        resource_id: item.id,
        patch_id: patch.id,
        owner_id: owner.id,
        latest_round: 1,
        revision: 1
      }
    })
    await h.prisma.patch_resource_link_maintenance_event.create({
      data: {
        control_id: control.id,
        round: 1,
        active_key: `maintenance:${control.id}`,
        state: 'pending',
        participants: { create: { user_id: actors[0].id } }
      }
    })
  }
  try {
    await scenario(
      'HTTP metadata, role 1/2/3/4 owner scope and management reads issue zero grants',
      async () => {
        const before = [
          await h.prisma.patch_resource_access.count({
            where: { patch_id: patch.id }
          }),
          await h.prisma.patch_resource_access_grant.count({
            where: { resource: { patch_id: patch.id } }
          })
        ]
        for (const [index, actor] of actors.entries()) {
          const list = json<WorkspaceResourcesResponse>(
            await h.request(actor, 'GET', '/api/workspace/resources?limit=50')
          )
          const item = list.items.find((row) => row.id === own[index].id)
          assert(item)
          assert.deepEqual(
            [item.patchBanner, item.type, item.language, item.platform],
            ['', ['pc', 'row'], ['ja'], ['windows']]
          )
          for (const field of [
            'note',
            'links',
            'content',
            'code',
            'password',
            'hash',
            'participants'
          ])
            assert(!Object.hasOwn(item, field), field)
          const detail = json<WorkspaceResourceDetail>(
            await h.request(actor, 'GET', resourcePath(own[index].id))
          )
          assert.deepEqual(
            [detail.patchBanner, detail.type, detail.language, detail.platform],
            [item.patchBanner, item.type, item.language, item.platform]
          )
          assert.equal(
            (
              await h.request(
                actor,
                'GET',
                resourcePath(own[(index + 1) % own.length].id)
              )
            ).status,
            404
          )
          assert.equal(
            (
              await h.request(
                actor,
                'POST',
                '/api/patch/resource/link/report',
                {
                  patchId: patch.id,
                  resourceId: own[index].id,
                  linkId: own[index].links[0].id,
                  linkVersion: own[index].links[0].version,
                  reason: 'deleted'
                }
              )
            ).status,
            403,
            'Management read must not grant current-version feedback eligibility'
          )
          if (actor.role < 3)
            assert.deepEqual(Object.keys(detail.links[1]).sort(), [
              'id',
              'protected',
              'storage',
              'version'
            ])
        }
        for (const item of [readonly, pending]) {
          const detail = json<WorkspaceResourceDetail>(
            await h.request(owner, 'GET', resourcePath(item.id))
          )
          assert.equal(detail.capabilities.canEdit, false)
          assert(
            detail.links.every(
              (link) => link.protected && Object.keys(link).length === 4
            )
          )
        }
        assert.deepEqual(
          [
            await h.prisma.patch_resource_access.count({
              where: { patch_id: patch.id }
            }),
            await h.prisma.patch_resource_access_grant.count({
              where: { resource: { patch_id: patch.id } }
            })
          ],
          before
        )
      }
    )
    await scenario(
      'four viewport × two theme matrix: resource/entry/profile/editor screenshots and fallbacks',
      async () => {
        for (const viewport of targets)
          for (const scheme of ['light', 'dark'] as const) {
            const { context, page } = await contextFor(owner, viewport, scheme)
            await page.goto(h.origin, { waitUntil: 'domcontentloaded' })
            await page.evaluate(
              (theme) => localStorage.setItem('theme', theme),
              scheme
            )
            for (const [label, path] of [
              ['resources', '/workspace/resources'],
              ['entries', '/workspace/entries'],
              ['profile', `/user/${owner.id}/resource`],
              ['editor', detailPath(own[1].id)]
            ]) {
              await page.goto(`${h.origin}${path}`, {
                waitUntil: 'networkidle'
              })
              await noOverflow(page, `${viewport.width} ${scheme} ${label}`)
              assert.equal(
                await page
                  .locator('html')
                  .evaluate((el) => el.classList.contains('dark')),
                scheme === 'dark'
              )
              if (label === 'resources') {
                await page
                  .getByRole('tab', { name: '资源列表', exact: true })
                  .waitFor()
                await page
                  .getByRole('textbox', { name: '搜索资源或游戏' })
                  .fill(h.run)
                await button(page, '搜索').first().click()
                const images = page.getByRole('tabpanel').locator('li img')
                await waitFor(
                  async () => (await images.count()) > 0,
                  'Resource covers missing'
                )
                assert.equal(
                  await images
                    .first()
                    .evaluate((el) => Boolean(el.closest('a'))),
                  false
                )
                await waitFor(
                  async () =>
                    ((await images.first().getAttribute('src')) ?? '').includes(
                      'otoame.avif'
                    ),
                  'Empty cover fallback absent'
                )
                const visibleCards = page.getByRole('tabpanel').locator('li')
                assert(
                  (await visibleCards.count()) > 0,
                  'Expected real resource cards'
                )
                for (const card of await visibleCards.all()) {
                  assert.equal(await card.locator('a').count(), 1)
                  assert.equal(await card.locator('img').count(), 1)
                  assert.equal(
                    await card
                      .locator('img')
                      .evaluate((image) => Boolean(image.closest('a'))),
                    false
                  )
                }
                await page
                  .getByRole('textbox', { name: '搜索资源或游戏' })
                  .fill('loaded banner resource')
                await button(page, '搜索').first().click()
                const loadedImage = page
                  .getByRole('tabpanel')
                  .locator('li img')
                  .first()
                await waitFor(
                  async () =>
                    ((await loadedImage.getAttribute('src')) ?? '').includes(
                      'favicon.webp'
                    ) &&
                    (await loadedImage.evaluate(
                      (el) =>
                        (el as HTMLImageElement).complete &&
                        (el as HTMLImageElement).naturalWidth > 0
                    )),
                  'Valid resource banner did not actually load'
                )
                await page.screenshot({
                  path: resolve(
                    h.artifactDir,
                    `alignment-${viewport.width}-${scheme}-loaded-banner.png`
                  ),
                  fullPage: true
                })
                await page
                  .getByRole('textbox', { name: '搜索资源或游戏' })
                  .fill('broken banner resource')
                await button(page, '搜索').first().click()
                const brokenImage = page
                  .getByRole('tabpanel')
                  .locator('li img')
                  .first()
                await waitFor(
                  async () =>
                    ((await brokenImage.getAttribute('src')) ?? '').includes(
                      'otoame.avif'
                    ),
                  'Broken image must fall back'
                )
                await page.screenshot({
                  path: resolve(
                    h.artifactDir,
                    `alignment-${viewport.width}-${scheme}-broken-banner.png`
                  ),
                  fullPage: true
                })
                await page
                  .getByRole('textbox', { name: '搜索资源或游戏' })
                  .fill(h.run)
                await button(page, '搜索').first().click()
                await select(page, '状态', '已封禁')
                await resourceCard(page, readonly.id)
                  .getByText('已封禁', { exact: true })
                  .waitFor()
              }
              if (label === 'entries') {
                if (viewport.width <= 390) {
                  const search = page.getByRole('textbox', {
                    name: '搜索条目',
                    exact: true
                  })
                  const submit = page
                    .locator('form')
                    .filter({ has: search })
                    .getByRole('button', { name: '搜索', exact: true })
                  assert.equal(await submit.isVisible(), true)
                  const inputBox = await search.boundingBox()
                  const buttonBox = await submit.boundingBox()
                  assert(
                    inputBox && buttonBox,
                    'Mobile entry search controls must be visible'
                  )
                  await writeFile(
                    resolve(
                      h.artifactDir,
                      `alignment-${viewport.width}-${scheme}-entry-search.json`
                    ),
                    JSON.stringify(
                      { sourceSha, viewport, scheme, inputBox, buttonBox },
                      null,
                      2
                    )
                  )
                  assert(
                    inputBox.width >= 160,
                    `Entry search input is only ${inputBox.width}px at ${viewport.width}px`
                  )
                  for (const box of [inputBox, buttonBox])
                    assert(
                      box.x >= -1 &&
                        box.y >= -1 &&
                        box.x + box.width <= viewport.width + 1 &&
                        box.y + box.height <= viewport.height + 1,
                      `Entry search control escapes viewport: ${JSON.stringify(box)}`
                    )
                  const overlapX =
                    Math.min(
                      inputBox.x + inputBox.width,
                      buttonBox.x + buttonBox.width
                    ) - Math.max(inputBox.x, buttonBox.x)
                  const overlapY =
                    Math.min(
                      inputBox.y + inputBox.height,
                      buttonBox.y + buttonBox.height
                    ) - Math.max(inputBox.y, buttonBox.y)
                  assert(
                    overlapX <= 0.5 || overlapY <= 0.5,
                    'Entry search input and button overlap'
                  )
                }
                for (const item of matrixEntries) {
                  const card = entryCard(page, item.name)
                  await card.waitFor()
                  assert.equal(await card.locator('img').count(), 1)
                  const image = card.locator('img')
                  await waitFor(
                    async () =>
                      ((await image.getAttribute('src')) ?? '').includes(
                        item.loaded ? 'alignment-valid' : 'otoame.avif'
                      ),
                    `Entry banner state missing for ${item.id}`
                  )
                  assert(
                    await image.evaluate(
                      (el) =>
                        (el as HTMLImageElement).complete &&
                        (el as HTMLImageElement).naturalWidth > 0
                    ),
                    'Entry image never decoded'
                  )
                }
              }
              await page.screenshot({
                path: resolve(
                  h.artifactDir,
                  `alignment-${viewport.width}-${scheme}-${label}.png`
                ),
                fullPage: true
              })
            }
            await context.close()
            await h.passed(
              `alignment matrix ${viewport.width}×${viewport.height} ${scheme}`
            )
          }
      }
    )
    await scenario(
      'unknown/loading resource and maintenance counts never pretend to be zero',
      async () => {
        const { page } = await contextFor(owner)
        let release: () => void = () => {}
        const gate = new Promise<void>((done) => {
          release = done
        })
        let held = false
        let maintenanceHeld = false
        let releaseMaintenance: () => void = () => {}
        const maintenanceGate = new Promise<void>((done) => {
          releaseMaintenance = done
        })
        await page.route('**/api/workspace/maintenance?*', async (route) => {
          maintenanceHeld = true
          await maintenanceGate
          await route.continue()
        })
        await page.route('**/api/workspace/resources?*', async (route) => {
          held = true
          await gate
          await route.continue()
        })
        try {
          await page.goto(`${h.origin}/workspace/resources`, {
            waitUntil: 'domcontentloaded'
          })
          await waitFor(() => held, 'Resource initial read not held')
          assert(
            !/共\s*0|待处理\s*0/.test(await page.getByRole('main').innerText()),
            'Unknown count rendered as zero'
          )
        } finally {
          release()
        }
        await page.unroute('**/api/workspace/resources?*')
        await page.getByRole('tab', { name: '链接维护', exact: true }).click()
        try {
          await waitFor(
            () => maintenanceHeld,
            'Maintenance initial read not held'
          )
          assert(
            !/待处理\s*0/.test(await page.getByRole('tabpanel').innerText()),
            'Unknown maintenance count rendered as zero'
          )
        } finally {
          releaseMaintenance()
        }
        // Actual non-empty server data must replace the loading state.
        await page
          .getByRole('link', { name: /打开资源/ })
          .first()
          .waitFor()
        assert(!/待处理\s*0/.test(await page.getByRole('tabpanel').innerText()))
      }
    )
    await scenario(
      'resource and maintenance shadcn tabs retain independent query, section and page',
      async () => {
        const { page } = await contextFor(owner)
        await page.goto(`${h.origin}/workspace/resources`, {
          waitUntil: 'networkidle'
        })
        const resourcesPanel = page.getByRole('tabpanel', {
          name: '资源列表',
          exact: true
        })
        const maintenancePanel = page.getByRole('tabpanel', {
          name: '链接维护',
          exact: true
        })
        await page
          .getByRole('textbox', { name: '搜索资源或游戏' })
          .fill(`${h.run} backlog`)
        await button(page, '搜索').click()
        await select(page, '分区', '游戏资源')
        await button(page, '下一页').click()
        await resourcesPanel.getByText('2 / 2', { exact: true }).waitFor()
        await page.getByRole('tab', { name: '链接维护', exact: true }).click()
        await maintenancePanel.getByText('1 / 2', { exact: true }).waitFor()
        await select(page, /维护分区|资源分区/, '全部分区')
        const maintenanceSearch = page.getByRole('textbox', {
          name: /搜索维护/
        })
        await maintenanceSearch.fill('backlog')
        await button(page, '搜索').click()
        await button(page, '下一页').click()
        await maintenancePanel.getByText('2 / 2', { exact: true }).waitFor()
        await page.getByRole('tab', { name: '资源列表', exact: true }).click()
        assert.equal(
          await page
            .getByRole('textbox', { name: '搜索资源或游戏' })
            .inputValue(),
          `${h.run} backlog`
        )
        assert(
          (
            await page
              .getByRole('combobox', { name: '分区', exact: true })
              .textContent()
          )?.includes('游戏资源')
        )
        await resourcesPanel.getByText('2 / 2', { exact: true }).waitFor()
        await page.getByRole('tab', { name: '链接维护', exact: true }).click()
        assert.equal(await maintenanceSearch.inputValue(), 'backlog')
        await maintenancePanel.getByText('2 / 2', { exact: true }).waitFor()
        await page
          .getByRole('link', { name: /打开资源/ })
          .first()
          .waitFor()
      }
    )
    await scenario(
      'role storage matrix, draft section upload affordance, readonly metadata and removal limits',
      async () => {
        for (const [index, actor] of actors.entries()) {
          const { page } = await contextFor(actor)
          const authority = json<WorkspaceResourceDetail>(
            await h.request(actor, 'GET', resourcePath(own[index].id))
          )
          await openEditor(page, h.origin, own[index].id)
          const storage = page
            .getByRole('combobox', { name: /链接存储|存储类型/ })
            .first()
          for (const section of ['galgame', 'patch'] as const) {
            if (section === 'patch') await select(page, '资源分区', '工具补丁')
            await storage.focus()
            await storage.press('ArrowDown')
            for (const kind of storageTypes) {
              const option = page.getByRole('option', {
                name: accessiblePrefix(kind.label)
              })
              assert.equal(await option.count(), 1)
              const allowed =
                actor.role > 3 ||
                kind.value === 'user' ||
                (actor.role > 1 && section === 'patch' && kind.value === 's3')
              assert.equal(
                (await option.getAttribute('aria-disabled')) === 'true',
                !allowed,
                `${actor.role}/${section}/${kind.value}`
              )
            }
            await page.keyboard.press('Escape')
            await page
              .getByRole('button', { name: /添加.*链接|新增.*链接/ })
              .click()
            const expectedDefault =
              actor.role > 3
                ? 'touchgal'
                : actor.role > 1 && section === 'patch'
                  ? 's3'
                  : 'user'
            const added = page
              .getByRole('combobox', { name: /链接存储|存储类型/ })
              .last()
            assert(
              (await added.textContent())?.includes(
                storageTypes.find((entry) => entry.value === expectedDefault)!
                  .label
              ),
              `Wrong empty-link default for ${actor.role}/${section}`
            )
            await page
              .getByRole('button', { name: /移除这条链接/ })
              .last()
              .click()
          }
          if (actor.role === 2) {
            await select(
              page,
              /链接存储|存储类型/,
              storageTypes.find((item) => item.value === 's3')!.label
            )
            assert.equal(
              await page.getByLabel('上传资源文件').isEnabled(),
              true
            )
            await select(page, '资源分区', '游戏资源')
            assert.equal(await page.getByLabel('上传资源文件').count(), 0)
            assert.equal(
              await page.getByLabel('校验值', { exact: true }).isEditable(),
              false
            )
            await select(
              page,
              /链接存储|存储类型/,
              storageTypes.find((entry) => entry.value === 'user')!.label
            )
          }
          assert.equal(
            await page.getByLabel('校验值', { exact: true }).count(),
            0,
            'External links have no editable hash'
          )
          assert.equal(
            await button(page, '删除资源').count(),
            authority.capabilities.canDelete ? 1 : 0
          )
          if (actor.role < 3)
            assert.equal(
              await page.getByRole('button', { name: /移除这条链接/ }).count(),
              1
            )
        }
        const { page } = await contextFor(actors[3])
        await openEditor(page, h.origin, s3.id)
        for (const label of ['链接地址', '资源大小', '校验值'])
          assert.equal(
            await page.getByLabel(label, { exact: true }).isEditable(),
            false
          )
        const staffS3 = await seedResource(
          h,
          actors[2],
          patch.id,
          `${h.run} staff existing S3`,
          { storage: 's3' }
        )
        const staffEditor = await contextFor(actors[2])
        await openEditor(staffEditor.page, h.origin, staffS3.id)
        assert.equal(
          await staffEditor.page.getByLabel('上传资源文件').isEnabled(),
          true,
          'Role3 existing galgame S3 upload must remain available'
        )
        const ordinary = await contextFor(owner)
        await openEditor(ordinary.page, h.origin, single.id)
        assert.equal(
          await ordinary.page
            .getByRole('button', { name: /移除这条链接|删除整个资源/ })
            .count(),
          0
        )
        let deletes = 0
        ordinary.page.on('request', (req) => {
          if (req.method() === 'DELETE') deletes++
        })
        await button(ordinary.page, '删除资源').click()
        await button(dialog(ordinary.page), '取消').click()
        assert.equal(deletes, 0)
      }
    )
    await scenario(
      'keyboard grouped classification preserves independent language and normalizes platform',
      async () => {
        const { page } = await contextFor(owner)
        await openEditor(page, h.origin, single.id)
        await checkbox(page, '资源语言', '简体中文', true)
        await checkbox(page, '资源类型', '手机游戏', true)
        await checkbox(page, '资源类型', 'PC游戏', false)
        await page
          .getByRole('button', { name: '中文支持', exact: true })
          .waitFor()
        const language = await page
          .getByRole('button', { name: '资源语言', exact: true })
          .textContent()
        assert(
          language?.includes('简体中文'),
          'Language must not be coupled to type'
        )
        await page
          .getByRole('button', { name: '资源平台', exact: true })
          .click()
        const windows = page.getByRole('menuitemcheckbox', { name: /Windows/ })
        if (await windows.count())
          assert.notEqual(
            await windows.getAttribute('aria-checked'),
            'true',
            'Type change must clear unsupported Windows'
          )
        await page.keyboard.press('Escape')
        await checkbox(page, '资源平台', 'Android', true)
        const saved = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === resourcePath(single.id) &&
            res.request().method() === 'PUT'
        )
        await button(page, '保存').click()
        assert.equal((await saved).status(), 200)
        const detail = json<WorkspaceResourceDetail>(
          await h.request(owner, 'GET', resourcePath(single.id))
        )
        assert(detail.type.includes('mobile') && !detail.type.includes('pc'))
        assert(
          detail.platform.includes('android') &&
            !detail.platform.includes('windows')
        )
        assert(
          detail.language.includes('zh-Hans') && detail.language.includes('ja'),
          `Expected independent Simplified Chinese and Japanese languages, got ${JSON.stringify(detail.language)}`
        )
        await noOverflow(
          page,
          'Grouped checkbox menus and classification layout'
        )
      }
    )
    await editorCases(
      h,
      owner,
      own[1],
      single,
      s3,
      actors[3],
      scenario,
      contextFor
    )
    await submissionCases(h, owner, actors[0], actors, scenario, contextFor)
    await profileCases(h, actors, scenario, contextFor)
    await maintenanceCases(h, owner, scenario, contextFor)
  } finally {
    for (const context of contexts) await context.close()
  }
}

type Scenario = (name: string, work: () => Promise<void>) => Promise<void>
type ContextFor = (
  actor: Actor,
  viewport?: { width: number; height: number },
  scheme?: 'light' | 'dark'
) => Promise<{ context: BrowserContext; page: Page }>

async function editorCases(
  h: Harness,
  owner: Actor,
  original: Seed,
  other: Seed,
  s3: Seed,
  staff: Actor,
  scenario: Scenario,
  contextFor: ContextFor
) {
  await scenario(
    'dirty reload cancel/fail/wrong target and 409 preserve draft/base; success replaces baseline',
    async () => {
      const { page } = await contextFor(owner)
      await openEditor(page, h.origin, original.id)
      const before = json<WorkspaceResourceDetail>(
        await h.request(owner, 'GET', resourcePath(original.id))
      )
      const draft = `${h.run} unsaved reload draft`
      await nameInput(page).fill(draft)
      let reads = 0
      const bases: unknown[] = []
      let failure: 'network' | 'string' | 'wrong-id' | 'none' = 'network'
      const handler = async (route: Route) => {
        if (route.request().method() === 'PUT') {
          bases.push(route.request().postDataJSON().baseLinks)
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify('受控编辑冲突')
          })
        }
        if (route.request().method() !== 'GET') return route.continue()
        reads++
        if (failure === 'network') return route.abort('failed')
        if (failure === 'string')
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify('受控读取失败')
          })
        if (failure === 'wrong-id')
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...before, id: other.id })
          })
        return route.continue()
      }
      await page.route(`**${resourcePath(original.id)}`, handler)
      await reload(page).click()
      await button(dialog(page), '取消').click()
      assert.equal(reads, 0)
      for (failure of ['network', 'string', 'wrong-id'] as const) {
        const beforeReads: number = reads
        const outcome =
          failure === 'network'
            ? page.waitForEvent('requestfailed', {
                predicate: (req) =>
                  new URL(req.url()).pathname === resourcePath(original.id) &&
                  req.method() === 'GET'
              })
            : page.waitForResponse(
                (res) =>
                  new URL(res.url()).pathname === resourcePath(original.id) &&
                  res.request().method() === 'GET'
              )
        await reload(page).click()
        await confirm(page).click()
        await outcome
        assert.equal(reads, beforeReads + 1)
        await page.getByRole('alert').last().waitFor()
        await waitFor(() => reload(page).isEnabled(), 'Reload did not settle')
        assert.equal(await nameInput(page).inputValue(), draft)
        const previousBases = bases.length
        const saved = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === resourcePath(original.id) &&
            res.request().method() === 'PUT'
        )
        await button(page, '保存').click()
        assert.equal((await saved).status(), 409)
        await waitFor(
          () => bases.length === previousBases + 1,
          'Save never reached the real request boundary'
        )
        assert.deepEqual(bases.at(-1), before.baseLinks)
        await waitFor(
          () => button(page, '保存').isEnabled(),
          '409 did not settle'
        )
        assert.equal(await nameInput(page).inputValue(), draft)
      }
      await h.prisma.patch_resource_link.update({
        where: { id: original.links[0].id },
        data: { version: { increment: 1 } }
      })
      const latest = json<WorkspaceResourceDetail>(
        await h.request(owner, 'GET', resourcePath(original.id))
      )
      failure = 'none'
      await reload(page).click()
      await confirm(page).click()
      await waitFor(
        async () => (await nameInput(page).inputValue()) === latest.name,
        'Successful latest read did not replace the draft'
      )
      await nameInput(page).fill(`${h.run} latest session`)
      const count = bases.length
      await button(page, '保存').click()
      await waitFor(
        () => bases.length === count + 1,
        'Latest baseline was not submitted'
      )
      assert.deepEqual(bases.at(-1), latest.baseLinks)
      await waitFor(
        () => button(page, '保存').isEnabled(),
        'Save remained pending'
      )
      await page.unroute(`**${resourcePath(original.id)}`, handler)
    }
  )
  await scenario(
    'real maintenance background refresh preserves dirty editor baseline and dialog payload boundaries',
    async () => {
      const { page } = await contextFor(owner)
      // This item is a real persisted pending backlog, not a mocked maintenance response.
      const list = json<{ items: { resourceId: number }[] }>(
        await h.request(
          owner,
          'GET',
          '/api/workspace/maintenance?view=feedback&limit=50'
        )
      )
      const target = list.items[0]
      assert(target)
      await openEditor(page, h.origin, target.resourceId)
      const base = json<WorkspaceResourceDetail>(
        await h.request(owner, 'GET', resourcePath(target.resourceId))
      )
      const draft = `${h.run} keep after real snooze`
      await nameInput(page).fill(draft)
      const posts: Record<string, unknown>[] = []
      page.on('request', (req) => {
        if (
          new URL(req.url()).pathname === '/api/workspace/maintenance' &&
          req.method() === 'POST'
        )
          posts.push(req.postDataJSON())
      })
      assert.equal(
        await page
          .getByRole('textbox', { name: '维护说明', exact: true })
          .count(),
        0
      )
      await button(page, '暂缓').first().click()
      assert.equal(
        await dialog(page).getByRole('textbox', { name: '维护说明' }).count(),
        0
      )
      await select(page, '暂缓天数', /1/)
      await button(dialog(page), '取消').click()
      assert.equal(posts.length, 0)
      await button(page, '暂缓').first().click()
      const refresh = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(target.resourceId) &&
          res.request().method() === 'GET'
      )
      await confirm(page).click()
      await refresh
      assert.equal(await nameInput(page).inputValue(), draft)
      assert.equal(posts[0].action, 'snooze')
      assert.equal(posts[0].days, 1)
      assert(!Object.hasOwn(posts[0], 'note'))
      let submitted: unknown
      await page.route(`**${resourcePath(target.resourceId)}`, (route) => {
        if (route.request().method() !== 'PUT') return route.continue()
        submitted = route.request().postDataJSON().baseLinks
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify('受控编辑冲突')
        })
      })
      await button(page, '保存').click()
      await waitFor(
        () => submitted !== undefined,
        'Background baseline save missing'
      )
      assert.deepEqual(submitted, base.baseLinks)
    }
  )
  await scenario(
    'same-id reload keeps failed upload on cancel/error/409 and clears it only after a successful new session',
    async () => {
      assert.equal(staff.role, 4)
      const item = await seedResource(
        h,
        staff,
        s3.patch_id,
        `${h.run} same-id upload session`,
        { storage: 's3', section: 'patch' }
      )
      const { page } = await contextFor(staff)
      await openEditor(page, h.origin, item.id)
      const before = json<WorkspaceResourceDetail>(
        await h.request(staff, 'GET', resourcePath(item.id))
      )
      const filename = 'alignment-retained-failure.zip'
      let uploads = 0
      await page.route('**/api/upload/resource', (route) => {
        uploads++
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify('受控上传失败')
        })
      })
      await page.getByLabel('上传资源文件').setInputFiles({
        name: filename,
        mimeType: 'application/zip',
        buffer: Buffer.alloc(1024, 5)
      })
      const retry = button(page, '重试上传')
      const failedFile = page.getByText(filename, { exact: true })
      await retry.waitFor()
      await failedFile.waitFor()
      assert.equal(uploads, 1)
      const draftName = `${h.run} retain failed upload draft`
      await nameInput(page).fill(draftName)
      let reads = 0
      let failRead = true
      let submittedBase: unknown
      const handler = (route: Route) => {
        if (route.request().method() === 'PUT') {
          submittedBase = route.request().postDataJSON().baseLinks
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify('受控编辑冲突')
          })
        }
        if (route.request().method() !== 'GET') return route.continue()
        reads++
        if (!failRead) return route.continue()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('受控读取失败：保留上传状态')
        })
      }
      await page.route(`**${resourcePath(item.id)}`, handler)
      const assertRetained = async () => {
        assert.equal(await nameInput(page).inputValue(), draftName)
        assert.equal(await failedFile.isVisible(), true)
        assert.equal(await retry.isEnabled(), true)
        assert.equal(uploads, 1, 'Reload must not retry an upload')
      }
      await reload(page).click()
      await button(dialog(page), '取消').click()
      assert.equal(reads, 0, 'Cancelled dirty reload must not send GET')
      await assertRetained()
      const failedRead = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(item.id) &&
          res.request().method() === 'GET'
      )
      await reload(page).click()
      await confirm(page).click()
      assert.equal(typeof (await (await failedRead).json()), 'string')
      await waitFor(
        () => reload(page).isEnabled(),
        'Failed reload did not settle'
      )
      assert.equal(reads, 1)
      await assertRetained()
      const conflicted = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(item.id) &&
          res.request().method() === 'PUT'
      )
      await button(page, '保存').click()
      assert.equal((await conflicted).status(), 409)
      await waitFor(
        () => button(page, '保存').isEnabled(),
        '409 did not settle'
      )
      assert.deepEqual(submittedBase, before.baseLinks)
      await assertRetained()
      failRead = false
      const latestRead = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(item.id) &&
          res.request().method() === 'GET'
      )
      await reload(page).click()
      await confirm(page).click()
      const response = await latestRead
      assert.equal(response.status(), 200)
      const latest = (await response.json()) as WorkspaceResourceDetail
      assert.equal(latest.id, before.id)
      assert.deepEqual(latest.baseLinks, before.baseLinks)
      assert.deepEqual(
        latest.links.map(({ id, version }) => ({ id, version })),
        before.links.map(({ id, version }) => ({ id, version }))
      )
      await waitFor(
        async () => (await nameInput(page).inputValue()) === before.name,
        'Successful same-id reload did not restore the server draft'
      )
      await waitFor(
        async () =>
          (await retry.count()) === 0 && (await failedFile.count()) === 0,
        'Successful same-id/same-version reload kept the previous failed file session'
      )
      assert.equal(
        await page.getByLabel('资源备注', { exact: true }).inputValue(),
        before.note
      )
      assert.equal(reads, 2)
      assert.equal(uploads, 1)
      await page.unroute(`**${resourcePath(item.id)}`, handler)
    }
  )
  await scenario(
    'delayed genuine upload receipt preserves newer draft fields or their explicitly disabled originals',
    async () => {
      assert.equal(staff.role, 4)
      const item = await seedResource(
        h,
        staff,
        s3.patch_id,
        `${h.run} upload merge session`,
        { storage: 's3', section: 'patch', second: true }
      )
      const { page } = await contextFor(staff)
      await openEditor(page, h.origin, item.id)
      const fields = [
        {
          label: '资源名称',
          input: nameInput(page),
          next: `${h.run} latest upload name`
        },
        {
          label: '资源备注',
          input: page.getByLabel('资源备注', { exact: true }),
          next: `${h.run} latest upload note`
        },
        {
          label: '提取码',
          input: page.getByLabel('提取码', { exact: true }).first(),
          next: 'new-code'
        },
        {
          label: '解压码',
          input: page.getByLabel('解压码', { exact: true }).first(),
          next: 'new-password'
        },
        {
          label: '另一链接提取码',
          input: page.getByLabel('提取码', { exact: true }).nth(1),
          next: 'other-new-code'
        }
      ]
      const observed: {
        label: string
        disabled: boolean
        original: string
        expected: string
      }[] = []
      for (const field of fields) {
        assert.equal(
          await field.input.isEditable(),
          true,
          `${field.label} must start editable`
        )
        const original = await field.input.inputValue()
        observed.push({
          label: field.label,
          disabled: false,
          original,
          expected: original
        })
      }
      let uploaded: KunUploadFileResponse | undefined
      let release: () => void = () => {}
      const gate = new Promise<void>((done) => {
        release = done
      })
      let uploadFinished: () => void = () => {}
      const uploadSettled = new Promise<void>((done) => {
        uploadFinished = done
      })
      const handler = async (route: Route) => {
        const response = await route.fetch()
        assert.equal(
          response.status(),
          200,
          'Genuine upload API must succeed before holding its receipt'
        )
        const result = (await response.json()) as KunUploadFileResponse | string
        assert.notEqual(
          typeof result,
          'string',
          'Real upload returned an error'
        )
        assert(
          typeof result !== 'string' &&
            result.uploadId &&
            result.fileHash &&
            result.fileSize
        )
        assert.equal(result.filetype, 's3')
        uploaded = result
        await gate
        await route.fulfill({ response })
        uploadFinished()
      }
      await page.route('**/api/upload/resource', handler)
      try {
        await page.getByLabel('上传资源文件').setInputFiles({
          name: 'alignment-merge-receipt.zip',
          mimeType: 'application/zip',
          buffer: Buffer.alloc(1024, 6)
        })
        await waitFor(
          () => uploaded !== undefined,
          'Genuine upload did not reach the held receipt'
        )
        for (const [index, field] of fields.entries()) {
          const entry = observed[index]
          entry.disabled = await field.input.isDisabled()
          if (entry.disabled) {
            assert.equal(await field.input.isEditable(), false)
            assert.equal(await field.input.inputValue(), entry.original)
          } else {
            assert.equal(
              await field.input.isEditable(),
              true,
              `${field.label} is neither editable nor disabled`
            )
            await field.input.fill(field.next)
            entry.expected = field.next
          }
          assert.equal(await field.input.inputValue(), entry.expected)
        }
        await writeFile(
          resolve(h.artifactDir, 'upload-draft-field-guards.json'),
          JSON.stringify(
            {
              run: h.run,
              sourceSha: process.env.KUN_E2E_SOURCE_SHA,
              fields: observed
            },
            null,
            2
          )
        )
        release()
        await within(uploadSettled, 'Genuine upload receipt was not delivered')
        assert(uploaded)
        await waitFor(
          async () =>
            (await page
              .getByLabel('校验值', { exact: true })
              .first()
              .inputValue()) === uploaded!.fileHash &&
            (await button(page, '保存').isEnabled()),
          'Registered upload metadata did not enter the current draft'
        )
        for (const [index, field] of fields.entries())
          assert.equal(
            await field.input.inputValue(),
            observed[index].expected,
            `${field.label} was overwritten by an old upload session`
          )
        assert.equal(
          await page
            .getByLabel('资源大小', { exact: true })
            .first()
            .inputValue(),
          uploaded.fileSize
        )
        const save = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === resourcePath(item.id) &&
            res.request().method() === 'PUT'
        )
        await button(page, '保存').click()
        const response = await save
        assert.equal(
          response.status(),
          200,
          'Real save with registered upload must succeed'
        )
        assert.notEqual(typeof (await response.json()), 'string')
        const submitted = response
          .request()
          .postDataJSON() as WorkspaceResourceUpdateInput
        assert.equal(submitted.name, observed[0].expected)
        assert.equal(submitted.note, observed[1].expected)
        const link = submitted.links.find(
          (entry) => entry.id === item.links[0].id
        )
        assert(link && 'uploadId' in link)
        assert.equal(link.uploadId, uploaded.uploadId)
        assert.equal(link.hash, uploaded.fileHash)
        assert.equal(link.size, uploaded.fileSize)
        const saved = json<WorkspaceResourceDetail>(
          await h.request(staff, 'GET', resourcePath(item.id))
        )
        assert.equal(saved.name, observed[0].expected)
        assert.equal(saved.note, observed[1].expected)
        const savedLink = saved.links.find(
          (entry) => entry.id === item.links[0].id
        )
        const otherLink = saved.links.find(
          (entry) => entry.id === item.links[1].id
        )
        assert(
          savedLink && !savedLink.protected && otherLink && !otherLink.protected
        )
        assert.equal(savedLink.code, observed[2].expected)
        assert.equal(savedLink.password, observed[3].expected)
        assert.equal(otherLink.code, observed[4].expected)
        assert.equal(savedLink.hash, uploaded.fileHash)
        assert.equal(savedLink.size, uploaded.fileSize)
        assert.equal(savedLink.storage, 's3')
      } finally {
        release()
        await page.unroute('**/api/upload/resource', handler)
      }
    }
  )
  await scenario(
    'upload/save pending disables destructive/session actions; stale actual upload cannot cross targets',
    async () => {
      const { page } = await contextFor(staff)
      await openEditor(page, h.origin, s3.id)
      let held: Route | undefined
      let uploadFinished: () => void = () => {}
      const uploadSettled = new Promise<void>((done) => {
        uploadFinished = done
      })
      let release: () => void = () => {}
      const gate = new Promise<void>((done) => {
        release = done
      })
      const handler = async (route: Route) => {
        const response = await route.fetch()
        held = route
        await gate
        await route.fulfill({ response })
        uploadFinished()
      }
      await page.route('**/api/upload/resource', handler)
      try {
        await page.getByLabel('上传资源文件').setInputFiles({
          name: 'alignment-delayed.zip',
          mimeType: 'application/zip',
          buffer: Buffer.alloc(1024, 4)
        })
        await waitFor(
          () => Boolean(held),
          'Real upload did not complete at the held response boundary'
        )
        for (const name of ['保存', '删除资源', '载入最新版本'])
          assert.equal(await button(page, name).isDisabled(), true, name)
        const destination = await seedResource(
          h,
          staff,
          s3.patch_id,
          `${h.run} new upload target`
        )
        await navigateEditor(page, destination)
        release()
        await within(uploadSettled, 'Old upload callback did not settle')
        await page.waitForTimeout(100)
        await page.unroute('**/api/upload/resource', handler)
        assert.equal(await nameInput(page).inputValue(), destination.name)
        assert.equal(
          await page.getByLabel('校验值', { exact: true }).count(),
          0
        )
        assert(
          (
            await page
              .getByRole('combobox', { name: /存储类型|链接存储/ })
              .first()
              .textContent()
          )?.includes(
            storageTypes.find((entry) => entry.value === 'user')!.label
          )
        )
      } finally {
        release()
      }
      let putSeen = false
      let releaseSave: () => void = () => {}
      const saveGate = new Promise<void>((done) => {
        releaseSave = done
      })
      await openEditor(page, h.origin, s3.id)
      const submittedName = `${h.run} held real save`
      const laterName = `${h.run} typed after save submission`
      await nameInput(page).fill(submittedName)
      let readsAfterSave = 0
      let nameDisabledDuringSave = false
      const saveHandler = async (route: Route) => {
        if (route.request().method() === 'GET') readsAfterSave++
        if (route.request().method() !== 'PUT') return route.continue()
        assert.equal(route.request().postDataJSON().name, submittedName)
        putSeen = true
        await saveGate
        await route.continue()
      }
      await page.route(`**${resourcePath(s3.id)}`, saveHandler)
      const saved = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(s3.id) &&
          res.request().method() === 'PUT'
      )
      const reread = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === resourcePath(s3.id) &&
          res.request().method() === 'GET'
      )
      try {
        await button(page, '保存').click()
        await waitFor(() => putSeen, 'Pending save not observed')
        assert.equal(await reload(page).isDisabled(), true)
        nameDisabledDuringSave = await nameInput(page).isDisabled()
        if (nameDisabledDuringSave) {
          assert.equal(await nameInput(page).isEditable(), false)
          assert.equal(await nameInput(page).inputValue(), submittedName)
        } else {
          assert.equal(await nameInput(page).isEditable(), true)
          await nameInput(page).fill(laterName)
          assert.equal(await nameInput(page).inputValue(), laterName)
        }
      } finally {
        releaseSave()
      }
      const savedResponse = await saved
      assert.equal(savedResponse.status(), 200, 'Held real PUT must succeed')
      assert.notEqual(typeof (await savedResponse.json()), 'string')
      const rereadResponse = await reread
      assert.equal(rereadResponse.status(), 200)
      const canonical = (await rereadResponse.json()) as WorkspaceResourceDetail
      assert.equal(canonical.id, s3.id)
      assert.equal(
        canonical.name,
        submittedName,
        'Late input must stay unsaved'
      )
      await waitFor(
        async () =>
          (await button(page, '保存').isEnabled()) &&
          (await reload(page).isEnabled()),
        'Actual save did not settle'
      )
      const retainedName = nameDisabledDuringSave ? submittedName : laterName
      assert.equal(await nameInput(page).inputValue(), retainedName)
      assert.equal(await nameInput(page).isEnabled(), true)
      const readsBeforeCancel = readsAfterSave
      assert.equal(
        readsBeforeCancel,
        1,
        'Committed save must finish its detail GET'
      )
      if (!nameDisabledDuringSave) {
        await reload(page).click()
        await dialog(page).waitFor()
        assert.equal(
          readsAfterSave,
          readsBeforeCancel,
          'Dirty reload must await confirmation'
        )
        await button(dialog(page), '取消').click()
        assert.equal(
          readsAfterSave,
          readsBeforeCancel,
          'Cancelled reload must not send GET'
        )
        assert.equal(await nameInput(page).inputValue(), laterName)
      }
      await writeFile(
        resolve(h.artifactDir, 'held-save-edit-guards.json'),
        JSON.stringify(
          {
            run: h.run,
            sourceSha: process.env.KUN_E2E_SOURCE_SHA,
            nameDisabledDuringSave,
            submittedName,
            retainedName,
            dirtyConfirmationChecked: !nameDisabledDuringSave
          },
          null,
          2
        )
      )
      await page.unroute(`**${resourcePath(s3.id)}`, saveHandler)
      const late = await contextFor(owner)
      await openEditor(late.page, h.origin, original.id)
      let readSeen = false
      let readFinished: () => void = () => {}
      const readSettled = new Promise<void>((done) => {
        readFinished = done
      })
      let releaseRead: () => void = () => {}
      const readGate = new Promise<void>((done) => {
        releaseRead = done
      })
      await late.page.route(`**${resourcePath(original.id)}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        readSeen = true
        await readGate
        await route.fulfill({ response })
        readFinished()
      })
      try {
        await reload(late.page).click()
        await waitFor(() => readSeen, 'Latest read not held')
        await navigateEditor(late.page, other)
        releaseRead()
        await within(readSettled, 'Old read callback did not settle')
        await late.page.waitForTimeout(100)
        assert.equal(await nameInput(late.page).inputValue(), other.name)
      } finally {
        releaseRead()
      }
    }
  )
}

const createDraft = async (h: Harness, actor: Actor, title: string) => {
  const response = json<{ submissionId: number }>(
    await h.request(actor, 'POST', '/api/patch-submission', {
      requestId: randomUUID().replaceAll('-', ''),
      payload: { name: `${h.run} ${title}`, introduction: '' }
    })
  )
  return response.submissionId
}
async function draftStorage(page: Page, id: number, seed = false) {
  return page.evaluate(
    async ({ id, seed }) => {
      const database = await new Promise<IDBDatabase>((done, fail) => {
        const open = indexedDB.open('kun-otoame')
        open.onupgradeneeded = () => {
          if (
            !open.result.objectStoreNames.contains(
              'patch_submission_gallery_uploads'
            )
          )
            open.result.createObjectStore('patch_submission_gallery_uploads')
        }
        open.onsuccess = () => done(open.result)
        open.onerror = () => fail(open.error)
      })
      const keys = [
        `submission:${id}`,
        `submission:${id}:watermark`,
        `submission:${id}:order`
      ]
      try {
        if (seed)
          await new Promise<void>((done, fail) => {
            const tx = database.transaction(
              'patch_submission_gallery_uploads',
              'readwrite'
            )
            keys.forEach((key) =>
              tx.objectStore('patch_submission_gallery_uploads').put([], key)
            )
            tx.oncomplete = () => done()
            tx.onerror = () => fail(tx.error)
          })
        return await new Promise<string[]>((done, fail) => {
          const tx = database.transaction(
            'patch_submission_gallery_uploads',
            'readonly'
          )
          const result = tx
            .objectStore('patch_submission_gallery_uploads')
            .getAllKeys()
          result.onsuccess = () =>
            done(
              result.result
                .filter((key) => keys.includes(String(key)))
                .map(String)
            )
          result.onerror = () => fail(result.error)
        })
      } finally {
        database.close()
      }
    },
    { id, seed }
  )
}

async function submissionCases(
  h: Harness,
  publisher: Actor,
  author: Actor,
  viewers: Actor[],
  scenario: Scenario,
  contextFor: ContextFor
) {
  const statuses = [
    'draft',
    'changes_requested',
    'pending',
    'rejected',
    'violation'
  ] as const
  const seeds: patch_submission[] = []
  for (const status of statuses) {
    const id = await createDraft(h, author, `entry ${status}`)
    const row = await h.prisma.patch_submission.update({
      where: { id },
      data: { status }
    })
    seeds.push(row)
  }
  await scenario(
    'submission cards show banners, exact status actions, and published has only one view action',
    async () => {
      const { page } = await contextFor(author)
      await page.goto(`${h.origin}/workspace/entries`, {
        waitUntil: 'networkidle'
      })
      for (const item of seeds) {
        const card = entryCard(page, item.name)
        await card.waitFor()
        assert.equal(await card.locator('img').count(), 1)
        assert.equal(
          await card.getByRole('link', { name: /继续编辑/ }).count(),
          ['draft', 'changes_requested'].includes(item.status) ? 1 : 0
        )
        assert.equal(
          await card.getByRole('button', { name: /撤回/ }).count(),
          item.status === 'pending' ? 1 : 0
        )
        if (item.status === 'pending')
          assert.equal(await card.locator('[aria-haspopup="menu"]').count(), 0)
        if (['rejected', 'violation', 'pending'].includes(item.status))
          assert.equal(
            await card.getByRole('link', { name: /查看/ }).count(),
            1
          )
      }
      await select(page, '投稿状态', /全部/)
      await page.getByRole('combobox', { name: '投稿状态' }).press('ArrowDown')
      assert.equal(
        await page.getByRole('option', { name: /^(已发布|已删除)$/ }).count(),
        0
      )
      await page.keyboard.press('Escape')
      const pending = seeds.find((item) => item.status === 'pending')!
      const withdrawal = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname ===
            `/api/patch-submission/${pending.id}/withdraw` &&
          res.request().method() === 'POST'
      )
      await entryCard(page, pending.name)
        .getByRole('button', { name: '撤回', exact: true })
        .click()
      assert.equal((await withdrawal).status(), 200)
      assert.equal(
        (
          await h.prisma.patch_submission.findUniqueOrThrow({
            where: { id: pending.id }
          })
        ).status,
        'draft'
      )
      for (const viewer of viewers) {
        if (viewer.id !== publisher.id)
          await h.prisma.patch.create({
            data: {
              unique_id: randomUUID().replaceAll('-', '').slice(0, 8),
              name: `${h.run} role${viewer.role} published`,
              user_id: viewer.id,
              banner: '',
              introduction: '合成已发布条目',
              content_limit: 'sfw',
              type: [],
              language: ['ja'],
              platform: ['windows'],
              engine: [],
              rating_stat: { create: {} }
            }
          })
        const current = await contextFor(viewer)
        await current.page.goto(`${h.origin}/workspace/entries`, {
          waitUntil: 'networkidle'
        })
        await button(current.page, '已发布').click()
        await waitFor(
          async () =>
            (await current.page
              .locator('li')
              .filter({
                has: current.page.getByRole('link', {
                  name: '查看条目',
                  exact: true
                })
              })
              .count()) > 0,
          'Published cards missing'
        )
        const cards = current.page.locator('li').filter({
          has: current.page.getByRole('link', {
            name: '查看条目',
            exact: true
          })
        })
        for (const card of await cards.all()) {
          assert.equal(await card.locator('a').count(), 1)
          assert.equal(await card.locator('img').count(), 1)
          assert(
            !(await card.locator('a').getAttribute('href'))?.includes(
              '/rewrite'
            )
          )
        }
        if (viewer.role < 3)
          assert.equal(
            await current.page
              .getByText(/已发布条目的修改申请暂未开放，后续将逐步支持/)
              .count(),
            1
          )
      }
    }
  )
  await scenario(
    'real draft deletion refunds once, clears local draft and cannot resurrect after failed/late refresh; hide keeps both',
    async () => {
      const id = await createDraft(h, author, 'delete accounting')
      const submitted = await h.prisma.patch_submission.findUniqueOrThrow({
        where: { id }
      })
      const { page } = await contextFor(author)
      await page.goto(`${h.origin}/workspace/entries`, {
        waitUntil: 'networkidle'
      })
      assert.equal((await draftStorage(page, id, true)).length, 3)
      let failDelete = true
      let failRefresh = false
      let holdRefresh = false
      let readHeld = false
      let finishOldRead: () => void = () => {}
      const oldReadSettled = new Promise<void>((done) => {
        finishOldRead = done
      })
      let releaseRead: () => void = () => {}
      const readGate = new Promise<void>((done) => {
        releaseRead = done
      })
      await page.route(`**/api/patch-submission/${id}`, async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue()
        if (failDelete)
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify('受控删除失败')
          })
        failRefresh = true
        return route.continue()
      })
      await page.route('**/api/workspace/entries?*', async (route) => {
        if (failRefresh) return route.abort('failed')
        if (!holdRefresh) return route.continue()
        const response = await route.fetch()
        readHeld = true
        await readGate
        await route.fulfill({ response })
        finishOldRead()
      })
      const openDelete = async () => {
        await entryCard(page, submitted.name)
          .locator('button[aria-haspopup="menu"]')
          .click()
        await page.getByRole('menuitem', { name: /删除/ }).click()
        assert(
          (await dialog(page).textContent())?.includes(
            String(submitted.held_amount)
          )
        )
      }
      await openDelete()
      await button(dialog(page), '删除并返还').click()
      await dialog(page).getByRole('alert').waitFor()
      assert.equal((await draftStorage(page, id)).length, 3)
      await button(dialog(page), '取消').click()
      await entryCard(page, submitted.name).waitFor()
      failDelete = false
      holdRefresh = true
      await page.getByRole('textbox', { name: '搜索条目' }).fill(submitted.name)
      await button(page, '搜索').click()
      await waitFor(() => readHeld, 'Old entries response not held')
      const before = await h.prisma.user.findUniqueOrThrow({
        where: { id: author.id }
      })
      try {
        await openDelete()
        const deleted = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === `/api/patch-submission/${id}` &&
            res.request().method() === 'DELETE'
        )
        await button(dialog(page), '删除并返还').click()
        assert.equal((await deleted).status(), 200)
        await waitFor(
          async () => (await entryCard(page, submitted.name).count()) === 0,
          'Deleted card remains'
        )
        await waitFor(
          async () => (await draftStorage(page, id)).length === 0,
          'Draft storage was not cleared'
        )
        releaseRead()
        await within(
          oldReadSettled,
          'Late submission list response never settled'
        )
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
        )
        assert.equal(
          await entryCard(page, submitted.name).count(),
          0,
          'Late read resurrected a deleted draft'
        )
        const after = await h.prisma.user.findUniqueOrThrow({
          where: { id: author.id }
        })
        assert.equal(after.moemoepoint, before.moemoepoint)
        assert.equal(
          after.moemoepoint_reserved,
          before.moemoepoint_reserved - submitted.held_amount
        )
        const releaseCount = () =>
          h.prisma.user_moemoepoint_ledger.count({
            where: {
              user_id: author.id,
              reason_code: PATCH_SUBMISSION_REASON.depositReleased.code,
              reference_type: 'patch_submission',
              reference_id: String(id)
            }
          })
        assert.equal(await releaseCount(), 1)
        assert.equal(
          typeof (
            await h.request(author, 'DELETE', `/api/patch-submission/${id}`)
          ).data,
          'string'
        )
        assert.equal(await releaseCount(), 1)
        assert.equal(
          (await h.prisma.user.findUniqueOrThrow({ where: { id: author.id } }))
            .moemoepoint_reserved,
          after.moemoepoint_reserved
        )
      } finally {
        releaseRead()
      }
      await page.unroute('**/api/workspace/entries?*')
      await page.goto(`${h.origin}/workspace/entries`, {
        waitUntil: 'networkidle'
      })
      const terminal = seeds.find((item) => item.status === 'rejected')!
      await draftStorage(page, terminal.id, true)
      const balance = await h.prisma.user.findUniqueOrThrow({
        where: { id: author.id }
      })
      const ledgerBefore = await h.prisma.user_moemoepoint_ledger.count({
        where: { user_id: author.id }
      })
      const hidden = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname ===
            `/api/patch-submission/${terminal.id}` &&
          res.request().method() === 'PATCH'
      )
      await entryCard(page, terminal.name)
        .getByRole('button', { name: '从列表隐藏', exact: true })
        .click()
      assert.equal((await hidden).status(), 200)
      assert.equal(
        (
          await h.prisma.patch_submission.findUniqueOrThrow({
            where: { id: terminal.id }
          })
        ).hidden_by_user,
        true
      )
      await waitFor(
        async () => (await entryCard(page, terminal.name).count()) === 0,
        'Hidden card remains'
      )
      assert.equal((await draftStorage(page, terminal.id)).length, 3)
      const hiddenBalance = await h.prisma.user.findUniqueOrThrow({
        where: { id: author.id }
      })
      assert.deepEqual(
        [hiddenBalance.moemoepoint, hiddenBalance.moemoepoint_reserved],
        [balance.moemoepoint, balance.moemoepoint_reserved]
      )
      assert.equal(
        await h.prisma.user_moemoepoint_ledger.count({
          where: { user_id: author.id }
        }),
        ledgerBefore
      )
    }
  )
}

async function profileCases(
  h: Harness,
  actors: Actor[],
  scenario: Scenario,
  contextFor: ContextFor
) {
  await scenario(
    'profile owner-only full-width workspace action, admin action and avatar navigation',
    async () => {
      for (const actor of [actors[0], actors[2]]) {
        const { context, page } = await contextFor(actor)
        const session = json<UserSession>(
          await h.request(actor, 'GET', '/api/user/session')
        )
        assert.equal(session.user.uid, actor.id)
        assert.equal(session.user.role, actor.role)
        await context.addInitScript(
          ({ user, origin }) => {
            if (location.origin === origin)
              localStorage.setItem(
                'kun-patch-user-store',
                JSON.stringify({ state: { user }, version: 0 })
              )
          },
          { user: session.user, origin: h.origin }
        )
        await page.goto(`${h.origin}/user/${actor.id}/resource`, {
          waitUntil: 'networkidle'
        })
        assert.equal(await page.getByRole('tab', { name: /工作台/ }).count(), 0)
        const action = button(page, '用户工作台')
        await action.waitFor()
        assert.equal(
          await button(page, '管理后台').count(),
          actor.role >= 3 ? 1 : 0
        )
        const box = await action.boundingBox()
        const parent = await action.evaluate(
          (el) => el.parentElement!.getBoundingClientRect().width
        )
        assert(
          box && box.width >= parent - 2,
          'Workspace button is not a full row'
        )
        if (actor.role >= 3) {
          const admin = button(page, '管理后台')
          assert.match((await action.getAttribute('class')) ?? '', /bg-primary/)
          assert.equal(
            await action.evaluate((el) => getComputedStyle(el).backgroundColor),
            await admin.evaluate((el) => getComputedStyle(el).backgroundColor)
          )
          await admin.click()
          await page.waitForURL('**/dashboard')
          await page.goBack({ waitUntil: 'networkidle' })
        }
        await action.click()
        await page.waitForURL(/\/workspace(?:\/resources)?$/)
        await page.goto(`${h.origin}/user/${actors[1].id}/resource`, {
          waitUntil: 'networkidle'
        })
        assert.equal(await button(page, '用户工作台').count(), 0)
        assert.equal(await button(page, '管理后台').count(), 0)
        // The global avatar entry remains independently available.
        const avatar = page.getByRole('button').filter({
          has: page.getByRole('img', {
            name: actor.name.charAt(0).toUpperCase(),
            exact: true
          })
        })
        assert.equal(
          await avatar.count(),
          1,
          'Expected the global avatar trigger identified by its actual Avatar name'
        )
        await avatar.click()
        await page
          .getByRole('menu', { name: 'Profile Actions' })
          .getByRole('menuitem', { name: /工作台|我的资源/ })
          .first()
          .waitFor()
      }
    }
  )
}

async function maintenanceCases(
  h: Harness,
  owner: Actor,
  scenario: Scenario,
  contextFor: ContextFor
) {
  await scenario(
    'maintenance dialogs preserve notes on cancel/error; only the selected action fields are sent',
    async () => {
      const { page } = await contextFor(owner)
      const list = json<{
        items: { resourceId: number; resource: { name: string } }[]
      }>(
        await h.request(
          owner,
          'GET',
          '/api/workspace/maintenance?view=feedback&limit=50'
        )
      )
      const target = list.items.find((item) =>
        item.resource.name.includes('backlog')
      )!
      const link = await h.prisma.patch_resource_link.findFirstOrThrow({
        where: { resource_id: target.resourceId },
        orderBy: { id: 'asc' }
      })
      await h.prisma.patch_resource_link.update({
        where: { id: link.id },
        data: {
          health: 'broken',
          health_changed_at: new Date(),
          verified_at: null
        }
      })
      await openEditor(page, h.origin, target.resourceId)
      assert.equal(
        await page
          .getByRole('heading', { name: target.resource.name, exact: true })
          .count(),
        1,
        'Embedded maintenance repeats resource identity'
      )
      assert.equal(
        await page
          .locator(`a[href="${detailPath(target.resourceId)}"]`)
          .count(),
        0,
        'Embedded maintenance includes a self link'
      )
      let writes = 0
      const bodies: Record<string, unknown>[] = []
      page.on('request', (req) => {
        if (
          new URL(req.url()).pathname === '/api/workspace/maintenance' &&
          req.method() === 'POST'
        ) {
          writes++
          bodies.push(req.postDataJSON())
        }
      })
      for (const action of ['回应', '核实可用', '停止维护'] as const) {
        await button(page, action).first().click()
        const note = dialog(page).getByRole('textbox', {
          name: '维护说明',
          exact: true
        })
        await note.fill(`${h.run} ${action} 保留`)
        assert.equal(
          await dialog(page)
            .getByRole('combobox', { name: '暂缓天数' })
            .count(),
          0
        )
        await button(dialog(page), '取消').click()
        assert.equal(writes, 0)
        await button(page, action).first().click()
        assert.equal(await note.inputValue(), `${h.run} ${action} 保留`)
        await page.route('**/api/workspace/maintenance', (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify('受控维护失败')
              })
            : route.continue()
        )
        await confirm(page).click()
        await dialog(page)
          .getByRole('alert')
          .getByText('受控维护失败', { exact: true })
          .waitFor()
        assert.equal(await note.inputValue(), `${h.run} ${action} 保留`)
        const sent = bodies.at(-1)!
        assert.equal(
          sent.action,
          { 回应: 'respond', 核实可用: 'verify', 停止维护: 'stop' }[action]
        )
        assert.equal(sent.note, `${h.run} ${action} 保留`)
        assert(!Object.hasOwn(sent, 'days'))
        assert.equal(Object.hasOwn(sent, 'basis'), action === '核实可用')
        await button(dialog(page), '取消').click()
        await page.unroute('**/api/workspace/maintenance')
        writes = 0
      }
      // Real stop and resume prove that a body without note/days is accepted for resume.
      await button(page, '停止维护').first().click()
      await dialog(page)
        .getByRole('textbox', { name: '维护说明', exact: true })
        .fill('隔离验收停止维护')
      const stopped = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === '/api/workspace/maintenance' &&
          res.request().method() === 'POST'
      )
      await confirm(page).click()
      assert.equal((await stopped).status(), 200)
      await button(page, '恢复维护').first().click()
      assert.equal(await dialog(page).getByRole('textbox').count(), 0)
      assert.equal(await dialog(page).getByRole('combobox').count(), 0)
      const resumed = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === '/api/workspace/maintenance' &&
          res.request().method() === 'POST'
      )
      await confirm(page).click()
      const response = await resumed
      assert.equal(response.status(), 200)
      const body = response.request().postDataJSON()
      assert.equal(body.action, 'resume')
      assert(!Object.hasOwn(body, 'note') && !Object.hasOwn(body, 'days'))
    }
  )
}
