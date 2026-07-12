import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

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
})
