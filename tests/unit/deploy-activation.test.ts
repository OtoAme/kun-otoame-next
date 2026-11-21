import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeploymentStartError } from '~/scripts/deployPm2'
import { acquireDeployLock } from '~/scripts/deployLock'
import { activateReleaseWithReadiness } from '~/scripts/deployActivation'
import {
  beginCandidateActivation,
  getCurrentDeployRelease,
  getDeploySlotPaths,
  installCandidateRelease,
  readActivationJournal,
  assertNoPendingActivation
} from '~/scripts/deploySlots'

const roots: string[] = []
const locks: Array<() => void> = []
const candidateId =
  '0123456789abcdef0123456789abcdef01234567-v2026.08.31.120000.1.01234567'

const createRelease = (path: string, marker: string) => {
  for (const directory of [
    'prisma/schema',
    'node_modules/.prisma/client',
    'node_modules/@prisma/client'
  ]) {
    mkdirSync(join(path, directory), { recursive: true })
  }
  writeFileSync(join(path, 'server.mjs'), marker)
  writeFileSync(join(path, 'prisma/schema/schema.prisma'), marker)
  writeFileSync(join(path, 'node_modules/.prisma/marker'), marker)
  writeFileSync(join(path, 'node_modules/@prisma/marker'), marker)
}

