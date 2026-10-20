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

  it('routes server builds from the README to the production deployment guide', async () => {
    const [readme, deployment] = await Promise.all([
      readProjectFile('README.md'),
      readProjectFile('docs/project/deployment.md')
    ])
    const serverBuild = extractMarkdownSection(deployment, '### 在服务器构建')

    expect(readme).toContain('](docs/project/deployment.md)')
    expect(deployment).toContain('](../modules/operations.md')
    expect(serverBuild).toContain('pnpm deploy:build')
    expect(serverBuild).toContain('生产结构检查')
    expect(serverBuild).not.toContain('pnpm prisma:push')
  })

  it('documents compatibility writes and rejects persistent-database initialization', async () => {
    const operations = await readProjectFile('docs/modules/operations.md')
    const guard = extractMarkdownSection(operations, '## 生产结构检查')

    expect(guard).toContain('pnpm prisma:deploy-safe')
    expect(guard).toContain('资源链接兼容迁移')
    expect(guard).toContain('只读比较结构')
    expect(guard).toContain('生成客户端')
    expect(guard).toContain('已有持久库不能改用开发初始化')
    expect(guard).not.toContain('pnpm prisma:push')
  })

  it('separates disposable local initialization from production schema checks', async () => {
    const [development, operations] = await Promise.all([
      readProjectFile('docs/project/development.md'),
      readProjectFile('docs/modules/operations.md')
    ])
    const initialization = extractMarkdownSection(
      development,
      '## 在空开发库启动'
    )
    const guard = extractMarkdownSection(operations, '## 生产结构检查')

    expect(initialization).toContain('可丢弃空库')
    expect(initialization).toContain('pnpm prisma:push')
    expect(guard).toContain('pnpm prisma:deploy-safe')
    expect(guard).not.toContain('pnpm prisma:push')
  })

  it('keeps rollback guidance off production db push and old-version safe-script assumptions', async () => {
    const [deployment, operations] = await Promise.all([
      readProjectFile('docs/project/deployment.md'),
      readProjectFile('docs/modules/operations.md')
    ])
    const rollback = extractMarkdownSection(deployment, '## 离线回退应用')
    const databaseRecovery = extractMarkdownSection(
      operations,
      '## 失败与数据库恢复'
    )

    expect(rollback).toContain('pnpm deploy:rollback')
    expect(rollback).toContain('兼容当前数据库')
    expect(rollback).toContain('不修改数据库')
    expect(rollback).toContain('](../modules/operations.md#失败与数据库恢复)')
    expect(rollback).not.toContain('pnpm prisma:push')
    expect(rollback).not.toContain('pnpm prisma:deploy-safe')
    expect(databaseRecovery).toContain('备份')
    expect(databaseRecovery).toContain('持续停写')
    expect(databaseRecovery).toContain(
      'production-company-identity-constraint-rollback-2026-08-30.sql'
    )
    expect(databaseRecovery).toContain(
      'production-company-identity-constraint-rollback-postflight-2026-08-30.sql'
    )
    expect(databaseRecovery).not.toContain('pnpm prisma:push')
  })
})
