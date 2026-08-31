import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readBuildSource = () =>
  readFile(new URL('../../scripts/deployBuild.ts', import.meta.url), 'utf8')

describe('local build deployment safety', () => {
  it('holds the durable deploy lock across pull and re-executes the pulled script', async () => {
    const source = await readBuildSource()
    const lock = source.indexOf('acquireDeployLock(slots.deployRoot)')
    const pull = source.indexOf("runDeployCommand('git', ['pull', '--ff-only']")
    const reexec = source.indexOf("['exec', 'esno', 'scripts/deployBuild.ts'")

    expect(lock).toBeGreaterThan(-1)
    expect(pull).toBeGreaterThan(lock)
    expect(reexec).toBeGreaterThan(pull)
    expect(source).toContain("const lockHeldArgument = '--lock-held'")
    expect(source).toContain('assertInheritedDeployLock(slots.deployRoot)')
    expect(source).toContain('DEPLOY_LOCK_OWNER_PID_ENV')
    expect(source).toContain(
      "['install', '--frozen-lockfile', '--ignore-scripts']"
    )
    expect(source).toContain("['rebuild', '--pending']")
    expect(source).not.toContain('execSync(')
  })

  it('keeps the previous release outside .next and restores the standalone compatibility link on failure', async () => {
    const source = await readBuildSource()
    const adopt = source.indexOf('adoptLegacyDeploySlot(slots)')
    const unlink = source.indexOf('unlinkSync(slots.standaloneLink)')
    const build = source.indexOf("runDeployCommand('pnpm', ['build']")
    const finallyBlock = source.lastIndexOf('if (!activated)')

    expect(adopt).toBeGreaterThan(-1)
    expect(unlink).toBeGreaterThan(adopt)
    expect(build).toBeGreaterThan(unlink)
    expect(finallyBlock).toBeGreaterThan(build)
    expect(source.slice(finallyBlock)).toContain('adoptLegacyDeploySlot(slots)')
  })

  it('installs and activates the validated local build through immutable release slots', async () => {
    const source = await readBuildSource()
    const prepare = source.indexOf('prepareLocalBuildCandidate(candidateRoot)')
    const validate = source.indexOf('validateStandaloneRuntime(candidateRoot)')
    const install = source.indexOf('installCandidateRelease(')
    const activate = source.indexOf('activateReleaseWithReadiness({')

    expect(source).toContain("runDeployCommand('pnpm', ['prisma:deploy-safe']")
    expect(source).not.toContain('prisma:push')
    expect(source).toContain(
      'copyPrismaClientRuntimePackage(rootNodeModules, candidateNodeModules)'
    )
    expect(source).not.toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, '@prisma')"
    )
    expect(source).toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, 'react-dom')"
    )
    expect(source).not.toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, 'next')"
    )
    expect(source).not.toContain(
      "copyPackage(rootNodeModules, candidateNodeModules, 'react')"
    )
    expect(prepare).toBeGreaterThan(-1)
    expect(validate).toBeGreaterThan(prepare)
    expect(install).toBeGreaterThan(validate)
    expect(activate).toBeGreaterThan(install)
    expect(source).toContain('restartAndVerifyProduction({')
    expect(source).not.toContain('startOrReload')
  })
})
