import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const extractMarkdownSection = (markdown: string, heading: string) => {
  const headingMatch = /^(#{1,6})\s+/.exec(heading)

  if (!headingMatch) {
    throw new Error(`Invalid Markdown heading: ${heading}`)
  }

  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === heading)

  if (start === -1) {
    throw new Error(`Markdown heading not found: ${heading}`)
  }

  const headingLevel = headingMatch[1].length
  const nextHeadingOffset = lines.slice(start + 1).findIndex((line) => {
    const match = /^(#{1,6})\s+/.exec(line)
    return match !== null && match[1].length <= headingLevel
  })
  const end =
    nextHeadingOffset === -1 ? lines.length : start + 1 + nextHeadingOffset

  return lines.slice(start, end).join('\n')
}

describe('production Prisma deployment command', () => {
  it('keeps development push and adds the fail-closed production command', async () => {
    const pkg = JSON.parse(await readProjectFile('package.json'))

    expect(pkg.scripts['prisma:push']).toBe(
      'pnpm migration:resource-links && pnpm prisma db push && pnpm prisma generate'
    )
    expect(pkg.scripts['prisma:deploy-safe']).toBe(
      'pnpm migration:resource-links && esno scripts/checkPrismaProductionSchema.ts && pnpm prisma generate'
    )
  })

  it('guards deploy pull before replacing the running standalone directory', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const guardPosition = source.indexOf("execSync('pnpm prisma:deploy-safe'")
    const replacementPosition = source.indexOf(
      "console.log('Applying atomic update...')"
    )

    expect(guardPosition).toBeGreaterThan(-1)
    expect(guardPosition).toBeLessThan(replacementPosition)
    expect(source).not.toContain("execSync('pnpm prisma:push'")
  })

  it('resolves and validates a command-scoped release tag before replacement or PM2 start', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const tagPosition = source.indexOf('KUN_DEPLOY_RELEASE_TAG')
    const selectionPosition = source.indexOf(
      'selectReleaseAsset(release, expectedTag)'
    )
    const replacementPosition = source.indexOf(
      "console.log('Applying atomic update...')"
    )
    const pm2Position = source.indexOf(
      "console.log('Reloading application...')"
    )

    expect(tagPosition).toBeGreaterThan(-1)
    expect(selectionPosition).toBeGreaterThan(-1)
    expect(selectionPosition).toBeLessThan(replacementPosition)
    expect(selectionPosition).toBeLessThan(pm2Position)
  })

  it('uses the safe command for server builds but leaves disposable CI push unchanged', async () => {
    const [build, release] = await Promise.all([
      readProjectFile('scripts/deployBuild.ts'),
      readProjectFile('.github/workflows/release.yml')
    ])

    expect(build).toContain('pnpm prisma:deploy-safe && pnpm build')
    expect(build).not.toContain('pnpm prisma:push && pnpm build')
    expect(release).toContain('run: pnpm prisma:push')
    expect(release).not.toContain('prisma:deploy-safe')
  })

  it('keeps the README server-build instructions behind the reviewed production guard', async () => {
    const readme = await readProjectFile('README.md')
    const serverBuild = extractMarkdownSection(readme, '### 服务器本地构建')

    expect(serverBuild).toContain('review')
    expect(serverBuild).toContain('preflight/sync SQL')
    expect(serverBuild).toContain('pnpm prisma:deploy-safe')
    expect(serverBuild).toContain('migration:resource-links')
    expect(serverBuild).toContain('只读 schema guard/diff')
    expect(serverBuild).not.toContain('pnpm prisma:push')
  })

  it('does not describe deploy:build as entering a database reset prompt', async () => {
    const readme = await readProjectFile('README.md')
    const warning = extractMarkdownSection(readme, '## 严重警告')

    expect(warning).toContain('手工')
    expect(warning).toContain('写 schema')
    expect(warning).toContain('fail-closed')
    expect(warning).toContain('pnpm prisma:deploy-safe')
    expect(warning).not.toContain('运行 `pnpm deploy:build` 或者')
  })

  it('separates local initialization from production schema checks in the maintenance table', async () => {
    const readme = await readProjectFile('README.md')
    const maintenance = extractMarkdownSection(readme, '## 日常维护命令')

    expect(maintenance).toMatch(
      /\*\*本地[^|]*首次初始化[^|]*\*\*\s*\|\s*`pnpm prisma:push`/
    )
    expect(maintenance).toMatch(
      /\*\*生产 schema 校验\*\*\s*\|\s*`pnpm prisma:deploy-safe`/
    )
  })

  it('keeps rollback guidance off production db push and old-version safe-script assumptions', async () => {
    const deployment = await readProjectFile('docs/project/deployment.md')
    const rollback = extractMarkdownSection(deployment, '## 回滚思路')

    expect(rollback).toContain('review')
    expect(rollback).toContain('preflight')
    expect(rollback).toContain('rollback/sync SQL')
    expect(rollback).toContain('目标版本')
    expect(rollback).toContain('pnpm prisma generate')
    expect(rollback).not.toContain('pnpm prisma:push')
    expect(rollback).not.toContain('pnpm prisma:deploy-safe')
  })
})