const createDeployment = () => {
  const root = mkdtempSync(join(tmpdir(), 'otoame-deploy-activation-'))
  roots.push(root)
  const paths = getDeploySlotPaths(root)
  locks.push(acquireDeployLock(paths.deployRoot))
  createRelease(paths.legacyStandalone, 'legacy')
  mkdirSync(join(root, 'prisma/schema'), { recursive: true })
  writeFileSync(join(root, 'prisma/schema/schema.prisma'), 'legacy')
  mkdirSync(join(root, 'node_modules/.prisma/client'), { recursive: true })
  mkdirSync(join(root, 'node_modules/@prisma/client'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.prisma/marker'), 'legacy')
  writeFileSync(join(root, 'node_modules/@prisma/marker'), 'legacy')
  const candidate = join(root, 'candidate')
  createRelease(candidate, 'candidate')
  return {
    paths,
    candidateRelease: installCandidateRelease(paths, candidate, candidateId),
    legacyRelease: join(paths.releasesRoot, 'legacy-initial')
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const releaseLock of locks.splice(0).reverse()) releaseLock()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('deployment activation readiness recovery', () => {
  it('cleans history only after verified activation and retains current and previous', async () => {
    const deployment = createDeployment()
    const obsolete = join(
      deployment.paths.releasesRoot,
      `${'b'.repeat(40)}-old`
    )
    createRelease(obsolete, 'obsolete')
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness: async () => {
        expect(existsSync(obsolete)).toBe(true)
        expect(getCurrentDeployRelease(deployment.paths)).toBe(
          realpathSync(deployment.legacyRelease)
        )
      }
    })
    expect(existsSync(obsolete)).toBe(false)
    expect(existsSync(deployment.legacyRelease)).toBe(true)
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
    expect(existsSync(deployment.paths.journal)).toBe(false)
  })

  it('leaves the failure unresolved and never starts the old release after candidate failure', async () => {
    const deployment = createDeployment()
    const obsolete = join(
      deployment.paths.releasesRoot,
      `${'b'.repeat(40)}-old`
    )
    createRelease(obsolete, 'obsolete')
    const failure = new DeploymentStartError(new Error('candidate failed'))
    const verifyReadiness = vi.fn(async () => {
      throw failure
    })
    await expect(
      activateReleaseWithReadiness({ ...deployment, verifyReadiness })
    ).rejects.toBe(failure)
    expect(verifyReadiness.mock.calls).toHaveLength(1)
    expect(verifyReadiness).toHaveBeenCalledWith(deployment.candidateRelease)
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
    expect(readActivationJournal(deployment.paths)?.failure).toMatchObject({
      stopConfirmed: true,
      message: expect.stringContaining('candidate failed')
    })
    expect(existsSync(obsolete)).toBe(true)
    expect(existsSync(deployment.candidateRelease)).toBe(true)
    const nextAttempt = vi.fn(async () => undefined)
    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        verifyReadiness: nextAttempt
      })
    ).rejects.toThrow('Unresolved deployment activation')
    expect(nextAttempt).not.toHaveBeenCalled()
  })

  it('retains both the original start error and unconfirmed stop fact', async () => {
    const deployment = createDeployment()
    const failure = new DeploymentStartError(
      new Error('partial start failed'),
      new Error('stop denied')
    )
    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        verifyReadiness: async () => {
          throw failure
        }
      })
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'partial start failed' }),
        expect.objectContaining({ message: 'stop denied' })
      ]
    })
    expect(readActivationJournal(deployment.paths)?.failure).toMatchObject({
      stopConfirmed: false,
      message: expect.stringContaining('未能确认停止')
    })
  })

  it('requires explicit recovery for pending state and preserves failure evidence across attempts', async () => {
    const deployment = createDeployment()
    beginCandidateActivation(deployment.paths, deployment.candidateRelease)
    expect(() => assertNoPendingActivation(deployment.paths)).toThrow(
      'Unresolved'
    )
    const verifyReadiness = vi.fn(async () => {
      throw new Error('manual target failed')
    })
    await expect(
      activateReleaseWithReadiness({
        paths: deployment.paths,
        candidateRelease: deployment.legacyRelease,
        verifyReadiness,
        explicitRecovery: true
      })
    ).rejects.toThrow('manual target failed')
    expect(verifyReadiness).toHaveBeenCalledOnce()
    expect(verifyReadiness).toHaveBeenCalledWith(deployment.legacyRelease)
    expect(readActivationJournal(deployment.paths)?.candidate).toBe(
      'releases/legacy-initial'
    )
    expect(
      existsSync(join(deployment.paths.deployRoot, 'activation-history'))
    ).toBe(true)
    expect(existsSync(deployment.candidateRelease)).toBe(true)
  })

  it('supports an explicitly selected retry and leaves recovery evidence out of cleanup', async () => {
    const deployment = createDeployment()
    beginCandidateActivation(deployment.paths, deployment.candidateRelease)
    const verifyReadiness = vi.fn(async () => undefined)
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness,
      explicitRecovery: true
    })
    expect(verifyReadiness).toHaveBeenCalledOnce()
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
    expect(existsSync(deployment.paths.journal)).toBe(false)
    expect(existsSync(deployment.legacyRelease)).toBe(true)
  })
  it('retains a legacy v1 switched-current failure through a failed explicit recovery without a third startup', async () => {
    const deployment = createDeployment()
    beginCandidateActivation(deployment.paths, deployment.candidateRelease)
    const journal = {
      version: 1,
      oldCurrent: 'releases/legacy-initial',
      candidate: `releases/${candidateId}`
    }
    writeFileSync(deployment.paths.journal, JSON.stringify(journal))
    rmSync(deployment.paths.current)
    symlinkSync(deployment.candidateRelease, deployment.paths.current, 'dir')
    const verifyReadiness = vi.fn(async () => {
      throw new DeploymentStartError(new Error('selected old release failed'))
    })
    await expect(
      activateReleaseWithReadiness({
        paths: deployment.paths,
        candidateRelease: deployment.legacyRelease,
        explicitRecovery: true,
        verifyReadiness
      })
    ).rejects.toThrow('selected old release failed')
    expect(verifyReadiness).toHaveBeenCalledExactlyOnceWith(
      deployment.legacyRelease
    )
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
    expect(
      readActivationJournal(deployment.paths)?.failure?.stopConfirmed
    ).toBe(true)
    const history = join(deployment.paths.deployRoot, 'activation-history')
    expect(readdirSync(history)).toHaveLength(1)
    expect(
      JSON.parse(readFileSync(join(history, readdirSync(history)[0]), 'utf8'))
    ).toEqual(journal)
  })

  it('refuses explicit recovery before startup when original journal archival is unsafe', async () => {
    const deployment = createDeployment()
    beginCandidateActivation(deployment.paths, deployment.candidateRelease)
    const original = readFileSync(deployment.paths.journal, 'utf8')
    symlinkSync(
      deployment.paths.releasesRoot,
      join(deployment.paths.deployRoot, 'activation-history'),
      'dir'
    )
    const verifyReadiness = vi.fn(async () => undefined)
    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        explicitRecovery: true,
        verifyReadiness
      })
    ).rejects.toThrow('history must be a real directory')
    expect(verifyReadiness).not.toHaveBeenCalled()
    expect(readFileSync(deployment.paths.journal, 'utf8')).toBe(original)
  })
  it('stops the verified candidate and retains the journal if the activation record changes before completion', async () => {
    const deployment = createDeployment()
    const stopRelease = vi.fn(async () => undefined)
    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        stopRelease,
        verifyReadiness: async () => {
          const journal = readActivationJournal(deployment.paths)!
          writeFileSync(
            deployment.paths.journal,
            JSON.stringify({ ...journal, candidate: 'releases/legacy-initial' })
          )
        }
      })
    ).rejects.toThrow('journal changed before completion')
    expect(stopRelease).toHaveBeenCalledExactlyOnceWith(
      deployment.candidateRelease
    )
    expect(existsSync(deployment.paths.journal)).toBe(true)
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
  })
})
