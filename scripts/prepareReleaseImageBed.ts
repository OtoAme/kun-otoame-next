import { writeFileSync } from 'node:fs'
import { isIP } from 'node:net'

function fail(category: string): never {
  process.stderr.write(`KUN_VISUAL_NOVEL_IMAGE_BED_URL: ${category}\n`)
  process.exit(1)
}

const value = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
if (!value?.trim()) fail('missing required build configuration')
if (/[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value)) {
  fail('whitespace, control characters or backslashes are not allowed')
}
if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) {
  fail('encoded control characters are not allowed')
}
if (!/^https:\/\//i.test(value)) fail('an absolute HTTPS URL is required')

let url: URL
try {
  url = new URL(value)
} catch {
  fail('invalid URL format')
}

const authority = value.slice(value.indexOf('://') + 3).split('/')[0]
if (url.username || url.password || authority.includes('@')) {
  fail('credentials are not allowed')
}
if (/[?#]/.test(value)) fail('queries and fragments are not allowed')
if (url.port) fail('a non-default port is not allowed')
if (
  isIP(url.hostname) ||
  url.hostname.length > 253 ||
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
    url.hostname
  )
) {
  fail('an exact domain hostname is required')
}
if (/(^|\.)example\.(com|net|org)$/.test(url.hostname)) {
  fail('a placeholder hostname is not allowed')
}

const root = url.href.replace(/\/+$/, '')
try {
  writeFileSync(
    '.env',
    `KUN_VISUAL_NOVEL_IMAGE_BED_HOST=${JSON.stringify(url.hostname)}\n` +
      `KUN_VISUAL_NOVEL_IMAGE_BED_URL=${JSON.stringify(root)}\n`,
    { mode: 0o600 }
  )
} catch {
  fail('cannot write the build environment file')
}
