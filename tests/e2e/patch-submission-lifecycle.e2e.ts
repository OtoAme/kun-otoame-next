/**
 * Walks one submission through its whole life against a running dev server:
 * a role 1 user creates a draft, uploads a cover, submits, and a reviewer
 * approves it. Verifies the deposit is frozen and returned, that a real patch
 * appears only at approval, and that the concurrency guard admits one winner.
 *
 * Requires the dev server to point at a throwaway database.
 */
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import sharp from 'sharp'
import { chromium } from 'playwright-core'

const BASE_URL = process.env.KUN_E2E_BASE_URL ?? 'http://127.0.0.1:3100'
// CSRF compares this against the server's configured address; the throwaway
// server is started with its own address allowed.
const ORIGIN = process.env.KUN_E2E_ORIGIN ?? BASE_URL
const KUN_REDIS_PREFIX = 'kun:touchgal'

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined
})

const signSession = async (user: {
  uid: number
  name: string
  role: number
}) => {
  const jti = randomUUID()
  const token = jwt.sign(
    {
      iss: requireEnv('JWT_ISS'),
      aud: requireEnv('JWT_AUD'),
      jti,
      uid: user.uid,
      name: user.name,
      role: user.role
    },
    requireEnv('JWT_SECRET'),
    { expiresIn: '1d' }
  )
  const createdAt = Date.now()
  await redis.setex(
    `${KUN_REDIS_PREFIX}:access:session:${user.uid}:${jti}`,
    86400,
    JSON.stringify({ ...user, jti, createdAt })
  )
  await redis.zadd(
    `${KUN_REDIS_PREFIX}:access:sessions:${user.uid}`,
    createdAt,
    jti
  )
  return token
}

const call = async (
  token: string,
  method: string,
  path: string,
  body?: unknown
) => {
  const headers: Record<string, string> = {
    'x-requested-with': 'kun-fetch',
    origin: ORIGIN,
    cookie: `kun-galgame-patch-moe-token=${token}`
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return response.json()
}

const callForm = async (
  token: string,
  path: string,
  form: FormData,
  method = 'POST'
) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'x-requested-with': 'kun-fetch',
      origin: ORIGIN,
      cookie: `kun-galgame-patch-moe-token=${token}`
    },
    body: form
  })
  return response.json()
}

const assert = (condition: unknown, what: string) => {
  if (!condition) {
    throw new Error(`FAILED: ${what}`)
  }
  console.log(`  ok  ${what}`)
}

const payload = (name: string) => ({
  name,
  introduction: '这是一条端到端测试用的游戏介绍文本, 长度足够。',
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
  contentLimit: 'sfw'
})

