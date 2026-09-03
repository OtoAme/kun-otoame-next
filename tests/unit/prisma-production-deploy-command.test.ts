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
    expect(pkg.scripts['deploy:pull']).toBe(
      'esno scripts/deployPullLauncher.ts'
    )
    expect(pkg.scripts['deploy:pull:pinned']).toBe(
      'esno scripts/deployPullLauncher.ts --pinned'
    )
    expect(pkg.scripts['deploy:rollback']).toBe(
      'esno scripts/deployRollback.ts'
    )
  })

  it('guards deploy pull before replacing the running standalone directory', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const guardPosition = source.indexOf(
      'runCandidatePrismaGuard(candidateRoot)'
    )
    const replacementPosition = source.indexOf('installCandidateRelease(')
    const generatePosition = source.indexOf(
      'generatePrismaClientForCandidate(candidateRoot)'
    )
    const installPosition = source.indexOf(
      "['install', '--frozen-lockfile', '--ignore-scripts']"
    )
    const clientBackupPosition = source.indexOf('backupGeneratedPrismaClient(')

    expect(clientBackupPosition).toBeGreaterThan(-1)
    expect(installPosition).toBeGreaterThan(-1)
    expect(clientBackupPosition).toBeLessThan(installPosition)
    expect(installPosition).toBeLessThan(guardPosition)
    expect(guardPosition).toBeGreaterThan(-1)
    expect(generatePosition).toBeGreaterThan(guardPosition)
    expect(generatePosition).toBeLessThan(replacementPosition)
    expect(guardPosition).toBeLessThan(replacementPosition)
    expect(source).not.toContain('prisma:push')
    expect(source).toContain('checkPrismaProductionSchema.ts')
    expect(source).toContain('`--schema=${schemaPath}`')
    expect(source).toContain('`--candidate-root=${candidateRoot}`')
    expect(source).toContain('restoreGeneratedPrismaClient(')
  })

  it('defers dependency lifecycle scripts and Prisma generation until after the candidate guard', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const installPosition = source.indexOf("'--ignore-scripts'")
    const guardPosition = source.indexOf(
      'runCandidatePrismaGuard(candidateRoot)'
    )
    const rebuildPosition = source.indexOf("['rebuild', '--pending']")
    const generatePosition = source.indexOf(
      'generatePrismaClientForCandidate(candidateRoot)'
    )
    const materializePosition = source.indexOf(
      'materializeCandidatePrismaClient(candidateRoot)'
    )

    expect(installPosition).toBeGreaterThan(-1)
    expect(guardPosition).toBeGreaterThan(installPosition)
    expect(rebuildPosition).toBeGreaterThan(guardPosition)
    expect(generatePosition).toBeGreaterThan(rebuildPosition)
    expect(materializePosition).toBeGreaterThan(generatePosition)
  })

  it('generates from the verified root schema and materializes the client into the candidate', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const generateDefinition = source.indexOf(
      'const generatePrismaClientForCandidate ='
    )
    const schemaAssertion = source.indexOf(
      'assertSamePrismaSchema(',
      generateDefinition
    )
    const generateCommand = source.indexOf(
      "['exec', 'prisma', 'generate']",
      schemaAssertion
    )
    const materializeDefinition = source.indexOf(
      'const materializeCandidatePrismaClient ='
    )
    const generatedCopy = source.indexOf(
      'copyGeneratedPrismaClient(rootNodeModules, candidateNodeModules)',
      materializeDefinition
    )
    const packageCopy = source.indexOf(
      'copyPrismaClientRuntimePackage(rootNodeModules, candidateNodeModules)',
      generatedCopy
    )
    const generatedAssertion = source.indexOf(
      'assertGeneratedPrismaClient(candidateNodeModules)',
      packageCopy
    )

    expect(generateDefinition).toBeGreaterThan(-1)
    expect(schemaAssertion).toBeGreaterThan(generateDefinition)
    expect(generateCommand).toBeGreaterThan(schemaAssertion)
    expect(materializeDefinition).toBeGreaterThan(-1)
    expect(generatedCopy).toBeGreaterThan(materializeDefinition)
    expect(packageCopy).toBeGreaterThan(generatedCopy)
    expect(generatedAssertion).toBeGreaterThan(packageCopy)
    expect(source).not.toContain("'generate', `--schema=")
    expect(source).not.toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, '@prisma')"
    )
  })
  it('materializes, preflights, and validates the candidate before installing it', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const generateCall = source.indexOf(
      'generatePrismaClientForCandidate(candidateRoot)'
    )
    const materializeCall = source.indexOf(
      'materializeCandidatePrismaClient(candidateRoot)',
      generateCall
    )
    const injectCall = source.indexOf(
      'injectRuntimeDependencies(candidateRoot)',
      materializeCall
    )
    const preflightCall = source.indexOf(
      'preflightCandidatePrismaClient(candidateRoot)',
      injectCall
    )
    const validateCall = source.indexOf(
      'validateStandaloneRuntime(candidateRoot)',
      preflightCall
    )
    const installCall = source.indexOf('installCandidateRelease(', validateCall)

    expect(generateCall).toBeGreaterThan(-1)
    expect(materializeCall).toBeGreaterThan(generateCall)
    expect(injectCall).toBeGreaterThan(materializeCall)
    expect(preflightCall).toBeGreaterThan(injectCall)
    expect(validateCall).toBeGreaterThan(preflightCall)
    expect(installCall).toBeGreaterThan(validateCall)
    expect(source).not.toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, 'react-dom')"
    )
    expect(source).toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, 'ffmpeg-static')"
    )
    expect(source).toContain("require('@prisma/client')")
  })
  it('holds the durable deployment lock across latest source pull and the updated core script', async () => {
    const [launcher, source] = await Promise.all([
      readProjectFile('scripts/deployPullLauncher.ts'),
      readProjectFile('scripts/deployPull.ts')
    ])
    const lockPosition = launcher.indexOf('acquireDeployLock(slots.deployRoot)')
    const adoptPosition = launcher.indexOf('adoptLegacyDeploySlot(slots)')
    const pullPosition = launcher.indexOf("['pull', '--ff-only']")
    const corePosition = launcher.indexOf("'scripts/deployPull.ts'")

    expect(lockPosition).toBeGreaterThan(-1)
    expect(adoptPosition).toBeGreaterThan(lockPosition)
    expect(pullPosition).toBeGreaterThan(adoptPosition)
    expect(corePosition).toBeGreaterThan(pullPosition)
    expect(launcher).toContain("'--lock-held'")
    expect(launcher).toContain('DEPLOY_LOCK_OWNER_PID_ENV')
    expect(source).toContain('mode.lockHeld')
    expect(source).toContain('assertInheritedDeployLock(slots.deployRoot)')
    expect(source).toContain("release: 'pinned'")
  })

  it('resolves and validates a command-scoped release tag before replacement or PM2 start', async () => {
    const source = await readProjectFile('scripts/deployPull.ts')
    const tagPosition = source.indexOf('KUN_DEPLOY_RELEASE_TAG')
    const selectionPosition = source.indexOf(
      'selectReleaseAsset(release, expectedTag)'
    )
    const replacementPosition = source.indexOf('installCandidateRelease(')
    const identityPosition = source.indexOf('verifyReleaseIdentity({')
    const pm2Position = source.lastIndexOf('restartAndVerifyProduction({')

    expect(tagPosition).toBeGreaterThan(-1)
    expect(selectionPosition).toBeGreaterThan(-1)
    expect(source).toContain('assertCleanDeployWorktree(projectRoot)')
    expect(source).toContain("runDeployCommand('git', getPinnedFetchArgs")
    expect(source).not.toContain("runDeployCommand('git', ['pull'")
    expect(source).toContain('verifyReleaseIdentity({')
    expect(source).toContain('activateReleaseWithReadiness({')
    expect(source).toContain('restartAndVerifyProduction({')
    expect(source).toContain('acquireDeployLock(slots.deployRoot)')
    expect(source).toContain('getPinnedFetchArgs(release.tag)')
    expect(source.indexOf('getPinnedFetchArgs(release.tag)')).toBeLessThan(
      source.indexOf('await downloadFile(release.downloadUrl')
    )
    expect(identityPosition).toBeLessThan(replacementPosition)
    expect(replacementPosition).toBeGreaterThan(-1)
    expect(pm2Position).toBeGreaterThan(replacementPosition)
  })

  it('packages a versioned release manifest before creating the artifact', async () => {
    const release = await readProjectFile('.github/workflows/release.yml')
    const tagPosition = release.indexOf('- name: Generate CalVer Tag')
    const packagePosition = release.indexOf('- name: Prepare Release Package')
    const manifestPosition = release.indexOf('release-manifest.json')
    const archivePosition = release.indexOf('tar -czf ../release.tar.gz')

    expect(tagPosition).toBeGreaterThan(-1)
    expect(tagPosition).toBeLessThan(packagePosition)
    expect(manifestPosition).toBeGreaterThan(packagePosition)
    expect(manifestPosition).toBeLessThan(archivePosition)
    expect(release).toContain('commitSha: process.env.RELEASE_COMMIT_SHA')
    expect(release).toContain('tag: process.env.RELEASE_TAG')
    expect(release).toContain('group: release-main')
    expect(release).toContain('cancel-in-progress: false')
    expect(release).toContain("date +'%Y.%m.%d.%H%M%S'")
    expect(release).toContain('${GITHUB_RUN_NUMBER}')
    expect(release).toContain('${GITHUB_SHA::8}')
  })

  it('keeps rollback local, offline, and free of database commands', async () => {
    const rollback = await readProjectFile('scripts/deployRollback.ts')

    expect(rollback).toContain('recoverOrRollbackWithReadiness({')
    expect(rollback).toContain('restartAndVerifyProduction({')
    expect(rollback).toContain('acquireDeployLock(slots.deployRoot)')
    expect(rollback).not.toMatch(/\bgit\b/)
    expect(rollback).not.toMatch(/https|GITHUB|prisma|migration:/i)
  })

  it('keeps PM2 compatible with managed current and legacy standalone layouts', async () => {
    const ecosystem = await readProjectFile('ecosystem.config.cjs')
    expect(ecosystem).toContain("'.deploy', 'current'")
    expect(ecosystem).toContain("'.next', 'standalone'")
    expect(ecosystem).toContain('fs.existsSync(managedCurrentDir)')
  })

  it('uses the safe command for server builds but leaves disposable CI push unchanged', async () => {
    const [build, release] = await Promise.all([
      readProjectFile('scripts/deployBuild.ts'),
      readProjectFile('.github/workflows/release.yml')
    ])

    const guardPosition = build.indexOf(
      "runDeployCommand('pnpm', ['prisma:deploy-safe']"
    )
    const buildPosition = build.indexOf("runDeployCommand('pnpm', ['build']")

    expect(guardPosition).toBeGreaterThan(-1)
    expect(buildPosition).toBeGreaterThan(guardPosition)
    expect(build).not.toContain('prisma:push')
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
