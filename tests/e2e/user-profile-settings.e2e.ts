/**
 * Browser + PostgreSQL checks for username and signature settings.
 * Run with a sole 3100 dev server bound to KUN_E2E_DATABASE_URL and an isolated
 * Redis port. The script creates and removes its own users; it never resets a DB.
 *
 * Required: KUN_E2E_DATABASE_URL, REDIS_PORT (not 6379), JWT_ISS, JWT_AUD,
 * JWT_SECRET. Optional: KUN_E2E_BROWSER_PATH, KUN_E2E_ARTIFACT_DIR.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import pg from 'pg'
import {
  chromium,
  type Browser,
  type Locator,
  type Page
} from 'playwright-core'
import { parseE2EDatabaseTarget } from '../../scripts/e2eDatabasePreparation'

const BASE_URL = 'http://127.0.0.1:3100'
const COOKIE = 'kun-galgame-patch-moe-token'
const REDIS_PREFIX = 'kun:touchgal'
const requireEnv = (name: string) => {
  const value = process.env[name]
  assert(value, `${name} is required`)
  return value
}

const target = parseE2EDatabaseTarget(
  requireEnv('KUN_E2E_DATABASE_URL'),
  process.env.KUN_DATABASE_URL
)
assert.equal(target.databaseName, 'touchgal_e2e')
assert(
  ['127.0.0.1', 'localhost'].includes(target.host),
  'E2E database must be local'
)
const redisPort = Number(requireEnv('REDIS_PORT'))
assert(
  Number.isInteger(redisPort) && redisPort > 0 && redisPort !== 6379,
  'Use an isolated Redis port'
)
assert(
  ['127.0.0.1', 'localhost'].includes(process.env.REDIS_HOST ?? '127.0.0.1')
)
const suffix = randomBytes(4).toString('hex')
const artifactDir = resolve(
  process.env.KUN_E2E_ARTIFACT_DIR ??
    `/private/tmp/otoame-profile-e2e-${suffix}`
)
const client = new pg.Pool({
  connectionString: target.connectionUrl.toString(),
  max: 1,
  connectionTimeoutMillis: 5000
})
const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: redisPort,
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 1
})
const results: { name: string; milliseconds: number }[] = []
const users: { id: number; name: string; email: string; bio: string }[] = []
const sessions: { uid: number; jti: string }[] = []
const pageErrors: string[] = []
let browser: Browser | undefined
let currentPage: Page | undefined

const check = async (name: string, run: () => Promise<void>) => {
  const started = Date.now()
  await run()
  results.push({ name, milliseconds: Date.now() - started })
  console.log(`PASS ${name}`)
}

const eventually = async (
  condition: () => Promise<boolean>,
  message: string
) => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((done) => setTimeout(done, 100))
  }
  assert.fail(message)
}

const disabled = (locator: Locator, expected: boolean) =>
  eventually(
    async () => (await locator.isDisabled()) === expected,
    `Expected disabled=${expected}`
  )

const row = async (id: number) => {
  const result = await client.query<{
    name: string
    bio: string
    moemoepoint: number
  }>('SELECT name, bio, moemoepoint FROM public."user" WHERE id = $1', [id])
  assert.equal(result.rows.length, 1)
  return result.rows[0]
}

const ledger = async (id: number) => {
  const result = await client.query<{
    balance_delta: number
    reserved_delta: number
    balance_after: number
    reserved_after: number
    reason_code: string
  }>(
    'SELECT balance_delta, reserved_delta, balance_after, reserved_after, reason_code FROM public.user_moemoepoint_ledger WHERE user_id = $1 ORDER BY id',
    [id]
  )
  return result.rows
}

const seed = async (kind: string, amount: number) => {
  const name = `e2e_${kind}_${suffix}`
  const email = `${name}@example.invalid`
  const bio = `E2E 当前签名 ${suffix}`
  const result = await client.query<{ id: number }>(
    `INSERT INTO public."user"
       (name, email, password, bio, role, moemoepoint, moemoepoint_reserved, enable_email_notice, updated)
     VALUES ($1, $2, 'not-used', $3, 1, $4, 20, false, CURRENT_TIMESTAMP)
     RETURNING id`,
    [name, email, bio, amount]
  )
  const user = { id: result.rows[0].id, name, email, bio }
  users.push(user)
  return user
}

const createSession = async (user: (typeof users)[number]) => {
  const jti = randomUUID()
  const token = jwt.sign(
    {
      iss: requireEnv('JWT_ISS'),
      aud: requireEnv('JWT_AUD'),
      jti,
      uid: user.id,
      name: user.name,
      role: 1
    },
    requireEnv('JWT_SECRET'),
    { expiresIn: '1h' }
  )
  sessions.push({ uid: user.id, jti })
  const createdAt = Date.now()
  await redis.setex(
    `${REDIS_PREFIX}:access:session:${user.id}:${jti}`,
    3600,
    JSON.stringify({ uid: user.id, jti, name: user.name, role: 1, createdAt })
  )
  await redis.zadd(`${REDIS_PREFIX}:access:sessions:${user.id}`, createdAt, jti)
  return token
}

const headers = { 'x-requested-with': 'kun-fetch', origin: BASE_URL }
const saveButton = (page: Page, label: string) =>
  page
    .getByRole('heading', { name: label, exact: true, includeHidden: true })
    .locator('xpath=../..')
    .getByRole('button', { name: /保存/, includeHidden: true })
const waitSave = (page: Page, key: string) => {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/user/setting/${key}`) &&
      response.request().method() === 'POST',
    { timeout: 30000 }
  )
  void response.catch(() => {})
  return response
}

const main = async () => {
  await mkdir(artifactDir, { recursive: true })
  const identity = await client.query<{ database: string }>(
    'SELECT current_database() AS database'
  )
  assert.equal(identity.rows[0].database, 'touchgal_e2e')
  const user = await seed('p', 300)
  const otherUser = await seed('o', 300)
  const noBalanceUser = await seed('z', 20)

  await check(
    'server reads this run’s fixture from the isolated database',
    async () => {
      const response = await fetch(
        `${BASE_URL}/api/user/profile/floating?uid=${user.id}`,
        { headers }
      )
      assert.equal(response.status, 200)
      const profile = (await response.json()) as { name: string; bio: string }
      assert.equal(profile.name, user.name)
      assert.equal(profile.bio, user.bio)
    }
  )

  await redis.connect()
  const token = await createSession(user)
  browser = await chromium.launch({
    executablePath:
      process.env.KUN_E2E_BROWSER_PATH ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 }
  })
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === BASE_URL)
      await route.continue()
    else await route.fulfill({ status: 204, body: '' })
  })
  await context.addCookies([{ name: COOKIE, value: token, url: BASE_URL }])
  await context.addInitScript(
    ({ uid, origin }) => {
      if (window.location.origin !== origin) return
      const key = 'kun-patch-user-store'
      if (window.localStorage.getItem(key)) return
      // A persisted account ID starts the site's real session refresh. Leave the
      // profile fields empty so this run also checks asynchronous prefilling.
      window.localStorage.setItem(
        key,
        JSON.stringify({
          state: { user: { uid, name: '', bio: '', role: 1 } },
          version: 0
        })
      )
    },
    { uid: user.id, origin: BASE_URL }
  )
  const page = await context.newPage()
  currentPage = page
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  let nameRequests = 0
  let bioRequests = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (request.url().endsWith('/api/user/setting/username')) nameRequests++
    if (request.url().endsWith('/api/user/setting/bio')) bioRequests++
  })
  await page.goto(`${BASE_URL}/settings/user`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  })
  const nameInput = page.getByLabel('用户名', { exact: true })
  const bioInput = page.getByLabel('签名', { exact: true })
  const nameSave = saveButton(page, '用户名')
  const bioSave = saveButton(page, '签名')

  await check(
    'cold-load hydration prefills both fields and disables unchanged saves',
    async () => {
      await eventually(
        async () => (await nameInput.inputValue()) === user.name,
        'Username was not prefilled'
      )
      await eventually(
        async () => (await bioInput.inputValue()) === user.bio,
        'Signature was not prefilled'
      )
      await disabled(nameSave, true)
      await disabled(bioSave, true)
      assert.equal(nameRequests + bioRequests, 0)
    }
  )

  await check(
    'editing, reverting, whitespace-only changes and invalid text update button states',
    async () => {
      for (const [input, save, initial, max] of [
        [nameInput, nameSave, user.name, 17],
        [bioInput, bioSave, user.bio, 107]
      ] as const) {
        await input.fill('有效的新内容')
        await disabled(save, false)
        for (const unchanged of [initial, `  ${initial}  `]) {
          await input.fill(unchanged)
          await disabled(save, true)
        }
        for (const invalid of ['   ', 'a'.repeat(max + 1)]) {
          await input.fill(invalid)
          await disabled(save, true)
        }
        await input.fill(initial)
      }
      assert.equal(nameRequests + bioRequests, 0)
    }
  )

  const newBio = `E2E 新签名 ${suffix}`
  await check(
    'signature HTTP failure keeps the saved value and draft retryable',
    async () => {
      await page.route('**/api/user/setting/bio', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify('E2E 保存暂时失败')
        })
      )
      await bioInput.fill(`  ${newBio}  `)
      const response = waitSave(page, 'bio')
      await bioSave.click()
      await response
      await disabled(bioSave, false)
      assert.equal(await bioInput.inputValue(), `  ${newBio}  `)
      assert.equal((await row(user.id)).bio, user.bio)
      await page.getByText('E2E 保存暂时失败', { exact: true }).waitFor()
      await page.unroute('**/api/user/setting/bio')
    }
  )

  await check(
    'signature retry reaches the real API, saves normalized text and survives reload',
    async () => {
      const response = waitSave(page, 'bio')
      await bioSave.click()
      assert.equal((await response).status(), 200)
      await eventually(
        async () => (await bioInput.inputValue()) === newBio,
        'Signature save did not finish'
      )
      await disabled(bioSave, true)
      assert.equal(await bioInput.inputValue(), newBio)
      assert.equal((await row(user.id)).bio, newBio)
      assert.equal((await row(user.id)).moemoepoint, 300)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await eventually(
        async () => (await bioInput.inputValue()) === newBio,
        'Saved signature did not survive reload'
      )
      await disabled(bioSave, true)
    }
  )

  const newName = `e2e_n_${suffix}`
  await check(
    'username save stays disabled while pending and charges exactly one fee',
    async () => {
      let release!: () => void
      const pending = new Promise<void>((done) => {
        release = done
      })
      await page.route('**/api/user/setting/username', async (route) => {
        try {
          const response = await route.fetch()
          await pending
          if (!page.isClosed()) await route.fulfill({ response })
        } catch (error) {
          if (!page.isClosed()) {
            pageErrors.push(
              error instanceof Error
                ? error.message
                : 'Save interception failed'
            )
          }
        }
      })
      await nameInput.fill(` ${newName} `)
      await nameSave.click()
      const dialog = page.getByRole('dialog', { includeHidden: true })
      const confirm = dialog.getByRole('button', {
        name: /确定/,
        includeHidden: true
      })
      const count = nameRequests
      const response = waitSave(page, 'username')
      try {
        await confirm.dblclick({ force: true })
        await disabled(confirm, true)
        await disabled(nameInput, true)
        await disabled(nameSave, true)
        await eventually(
          async () => nameRequests === count + 1,
          'Expected one username request'
        )
        release()
        assert.equal((await response).status(), 200)
      } finally {
        release()
        await page.unrouteAll({ behavior: 'wait' })
      }
      await dialog.waitFor({ state: 'hidden' })
      await disabled(nameSave, true)
      assert.equal(await nameInput.inputValue(), newName)
      assert.equal((await row(user.id)).name, newName)
      assert.equal((await row(user.id)).moemoepoint, 270)
      assert.deepEqual(await ledger(user.id), [
        {
          balance_delta: -30,
          reserved_delta: 0,
          balance_after: 270,
          reserved_after: 20,
          reason_code: 'account.username_change'
        }
      ])
    }
  )

  await check(
    'a taken username fails without changing the account or charging',
    async () => {
      await nameInput.fill(otherUser.name)
      await nameSave.click()
      const dialog = page.getByRole('dialog')
      const response = waitSave(page, 'username')
      await dialog.getByRole('button', { name: '确定', exact: true }).click()
      assert.equal(
        await (await response).json(),
        '您的用户名已经有人注册了, 请修改'
      )
      await disabled(
        dialog.getByRole('button', { name: '确定', exact: true }),
        false
      )
      assert.equal(await nameInput.inputValue(), otherUser.name)
      assert.equal((await row(user.id)).name, newName)
      assert.equal((await row(user.id)).moemoepoint, 270)
      assert.equal((await ledger(user.id)).length, 1)
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await nameInput.fill(newName)
      await disabled(nameSave, true)
    }
  )

  await check(
    'unchanged API submissions return success without a second fee',
    async () => {
      const sameName = await context.request.post(
        `${BASE_URL}/api/user/setting/username`,
        { headers, data: { username: ` ${newName} ` } }
      )
      assert.equal(sameName.status(), 200)
      assert.deepEqual(await sameName.json(), {
        balance: { total: 270, reserved: 20, available: 250 }
      })
      const sameBio = await context.request.post(
        `${BASE_URL}/api/user/setting/bio`,
        { headers, data: { bio: ` ${newBio} ` } }
      )
      assert.deepEqual(await sameBio.json(), {})
      assert.equal((await ledger(user.id)).length, 1)
    }
  )

  const concurrentName = `e2e_c_${suffix}`
  await check(
    'eight concurrent identical username requests create one debit and one ledger entry',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          context.request.post(`${BASE_URL}/api/user/setting/username`, {
            headers,
            data: { username: concurrentName }
          })
        )
      )
      for (const response of responses) {
        assert.equal(response.status(), 200)
        assert.deepEqual(await response.json(), {
          balance: { total: 240, reserved: 20, available: 220 }
        })
      }
      assert.equal((await row(user.id)).name, concurrentName)
      assert.equal((await row(user.id)).moemoepoint, 240)
      const entries = await ledger(user.id)
      assert.equal(entries.length, 2)
      assert.equal(entries[1].balance_delta, -30)
      assert.equal(entries[1].balance_after, 240)
    }
  )

  await check(
    'an unchanged username succeeds with zero available balance',
    async () => {
      const noBalanceToken = await createSession(noBalanceUser)
      const response = await fetch(`${BASE_URL}/api/user/setting/username`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          cookie: `${COOKIE}=${noBalanceToken}`
        },
        body: JSON.stringify({ username: noBalanceUser.name })
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), {
        balance: { total: 20, reserved: 20, available: 0 }
      })
      assert.equal((await ledger(noBalanceUser.id)).length, 0)
    }
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await eventually(
    async () => (await nameInput.inputValue()) === concurrentName,
    'Saved username did not survive reload'
  )
  await page.screenshot({
    path: resolve(artifactDir, 'desktop.png'),
    fullPage: true
  })
  await check(
    'mobile settings prefill correctly and use the same unchanged-value rules',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await disabled(nameSave, true)
      await disabled(bioSave, true)
      assert.equal(await bioInput.inputValue(), newBio)
      await nameInput.fill('手机端修改')
      await disabled(nameSave, false)
      await nameInput.fill(concurrentName)
      await disabled(nameSave, true)
      await bioInput.fill('手机端修改签名')
      await disabled(bioSave, false)
      await bioInput.fill(newBio)
      await disabled(bioSave, true)
      await page.screenshot({
        path: resolve(artifactDir, 'mobile.png'),
        fullPage: true
      })
    }
  )
  assert.deepEqual(pageErrors, [], 'Browser runtime errors')
}