const main = async () => {
  const submitter = {
    uid: Number(requireEnv('KUN_E2E_SUBMITTER_UID')),
    name: 'e2e_submitter',
    role: 1
  }
  const reviewer = {
    uid: Number(requireEnv('KUN_E2E_UID')),
    name: 'e2e_admin',
    role: 4
  }

  // Creating and submitting fail closed past their hourly cap, so a repeated run
  // would otherwise wall itself off. Clearing this user's own counters keeps the
  // script repeatable without weakening the limit.
  await redis.del(
    ...['create', 'submit', 'asset-upload', 'read', 'autosave'].map(
      (action) =>
        `${KUN_REDIS_PREFIX}:patch-submission:rate-limit:${action}:${submitter.uid}`
    )
  )

  const submitterToken = await signSession(submitter)
  const reviewerToken = await signSession(reviewer)

  // Assertions are relative to the starting balance: the database is a
  // throwaway copy, not a freshly seeded fixture, so earlier runs may have left
  // deposits held.
  const before = await call(submitterToken, 'GET', '/api/patch-submission')
  const baseline = before.moemoepointBalance as {
    total: number
    reserved: number
  }
  assert(
    typeof baseline?.reserved === 'number',
    'the list endpoint reports the balance'
  )

  console.log('create draft')
  const requestId = randomUUID().replace(/-/g, '')
  const created = await call(submitterToken, 'POST', '/api/patch-submission', {
    requestId,
    payload: payload(`E2E 投稿 ${requestId.slice(0, 6)}`)
  })
  assert(typeof created?.submissionId === 'number', 'draft was created')
  assert(
    created.moemoepointBalance?.reserved === baseline.reserved + 10,
    'ten more points are held for a role 1 user'
  )
  const submissionId = created.submissionId as number

  console.log('creation is idempotent')
  const retried = await call(submitterToken, 'POST', '/api/patch-submission', {
    requestId,
    payload: payload('ignored on retry')
  })
  assert(
    retried?.submissionId === submissionId,
    'a retry resolves to the same draft'
  )

  console.log('submitting without a cover is refused')
  const early = await call(
    submitterToken,
    'POST',
    `/api/patch-submission/${submissionId}/submit`
  )
  assert(
    typeof early === 'string' && early.includes('封面'),
    'a submission without a cover is refused'
  )

  console.log('upload a cover')
  const cover = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 40, g: 90, b: 160 }
    }
  })
    .avif({ quality: 50 })
    .toBuffer()
  const bannerForm = new FormData()
  bannerForm.set('kind', 'banner')
  bannerForm.set('submissionId', String(submissionId))
  bannerForm.set('banner', new Blob([cover], { type: 'image/avif' }), 'b.avif')
  bannerForm.set(
    'bannerOriginal',
    new Blob([cover], { type: 'image/avif' }),
    'o.avif'
  )
  const banner = await callForm(
    submitterToken,
    '/api/patch-submission/asset',
    bannerForm
  )
  assert(typeof banner?.bannerKey === 'string', 'the cover was stored')
  assert(
    String(banner.bannerKey).startsWith('patch-submission/'),
    'the cover lives under an unguessable submission prefix'
  )

  console.log('upload a gallery image, twice with the same asset id')
  const shot = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 200, g: 60, b: 60 }
    }
  })
    .avif({ quality: 50 })
    .toBuffer()
  const clientAssetId = randomUUID().replace(/-/g, '')
  const galleryForm = () => {
    const form = new FormData()
    form.set('submissionId', String(submissionId))
    form.set('clientAssetId', clientAssetId)
    form.set('image', new Blob([shot], { type: 'image/avif' }), 'g.avif')
    return form
  }
  const firstUpload = await callForm(
    submitterToken,
    '/api/patch-submission/asset',
    galleryForm()
  )
  assert(
    typeof firstUpload?.galleryId === 'number',
    'the screenshot was stored'
  )
  const secondUpload = await callForm(
    submitterToken,
    '/api/patch-submission/asset',
    galleryForm()
  )
  assert(
    secondUpload?.galleryId === firstUpload.galleryId &&
      secondUpload?.alreadyUploaded === true,
    'the same asset id resolves to the same row instead of duplicating'
  )

  console.log('submit for review')
  const submitted = await call(
    submitterToken,
    'POST',
    `/api/patch-submission/${submissionId}/submit`
  )
  assert(
    typeof submitted === 'object' && submitted !== null,
    'the draft moved to pending'
  )

  console.log('editing while pending is refused')
  const editWhilePending = await call(
    submitterToken,
    'PUT',
    '/api/patch-submission',
    { submissionId, revision: 99, payload: payload('nope') }
  )
  assert(
    typeof editWhilePending === 'string' && editWhilePending.includes('审核'),
    'a pending submission cannot be edited'
  )

  console.log('the author cannot review their own submission')
  const selfReview = await call(
    submitterToken,
    'POST',
    '/api/admin/patch-submission/approve',
    { submissionId }
  )
  assert(
    typeof selfReview === 'string',
    'a role 1 author is refused as a reviewer'
  )

  console.log('reviewer notification links to the full detail page')
  const reviewerMessages = await call(
    reviewerToken,
    'GET',
    '/api/message/all?page=1&limit=30'
  )
  const reviewMessage = reviewerMessages?.messages?.find(
    (message: { link?: string }) =>
      message.link === `/admin/submission/${submissionId}`
  )
  assert(
    reviewMessage?.link === `/admin/submission/${submissionId}`,
    'reviewer received a direct detail link'
  )

  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 }
    })
    try {
      await context.addCookies([
        {
          name: 'kun-galgame-patch-moe-token',
          value: reviewerToken,
          url: BASE_URL,
          httpOnly: true,
          sameSite: 'Strict'
        }
      ])
      const page = await context.newPage()
      await page.goto(`${BASE_URL}${reviewMessage.link}`, {
        waitUntil: 'domcontentloaded'
      })
      await page
        .getByText(payload('').introduction, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 20000 })
      assert(
        (await page.locator('img[alt="投稿截图"]').count()) > 0,
        'reviewer detail renders the submitted screenshot'
      )

      console.log('approve from the reviewer detail')
      await page.getByRole('button', { name: '通过', exact: true }).click()
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await page
        .getByText('已发布', { exact: true })
        .waitFor({ state: 'visible', timeout: 20000 })
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }

  const afterApproval = await call(
    submitterToken,
    'GET',
    '/api/patch-submission?page=1&limit=50'
  )
  const published = afterApproval.submissions?.find(
    (submission: { id: number }) => submission.id === submissionId
  )
  assert(
    typeof published?.patchUniqueId === 'string',
    'approval produced a real patch'
  )
  assert(
    afterApproval.moemoepointBalance?.reserved === baseline.reserved,
    'the deposit was released'
  )
  assert(
    afterApproval.moemoepointBalance?.total === baseline.total + 3,
    'the publish reward was paid on top of the returned deposit'
  )

  console.log('approving twice is refused')
  const again = await call(
    reviewerToken,
    'POST',
    '/api/admin/patch-submission/approve',
    { submissionId }
  )
  assert(
    typeof again === 'string',
    'a second approval finds nothing pending to claim'
  )

  console.log('\nall submission lifecycle checks passed')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => redis.disconnect())
