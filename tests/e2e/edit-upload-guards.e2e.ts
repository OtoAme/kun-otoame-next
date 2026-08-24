/**
 * Browser checks for the edit-page upload guards. Self-contained on purpose:
 * Node runs this file directly, and its ESM resolver would need explicit `.ts`
 * extensions for local imports, which the project's tsconfig does not allow.
 *
 * Run against a throwaway database, never the real one:
 *
 *   KUN_DATABASE_URL=...touchgal_e2e pnpm next dev --port=3100
 *   KUN_E2E_UID=8 KUN_E2E_PATCH_UNIQUE_ID=09195716 \
 *     node --env-file=.env tests/e2e/edit-upload-guards.e2e.ts
 */
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core'

const BASE_URL = process.env.KUN_E2E_BASE_URL ?? 'http://127.0.0.1:3100'
const KUN_TOKEN_COOKIE = 'kun-galgame-patch-moe-token'
const KUN_REDIS_PREFIX = 'kun:touchgal'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const STEP_TIMEOUT_MS = 15000
const GALLERY_CARD_IMAGES = 'div.grid.grid-cols-2 img'

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required for an e2e run`)
  }
  return value
}

const e2eUser = () => ({
  uid: Number(requireEnv('KUN_E2E_UID')),
  name: process.env.KUN_E2E_USER_NAME ?? 'e2e_admin',
  role: Number(process.env.KUN_E2E_ROLE ?? 4)
})

/**
 * Role-gated controls read useUserStore, which is persisted in localStorage and
 * defaults to role 1. Seeding it before any page script runs is what makes the
 * edit entry point visible; the cookie alone only satisfies the server.
 */
const seedUserStore = (context: BrowserContext) => {
  const { uid, name, role } = e2eUser()
  return context.addInitScript(
    ([storeName, user]) => {
      window.localStorage.setItem(
        storeName as string,
        JSON.stringify({ state: { user }, version: 0 })
      )
    },
    [
      'kun-patch-user-store',
      {
        uid,
        name,
        avatar: '',
        bio: '',
        moemoepoint: 1000,
        moemoepointReserved: 0,
        moemoepointAvailable: 1000,
        role,
        dailyCheckIn: 1,
        dailyImageLimit: 0,
        dailyUploadLimit: 0,
        enableEmailNotice: false,
        allowPrivateMessage: true,
        blockedTagIds: [],
        enableRedirect: true,
        excludedDomains: [],
        delaySeconds: 5
      }
    ] as const
  )
}

/**
 * The login form requires a captcha, so the run signs its own session with the
 * same secret and writes the Redis entry verifyKunToken looks up.
 */
const createSessionCookie = async () => {
  const { uid, name, role } = e2eUser()
  const jti = randomUUID()

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
    { expiresIn: '30d' }
  )

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined
  })
  const createdAt = Date.now()
  try {
    await redis.setex(
      `${KUN_REDIS_PREFIX}:access:session:${uid}:${jti}`,
      SESSION_TTL_SECONDS,
      JSON.stringify({ uid, jti, name, role, createdAt })
    )
    await redis.zadd(`${KUN_REDIS_PREFIX}:access:sessions:${uid}`, createdAt, jti)
  } finally {
    redis.disconnect()
  }

  return token
}

const assertEqual = <T>(actual: T, expected: T, what: string) => {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const assertTrue = (value: boolean, message: string) => {
  if (!value) {
    throw new Error(message)
  }
}

const waitVisible = async (locator: Locator, what: string) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
  } catch {
    throw new Error(`${what} never became visible`)
  }
}

const waitEnabled = async (locator: Locator, what: string) => {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await locator.first().isEnabled()) {
      return
    }
    await locator.page().waitForTimeout(100)
  }
  throw new Error(`${what} stayed disabled`)
}

/** A PNG header plus padding, so no binary fixture has to be committed. */
const pngBytes = (megabytes: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(megabytes * 1024 * 1024, 0x7f)
  ])

/**
 * The rewrite editor is only reachable through the detail page: the store is
 * seeded there by PatchHeaderContainer, so loading /edit/rewrite directly would
 * land on an empty form.
 */
const openRewriteEditor = async (page: Page) => {
  const uniqueId = requireEnv('KUN_E2E_PATCH_UNIQUE_ID')
  await page.goto(`${BASE_URL}/${uniqueId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[aria-label="编辑游戏信息"]').first().click()
  await page.waitForURL('**/edit/rewrite', { timeout: STEP_TIMEOUT_MS })
  await waitVisible(page.getByText('编辑游戏信息'), 'rewrite editor')
}