let failure: unknown
try {
  await main()
} catch (error) {
  failure = error
  console.error(error instanceof Error ? error.message : 'E2E failed')
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .screenshot({ path: resolve(artifactDir, 'failure.png'), fullPage: true })
      .catch(() => {})
    const state = await currentPage
      .evaluate(() => ({
        url: window.location.href,
        text: document.body.innerText,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
          (element) => element.outerHTML
        )
      }))
      .catch(() => undefined)
    await writeFile(
      resolve(artifactDir, 'failure-state.json'),
      JSON.stringify(state, null, 2)
    )
  }
} finally {
  await browser?.close()
  for (const session of sessions) {
    await redis.del(
      `${REDIS_PREFIX}:access:session:${session.uid}:${session.jti}`
    )
    await redis.zrem(
      `${REDIS_PREFIX}:access:sessions:${session.uid}`,
      session.jti
    )
  }
  for (const user of users) {
    await client.query(
      'DELETE FROM public."user" WHERE id = $1 AND email = $2',
      [user.id, user.email]
    )
  }
  redis.disconnect()
  await client.end()
  await mkdir(artifactDir, { recursive: true })
  await writeFile(
    resolve(artifactDir, 'report.json'),
    JSON.stringify(
      {
        passed: !failure,
        error: failure instanceof Error ? failure.message : undefined,
        checks: results,
        pageErrors,
        cleanup: 'test users and sessions removed'
      },
      null,
      2
    )
  )
}
if (failure) process.exitCode = 1
else
  console.log(`PASS ${results.length} E2E scenarios; artifacts: ${artifactDir}`)
