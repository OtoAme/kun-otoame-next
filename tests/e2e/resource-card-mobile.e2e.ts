/**
 * Read-only layout check: revealed resource-card credentials stay inside the
 * card at phone width. Uses the running site server on port 3000 by default.
 * Access/restore are intercepted so the run is quota/CSRF independent and
 * does not write grants.
 *
 *   node tests/e2e/resource-card-mobile.e2e.ts
 *   KUN_E2E_BASE_URL=http://192.168.0.199:3000 \
 *     KUN_E2E_RESOURCE_CARD_PATH=/ui479c1f?tab=resources \
 *     node tests/e2e/resource-card-mobile.e2e.ts
 *
 * This file is not part of the 3100 / touchgal_e2e write harness.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'

const BASE_URL = process.env.KUN_E2E_BASE_URL ?? 'http://127.0.0.1:3000'
const RESOURCE_PATH =
  process.env.KUN_E2E_RESOURCE_CARD_PATH ?? '/ui479c1f?tab=resources'
const STEP_TIMEOUT_MS = 20000
const PHONE = { width: 360, height: 740 }
const DESKTOP = { width: 1280, height: 800 }
const LONG_URL =
  'https://pan.quark.cn/s/ui479c1agwgas-overflow-check-share-path-must-wrap'
const LONG_CODE = 'EXTRACT_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const LONG_PASSWORD = 'UNZIP_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

type LinkMeta = {
  id: number
  version: number | null
  storage: string
  size: string
}

const linkMeta = new Map<string, LinkMeta>()
const results: { name: string; milliseconds: number }[] = []
const artifactDir = resolve(
  process.env.KUN_E2E_ARTIFACT_DIR ?? '/tmp/otoame-resource-card-mobile-e2e'
)

const check = async (name: string, run: () => Promise<void>) => {
  const started = Date.now()
  await run()
  results.push({ name, milliseconds: Date.now() - started })
  console.log(`PASS ${name}`)
}

const linkKey = (resourceId: number, linkId: number) =>
  `${resourceId}:${linkId}`

const installAccessIntercepts = async (page: Page) => {
  // Playwright checks the last registered route first.
  await page.route('**/api/patch/resource**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === 'GET' && url.pathname.endsWith('/api/patch/resource')) {
      const response = await route.fetch()
      const json: unknown = await response.json()
      if (Array.isArray(json)) {
        for (const resource of json) {
          const row = resource as {
            id?: number
            links?: Array<{
              id?: number
              version?: number
              storage?: string
              size?: string
            }>
          }
          if (typeof row.id !== 'number' || !Array.isArray(row.links)) {
            continue
          }
          for (const link of row.links) {
            if (typeof link.id !== 'number') continue
            linkMeta.set(linkKey(row.id, link.id), {
              id: link.id,
              version: typeof link.version === 'number' ? link.version : null,
              storage: link.storage ?? 'user',
              size: link.size ?? ''
            })
          }
        }
      }
      await route.fulfill({ response })
      return
    }
    await route.continue()
  })

  await page.route('**/api/patch/resource/download/access/restore', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ links: [], obtainedExpiresAt: null })
    })
  )

  await page.route('**/api/patch/resource/download/access', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const posted = route.request().postDataJSON() as {
      resourceId?: number
      linkId?: number
    } | null
    const resourceId = posted?.resourceId
    const linkId = posted?.linkId
    if (typeof resourceId !== 'number' || typeof linkId !== 'number') {
      throw new Error('access body needs resourceId and linkId')
    }
    const meta = linkMeta.get(linkKey(resourceId, linkId))
    const version = meta?.version
    if (typeof version !== 'number') {
      throw new Error(
        `missing health version for ${linkKey(resourceId, linkId)}`
      )
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        link: {
          id: linkId,
          storage: meta?.storage ?? 'user',
          size: meta?.size ?? '1.20 GB',
          content: LONG_URL,
          code: LONG_CODE,
          password: LONG_PASSWORD,
          hash: '',
          version
        },
        access: {
          kind: 'resource_granted',
          actorType: 'visitor',
          cost: 0,
          obtainedExpiresAt: new Date(Date.now() + 86400000).toISOString()
        }
      })
    })
  })
}

type OverflowIssue = {
  kind: 'page-scroll' | 'card-scroll' | 'paint'
  cardId?: string
  detail: string
}

