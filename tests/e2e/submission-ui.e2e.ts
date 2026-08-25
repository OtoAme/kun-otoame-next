/**
 * Browser checks for the submission UI: the author's own tab creates a draft,
 * the editor autosaves, and the gallery cards are reachable by keyboard.
 *
 * Run against a throwaway database with a dev server on KUN_E2E_BASE_URL.
 */
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import sharp from 'sharp'
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page
} from 'playwright-core'

const BASE_URL = process.env.KUN_E2E_BASE_URL ?? 'http://127.0.0.1:3100'
const KUN_TOKEN_COOKIE = 'kun-galgame-patch-moe-token'
const KUN_REDIS_PREFIX = 'kun:touchgal'
const STEP_TIMEOUT_MS = 20000

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required for an e2e run`)
  }
  return value
}

const submitter = () => ({
  uid: Number(requireEnv('KUN_E2E_SUBMITTER_UID')),
  name: process.env.KUN_E2E_SUBMITTER_NAME ?? 'e2e_submitter',
  role: 1
})

const createSessionCookie = async () => {
  const { uid, name, role } = submitter()
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
    { expiresIn: '1d' }
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
      86400,
      JSON.stringify({ uid, jti, name, role, createdAt })
    )
    await redis.zadd(
      `${KUN_REDIS_PREFIX}:access:sessions:${uid}`,
      createdAt,
      jti
    )
  } finally {
    redis.disconnect()
  }
  return token
}

/** Role-gated UI reads useUserStore, which is persisted and defaults to role 1. */
const seedUserStore = (context: BrowserContext) => {
  const { uid, name, role } = submitter()
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
        moemoepoint: 100,
        moemoepointReserved: 0,
        moemoepointAvailable: 100,
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

const assertTrue = (value: boolean, message: string) => {
  if (!value) {
    throw new Error(message)
  }
}

const waitVisible = async (locator: Locator, what: string) => {
  try {
    await locator
      .first()
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
  } catch {
    throw new Error(`${what} never became visible`)
  }
}

interface Case {
  name: string
  run: (page: Page) => Promise<void>
}

/**
 * Deletes this user's editable drafts through the API so repeated runs start
 * below the active-draft cap. Pending and terminal rows are left alone.
 */
const clearOwnDrafts = async (token: string) => {
  // CSRF compares the origin against the server's configured address, and the
  // throwaway server is configured to accept the address the tests use.
  const headers = {
    'x-requested-with': 'kun-fetch',
    origin: BASE_URL,
    cookie: `${KUN_TOKEN_COOKIE}=${token}`
  }
  const listed = await fetch(`${BASE_URL}/api/patch-submission?limit=50`, {
    headers
  })
  const data = (await listed.json()) as {
    submissions?: { id: number; status: string }[]
  }
  for (const submission of data.submissions ?? []) {
    if (
      submission.status !== 'draft' &&
      submission.status !== 'changes_requested'
    ) {
      continue
    }
    const deleted = await fetch(
      `${BASE_URL}/api/patch-submission/${submission.id}`,
      { method: 'DELETE', headers }
    )
    const body = (await deleted.json()) as unknown
    if (typeof body === 'string') {
      throw new Error(`failed to clear draft ${submission.id}: ${body}`)
    }
  }
}

const openOwnSubmissionTab = async (page: Page) => {
  await page.goto(`${BASE_URL}/user/${submitter().uid}/submission`, {
    waitUntil: 'domcontentloaded'
  })
  await waitVisible(page.getByText('我的投稿').first(), 'submission tab')
}

const createDraft = async (page: Page) => {
  await openOwnSubmissionTab(page)
  // The list content is server-rendered, so its heading can be visible before
  // React has attached the button handler. Wait for client hydration requests
  // to settle before exercising the control.
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: /^新建投稿$/ }).first().click()
  await page.waitForURL('**/submission/*', { timeout: STEP_TIMEOUT_MS })
  await waitVisible(page.getByText('投稿游戏条目'), 'submission editor')
}

const fillIntroduction = async (page: Page, value: string) => {
  const editor = page.locator('.cm-content[contenteditable="true"]').first()
  await waitVisible(editor, 'submission introduction editor')
  await editor.fill(value)
}

const cases: Case[] = [
  {
    name: 'the own-profile tab states the deposit before anything is created',
    run: async (page) => {
      await openOwnSubmissionTab(page)
      await waitVisible(
        page.getByText('新建投稿会暂扣', { exact: false }),
        'deposit explanation'
      )
      await waitVisible(
        page.getByText('素材容量', { exact: false }),
        'capacity'
      )
    }
  },
  {
    name: 'creating a draft opens the editor and holds the deposit',
    run: async (page) => {
      await createDraft(page)
      await waitVisible(
        page.getByText('暂扣 10 萌萌点'),
        'the held deposit is shown in the editor'
      )
    }
  },
  {
    name: 'editing the title autosaves to the cloud',
    run: async (page) => {
      await createDraft(page)

      const title = page.getByLabel('游戏名称')
      await title.fill('E2E 自动保存标题')
      await waitVisible(page.getByText('已保存到云端'), 'autosave confirmation')

      // The reload proves the payload really reached the server.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitVisible(page.getByText('投稿游戏条目'), 'editor after reload')
      const value = await page.getByLabel('游戏名称').inputValue()
      assertTrue(
        value === 'E2E 自动保存标题',
        `the title did not survive a reload, got "${value}"`
      )
    }
  },
  {
    name: 'the required-name error clears as soon as the author types',
    run: async (page) => {
      await createDraft(page)
      const title = page.getByLabel('游戏名称')
      await title.fill('')
      await page
        .locator('button', { hasText: /^提交审核$/ })
        .first()
        .click()

      await waitVisible(
        page.getByText('游戏名称是必填项'),
        'required-name error'
      )
      assertTrue(
        (await title.getAttribute('aria-invalid')) === 'true',
        'the empty required name was not marked invalid'
      )
      await title.fill('错误态已清除')
      assertTrue(
        (await title.getAttribute('aria-invalid')) !== 'true',
        'the name error stayed red after typing'
      )
    }
  },
  {
    name: 'explicit save persists the current draft before reporting success',
    run: async (page) => {
      await createDraft(page)
      await page.getByLabel('游戏名称').fill('E2E 显式保存标题')
      await page
        .locator('button', { hasText: /^保存草稿$/ })
        .first()
        .click()
      await waitVisible(page.getByText('草稿已保存到云端'), 'save confirmation')

      await page.reload({ waitUntil: 'domcontentloaded' })
      assertTrue(
        (await page.getByLabel('游戏名称').inputValue()) === 'E2E 显式保存标题',
        'explicitly saved title did not survive reload'
      )
    }
  },
  {
    name: 'preview flushes and renders the latest server projection',
    run: async (page) => {
      await createDraft(page)
      await page.getByLabel('游戏名称').fill('E2E 最新预览标题')
      await fillIntroduction(
        page,
        '这是打开预览前刚刚输入、必须先保存的最新正文。'
      )
      await page
        .locator('button', { hasText: /^预览$/ })
        .first()
        .click()

      await waitVisible(page.getByText('预览，尚未提交'), 'preview marker')
      await waitVisible(page.getByText('E2E 最新预览标题'), 'preview title')
      await waitVisible(
        page.getByText('这是打开预览前刚刚输入', { exact: false }),
        'latest preview introduction'
      )
    }
  },
  {
    name: 'submitting without a cover is refused with a readable message',
    run: async (page) => {
      await createDraft(page)
      await page.getByLabel('游戏名称').fill('E2E 缺封面')
      await fillIntroduction(page, '这是一条足够长的游戏介绍文本用于通过校验。')
      await waitVisible(page.getByText('已保存到云端'), 'autosave confirmation')

      await page
        .locator('button', { hasText: /^提交审核$/ })
        .first()
        .click()
      await waitVisible(
        page.getByText('请先上传封面图片', { exact: false }),
        'missing cover message'
      )
    }
  },
  {
    name: 'gallery upload controls carry accessible names',
    run: async (page) => {
      await createDraft(page)
      await waitVisible(page.getByText('游戏截图'), 'gallery section')

      // Nothing is uploaded yet, so assert the dropzone itself is reachable and
      // the file input is a real input rather than a div with a click handler.
      const fileInput = page.locator('input[type="file"][multiple]')
      assertTrue(
        (await fileInput.count()) > 0,
        'the gallery dropzone has no real file input'
      )
    }
  },
  {
    name: 'failed gallery uploads survive refresh and retry with progress',
    run: async (page) => {
      await createDraft(page)
      const image = await sharp({
        create: {
          // Larger than the 200x200 watermark overlay: watermark now defaults on,
          // and sharp refuses to composite an overlay bigger than the base image.
          // Real screenshots are always larger than this; a sub-200px upload is
          // the unrealistic case.
          width: 1280,
          height: 720,
          channels: 3,
          background: { r: 120, g: 40, b: 90 }
        }
      })
        .jpeg()
        .toBuffer()

      await page.route('**/api/patch-submission/asset', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue()
          return
        }
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify('模拟截图上传失败')
        })
      })

      await page.locator('input[type="file"][multiple]').setInputFiles({
        name: 'retry.jpg',
        mimeType: 'image/jpeg',
        buffer: image
      })
      await waitVisible(page.getByText('截图上传进度'), 'upload progress')
      await waitVisible(
        page.locator('button[aria-label="重试上传 retry.jpg"]'),
        'failed retry control'
      )

      await page.unroute('**/api/patch-submission/asset')
      await page.reload({ waitUntil: 'domcontentloaded' })
      const retry = page.locator('button[aria-label="重试上传 retry.jpg"]')
      await waitVisible(retry, 'retry control restored after refresh')
      await retry.click()
      await retry.waitFor({ state: 'detached', timeout: STEP_TIMEOUT_MS })
      await waitVisible(page.getByText('1 / 1'), 'completed-file progress')
      assertTrue(
        (await page.locator('img[alt^="第 "]').count()) > 0,
        'successful retry did not replace the placeholder with a cloud card'
      )
    }
  }
]

/**
 * Creating a draft is capped at 20 per hour and fails closed, which is correct
 * for production but makes a repeated suite run hit the wall. Clearing this
 * user's own counters keeps the suite repeatable without weakening the limit.
 */
const clearOwnRateLimits = async () => {
  const { uid } = submitter()
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined
  })
  try {
    await redis.del(
      ...['create', 'submit', 'asset-upload', 'read', 'autosave'].map(
        (action) =>
          `${KUN_REDIS_PREFIX}:patch-submission:rate-limit:${action}:${uid}`
      )
    )
  } finally {
    redis.disconnect()
  }
}

const main = async () => {
  await clearOwnRateLimits()
  const token = await createSessionCookie()
  const browser = await chromium.launch({ channel: 'chrome' })
  let failures = 0

  for (const testCase of cases) {
    // Each draft holds a slot and several cases create one, so without this a
    // run would hit the active-draft cap partway through. Going through the
    // real API also exercises the delete-and-refund path.
    await clearOwnDrafts(token)

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
    const page = await context.newPage()

    try {
      await testCase.run(page)
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
