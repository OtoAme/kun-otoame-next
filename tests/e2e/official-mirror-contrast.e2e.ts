/** Real browser dark-theme contrast regression on this run's synthetic cards. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Redis from 'ioredis'
import pg from 'pg'
import { chromium, type Locator } from 'playwright-core'
import { session, openAs, shot } from './official-mirror-ui.browser'
const required = (name: string) => { const value = process.env[name]; assert(value, name); return value }
const url = new URL(required('KUN_E2E_DATABASE_URL'))
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55436')
assert.equal(url.pathname, '/official_mirror_e_ui_e2e'); assert.equal(url.username, 'official_mirror_e')
assert.equal(required('KUN_E2E_REDIS_URL'), 'redis://127.0.0.1:56380')
const dir = required('KUN_E2E_ARTIFACT_DIR')
const pool = new pg.Pool({ connectionString: url.href })
const redis = new Redis(required('KUN_E2E_REDIS_URL'))
const sample = (locator: Locator) => locator.evaluate(element => {
  const style = getComputedStyle(element)
  let node: Element | null = element
  const backgrounds: string[] = []
  while (node) {
    backgrounds.push(getComputedStyle(node).backgroundColor)
    node = node.parentElement
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
  const luminance = (channels: number[]) => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  const fg = luminance(rgb(style.color))
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1)
  for (const color of backgrounds.reverse()) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1) }
  const background = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  const bg = luminance(background)
  return { color: style.color, background, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), colorScheme: getComputedStyle(document.documentElement).colorScheme }
})
async function main() {
  const fixture = JSON.parse(await readFile(join(dir, 'synthetic-fixture.json'), 'utf8'))
  const token = await session(redis, fixture.adminId, 'e2e_admin', 4)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const { page, context } = await openAs(browser, token, { width: 390, height: 900 })
    // esno preserves nested helper names with __name; provide it only to evaluation helpers.
    await context.addInitScript('globalThis.__name = (fn) => fn')
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'))
    const pair = fixture.highC
    await page.goto(`http://127.0.0.1:3100/dashboard/resource-merges?id=${pair.userResourceId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: new RegExp(`用户资源 #${pair.userResourceId} ·`) }).waitFor()
    await page.getByRole('tab', { name: '合并后预览', exact: true }).click()
    const frame = page.frameLocator(`iframe[title="合并后预览 #${pair.userResourceId} ← #${pair.staffResourceId}"]`)
    const note = frame.getByText('用户备注', { exact: true })
    await note.waitFor()
    await page.getByRole('button', { name: '切换明暗主题', exact: true }).click()
    await frame.locator('html.dark').waitFor()
    const input = page.getByRole('searchbox', { name: '搜索游戏或资源', exact: true })
    const immediate = { search: await sample(input), note: await sample(note) }
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))))
    await note.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))))
    const settled = { search: await sample(input), note: await sample(note) }
    await writeFile(join(dir, 'contrast-result.json'), JSON.stringify({ sourceSha: required('KUN_E2E_SOURCE_SHA'), immediate, settled }, null, 2))
    await shot(page, 'acceptance-dark-settled.png')
    assert(settled.search.ratio >= 4.5, 'settled dark search contrast: ' + JSON.stringify(settled.search))
    assert(settled.note.ratio >= 4.5, 'settled dark resource note contrast: ' + JSON.stringify(settled.note))
    console.log('PASS settled real dark search and preview-note contrast')
    await context.close()
  } finally { await browser.close() }
}
void main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await redis.quit(); await pool.end() })
