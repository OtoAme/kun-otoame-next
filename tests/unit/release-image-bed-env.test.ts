import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../.github/workflows/release.yml', import.meta.url),
  'utf8'
)
const preparationStep = workflow
  .split('      - name: Create .env file\n')[1]
  .split('\n      - name:')[0]
const preparationCommand = preparationStep
  .split('        run: |\n')[1]
  .split('\n')
  .map((line) => line.replace(/^          /, ''))
  .join('\n')
  .replace(/\$\{\{ secrets\.[A-Z0-9_]+ \}\}/g, 'https://storage.release.test')
const directories: string[] = []

const prepareRelease = (imageBedUrl?: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'otoame-release-image-bed-'))
  directories.push(directory)
  const script = fileURLToPath(
    new URL('../../scripts/prepareReleaseImageBed.ts', import.meta.url)
  )
  if (existsSync(script)) {
    mkdirSync(join(directory, 'scripts'))
    copyFileSync(script, join(directory, 'scripts/prepareReleaseImageBed.ts'))
  }

  const result = spawnSync(
    'bash',
    ['-e', '-c', `${preparationCommand}\nprintf build > build-started`],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        ...(imageBedUrl === undefined
          ? {}
          : { KUN_VISUAL_NOVEL_IMAGE_BED_URL: imageBedUrl })
      }
    }
  )
  return { directory, result }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('release image bed build configuration', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['placeholder', 'https://example.com'],
    ['placeholder subdomain', 'https://images.example.com/assets'],
    ['other placeholder', 'https://images.example.org/assets'],
    ['malformed', 'not-a-url'],
    ['non-HTTPS', 'http://img.release.test/assets'],
    ['credentials', 'https://private-user:private-password@img.release.test'],
    ['empty credentials', 'https://@img.release.test'],
    ['query', 'https://img.release.test/assets?token=private-token'],
    ['empty query', 'https://img.release.test/assets?'],
    ['fragment', 'https://img.release.test/assets#private-fragment'],
    ['empty fragment', 'https://img.release.test/assets#'],
    ['wildcard host', 'https://*.release.test/assets'],
    ['IP host', 'https://127.0.0.1/assets'],
    ['single-label host', 'https://localhost/assets'],
    ['trailing-dot host', 'https://example.com./assets'],
    ['custom port', 'https://img.release.test:8443/assets'],
    [
      'newline injection',
      'https://img.release.test/\nJWT_SECRET=private-injected'
    ],
    [
      'carriage return',
      'https://img.release.test/\rJWT_SECRET=private-injected'
    ],
    ['tab', 'https://im\tg.release.test/assets'],
    ['backslash', 'https://img.release.test\\@other.release.test/assets'],
    [
      'encoded newline',
      'https://img.release.test/assets/%0aJWT_SECRET=private-injected'
    ]
  ])('blocks %s before environment creation or build', (_category, input) => {
    const { directory, result } = prepareRelease(input)

    expect(result.status).toBe(1)
    expect(existsSync(join(directory, '.env'))).toBe(false)
    expect(existsSync(join(directory, 'build-started'))).toBe(false)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/KUN_VISUAL_NOVEL_IMAGE_BED_URL: [^\n]+\n$/)
    expect(result.stderr).not.toMatch(/https?:|private-|JWT_SECRET/)
  })

  it.each([
    ['https://IMG.release.test', 'https://img.release.test'],
    [
      'https://img.release.test/assets/nested/',
      'https://img.release.test/assets/nested'
    ],
    [
      'https://img.release.test:443/assets/a%20b',
      'https://img.release.test/assets/a%20b'
    ],
    [
      'https://img.release.test/assets/$(touch%20SHOULD_NOT_EXIST)/',
      'https://img.release.test/assets/$(touch%20SHOULD_NOT_EXIST)'
    ]
  ])(
    'builds with the derived host and preserved root for %s',
    (input, root) => {
      const { directory, result } = prepareRelease(input)

      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(join(directory, 'build-started'))).toBe(true)
      const environment = parseEnv(
        readFileSync(join(directory, '.env'), 'utf8')
      )
      expect(environment.KUN_VISUAL_NOVEL_IMAGE_BED_HOST).toBe(
        'img.release.test'
      )
      expect(environment.KUN_VISUAL_NOVEL_IMAGE_BED_URL).toBe(root)
      expect(environment.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL).toBe(
        'https://storage.release.test'
      )
      expect(environment.JWT_SECRET).toBe('dummy_secret')
      expect(existsSync(join(directory, 'SHOULD_NOT_EXIST'))).toBe(false)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    }
  )

  it('passes the sole image bed input through the workflow environment', () => {
    expect(preparationStep).toContain(
      'KUN_VISUAL_NOVEL_IMAGE_BED_URL: ${{ vars.KUN_VISUAL_NOVEL_IMAGE_BED_URL }}'
    )
    expect(preparationCommand).not.toContain('${{ vars.')
    expect(preparationCommand).not.toContain('KUN_VISUAL_NOVEL_IMAGE_BED_HOST=')
    expect(preparationStep).not.toContain('continue-on-error')
  })
})