const collectOverflow = async (page: Page): Promise<OverflowIssue[]> =>
  page.evaluate(() => {
    const slack = 1
    const paintSlack = 8
    const issues: OverflowIssue[] = []
    const viewport = document.documentElement.clientWidth
    const pageScroll = document.documentElement.scrollWidth
    if (pageScroll > viewport + slack) {
      issues.push({
        kind: 'page-scroll',
        detail: `document scrollWidth ${pageScroll} > clientWidth ${viewport}`
      })
    }

    const isSkippable = (el: Element) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true
      }
      if (style.position === 'fixed' || style.position === 'sticky') {
        return true
      }
      return false
    }

    for (const card of document.querySelectorAll<HTMLElement>(
      '[id^="resource-"]'
    )) {
      if (card.scrollWidth > card.clientWidth + slack) {
        issues.push({
          kind: 'card-scroll',
          cardId: card.id,
          detail: `scrollWidth ${card.scrollWidth} > clientWidth ${card.clientWidth}`
        })
      }
      const cardRight = card.getBoundingClientRect().right
      const walk = (el: Element) => {
        if (isSkippable(el)) return
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return
        if (rect.right > viewport + slack) {
          issues.push({
            kind: 'paint',
            cardId: card.id,
            detail: `${el.tagName.toLowerCase()} right ${rect.right.toFixed(1)} > viewport ${viewport}`
          })
        } else if (rect.right > cardRight + paintSlack) {
          issues.push({
            kind: 'paint',
            cardId: card.id,
            detail: `${el.tagName.toLowerCase()} right ${rect.right.toFixed(1)} > card ${cardRight.toFixed(1)}`
          })
        }
        for (const child of el.children) walk(child)
      }
      walk(card)
    }
    return issues
  })

const dumpOverflow = async (
  page: Page,
  label: string,
  issues: OverflowIssue[]
) => {
  await mkdir(artifactDir, { recursive: true })
  const shot = resolve(artifactDir, `${label}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  await writeFile(
    resolve(artifactDir, `${label}.json`),
    JSON.stringify(issues, null, 2)
  )
  console.error(`overflow artifacts: ${shot}`)
}

const assertNoOverflow = async (page: Page, label: string) => {
  const issues = await collectOverflow(page)
  if (issues.length > 0) {
    await dumpOverflow(page, label, issues)
  }
  assert.equal(
    issues.length,
    0,
    `${label}: ${issues
      .slice(0, 8)
      .map((issue) => issue.detail)
      .join('; ')}`
  )
}

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true
  })
  const page = await context.newPage()
  page.setDefaultTimeout(STEP_TIMEOUT_MS)

  try {
    await installAccessIntercepts(page)

    await check('opens the resource tab at 360px', async () => {
      const response = await page.goto(`${BASE_URL}${RESOURCE_PATH}`, {
        waitUntil: 'domcontentloaded'
      })
      assert.ok(response, 'navigation returned no response')
      assert.equal(
        response!.ok(),
        true,
        `GET ${RESOURCE_PATH} failed: ${response!.status()}`
      )
      await page.locator('[id^="resource-"]').first().waitFor()
      assert.ok(
        linkMeta.size > 0,
        'did not capture resource link health versions from GET /api/patch/resource'
      )
    })

    const card = page.locator('[id^="resource-"]').first()

    await check(
      'expanded resource card stays inside the phone viewport',
      async () => {
        await card.getByRole('button', { name: '下载 OtomeGame 资源' }).click()
        await card
          .getByRole('button', { name: /获取下载链接|查看已获取链接/ })
          .first()
          .waitFor()
        await assertNoOverflow(page, 'expanded-360')
      }
    )

    await check(
      'revealed download credentials stay inside the card at 360px',
      async () => {
        await card
          .getByRole('button', { name: /获取下载链接|查看已获取链接/ })
          .first()
          .click()
        await page.getByText(LONG_URL).waitFor()
        await page.getByText(LONG_PASSWORD).waitFor()
        await assertNoOverflow(page, 'revealed-360')
      }
    )

    await check(
      'revealed download credentials stay inside the card at 1280px',
      async () => {
        await page.setViewportSize(DESKTOP)
        await page.getByText(LONG_URL).waitFor()
        await assertNoOverflow(page, 'revealed-1280')
      }
    )
  } finally {
    await browser.close()
  }

  console.log(
    results
      .map((result) => `${result.name} ${result.milliseconds}ms`)
      .join('\n')
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