const dropGalleryFile = async (
  page: Page,
  file: { name: string; type: string; bytes: Buffer }
) => {
  // The banner uploader also renders a file input and comes first in the form;
  // react-dropzone is the one that sets `multiple`.
  const dropzone = page
    .locator('input[type="file"][multiple]')
    .first()
    .locator('..')
  await dropzone.evaluate(
    (element, payload) => {
      const binary = Uint8Array.from(atob(payload.base64), (char) =>
        char.charCodeAt(0)
      )
      const dropped = new File([binary], payload.name, { type: payload.type })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(dropped)
      element.dispatchEvent(
        new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true })
      )
    },
    { base64: file.bytes.toString('base64'), name: file.name, type: file.type }
  )
}

const smallPng = () => ({ name: 'small.png', type: 'image/png', bytes: pngBytes(0) })

/**
 * The create page keeps its form in localStorage, so it has to be in place
 * before the store hydrates.
 */
const seedCreateForm = (context: BrowserContext) =>
  context.addInitScript(() => {
    window.localStorage.setItem(
      'kun-patch-edit-store',
      JSON.stringify({
        state: {
          data: {
            name: 'E2E offline submit probe',
            introduction: '这是一条用于端到端测试的游戏介绍文本。',
            vndbId: '',
            vndbRelationId: '',
            bangumiId: '',
            steamId: '',
            dlsiteCode: '',
            dlsiteCircleName: '',
            dlsiteCircleLink: '',
            vndbTags: [],
            vndbDevelopers: [],
            bangumiTags: [],
            bangumiDevelopers: [],
            steamTags: [],
            steamDevelopers: [],
            steamAliases: [],
            officialUrl: '',
            alias: [],
            tag: ['e2e'],
            released: '2026-08-24',
            contentLimit: 'sfw',
            isDuplicate: false
          }
        },
        version: 0
      })
    )
  })

/**
 * The cover lives in localforage (IndexedDB, default database `localforage` /
 * store `keyvaluepairs`). PublishButton reads it when submit is pressed, so
 * writing it after load is enough — and unlike an init script, this can be
 * awaited.
 */
const seedCreateBanner = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open('localforage')
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('keyvaluepairs')) {
            request.result.createObjectStore('keyvaluepairs')
          }
        }
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('keyvaluepairs')) {
            db.close()
            reject(new Error('localforage store is missing'))
            return
          }
          const transaction = db.transaction('keyvaluepairs', 'readwrite')
          const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x7f, 0x7f, 0x7f,
            0x7f
          ])
          transaction
            .objectStore('keyvaluepairs')
            .put(new Blob([png], { type: 'image/avif' }), 'kun-patch-banner')
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
        request.onerror = () => reject(request.error)
      })
  )

interface Case {
  name: string
  seedCreatePage?: boolean
  run: (page: Page, context: BrowserContext) => Promise<void>
}

const cases: Case[] = [
  {
    name: 'oversized gallery drop is rejected before it reaches the queue',
    run: async (page) => {
      await openRewriteEditor(page)
      const before = await page.locator(GALLERY_CARD_IMAGES).count()

      await dropGalleryFile(page, {
        name: 'too-big.png',
        type: 'image/png',
        bytes: pngBytes(9)
      })

      await waitVisible(
        page.getByText('单张图片不能超过 8 MB', { exact: false }),
        'oversized image toast'
      )
      assertEqual(
        await page.locator(GALLERY_CARD_IMAGES).count(),
        before,
        'gallery card count after a rejected drop'
      )
    }
  },
  {
    name: 'offline submit surfaces an error and leaves the button clickable',
    run: async (page, context) => {
      await openRewriteEditor(page)
      const submit = page.locator('button', { hasText: /^提交$/ }).first()

      await context.setOffline(true)
      await submit.click()

      await waitVisible(
        page.getByText('提交失败, 请检查网络后重试', { exact: false }),
        'network failure toast'
      )
      await waitEnabled(submit, 'submit button')
      await context.setOffline(false)
    }
  },
  {
    name: 'offline publish on the create page surfaces an error and re-enables the button',
    seedCreatePage: true,
    run: async (page, context) => {
      await page.goto(`${BASE_URL}/edit/create`, { waitUntil: 'load' })
      // The dev server code-splits the markdown editor; going offline before
      // those chunks arrive would break hydration instead of the submit.
      await page.waitForLoadState('networkidle')
      const publish = page.locator('button', { hasText: /^提交$/ }).first()
      await waitVisible(publish, 'publish button')
      await seedCreateBanner(page)

      await context.setOffline(true)
      await publish.click()

      await waitVisible(
        page.getByText('发布失败, 请检查网络后重试', { exact: false }),
        'create page network failure toast'
      )
      await waitEnabled(publish, 'publish button')
      await context.setOffline(false)
    }
  },
  {
    name: 'in-app link asks for confirmation while screenshots are unsent',
    run: async (page) => {
      await openRewriteEditor(page)
      await dropGalleryFile(page, smallPng())
      await waitVisible(page.locator(GALLERY_CARD_IMAGES), 'queued screenshot')

      await page.locator('a[href="/"]').first().click()

      await waitVisible(
        page.getByText('离开后未上传的图片会丢失'),
        'leave confirmation dialog'
      )
      assertEqual(
        new URL(page.url()).pathname,
        '/edit/rewrite',
        'path after a blocked in-app link'
      )
    }
  },
  {
    name: 'reload raises the native prompt while screenshots are unsent',
    run: async (page) => {
      await openRewriteEditor(page)
      await dropGalleryFile(page, smallPng())
      await waitVisible(page.locator(GALLERY_CARD_IMAGES), 'queued screenshot')

      let prompted = false
      page.on('dialog', (dialog) => {
        if (dialog.type() === 'beforeunload') {
          prompted = true
        }
        void dialog.dismiss()
      })

      // Chrome only honours beforeunload after a real user gesture, and the
      // synthetic drop above does not count as one.
      await page.getByText('编辑游戏信息').first().click()

      await page
        .reload({ waitUntil: 'domcontentloaded', timeout: 5000 })
        .catch(() => undefined)
      assertTrue(prompted, 'reload did not raise a beforeunload prompt')
    }
  }
]

const main = async () => {
  const token = await createSessionCookie()
  const browser = await chromium.launch({ channel: 'chrome' })
  let failures = 0

  for (const testCase of cases) {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 }
    })
    await context.addCookies([
      {
        name: KUN_TOKEN_COOKIE,
        value: token,
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Strict'
      }
    ])
    await seedUserStore(context)
    if (testCase.seedCreatePage) {
      await seedCreateForm(context)
    }
    const page = await context.newPage()

    try {
      await testCase.run(page, context)
      console.log(`PASS  ${testCase.name}`)
    } catch (error) {
      failures += 1
      console.log(
        `FAIL  ${testCase.name}\n      ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      await context.close()
    }
  }

  await browser.close()
  console.log(`\n${cases.length - failures}/${cases.length} passed`)
  if (failures) {
    process.exitCode = 1
  }
}

void main()
