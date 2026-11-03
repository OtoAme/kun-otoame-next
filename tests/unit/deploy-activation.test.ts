import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireDeployLock } from '~/scripts/deployLock'
import {
  activateReleaseWithReadiness,
  recoverOrRollbackWithReadiness,
  rollbackReleaseWithReadiness
} from '~/scripts/deployActivation'
import {
  beginCandidateActivation,
  getCurrentDeployRelease,
  getDeploySlotPaths,
  installCandidateRelease
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
  it('cleans historical releases only after readiness and retains the rollback target', async () => {
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
      }
    })
    expect(existsSync(obsolete)).toBe(false)
    expect(existsSync(deployment.legacyRelease)).toBe(true)
    expect(existsSync(deployment.candidateRelease)).toBe(true)
  })

  it('preserves historical releases when candidate readiness fails', async () => {
    const deployment = createDeployment()
    const obsolete = join(
      deployment.paths.releasesRoot,
      `${'b'.repeat(40)}-old`
    )
    createRelease(obsolete, 'obsolete')
    const verifyReadiness = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('candidate failed'))
      .mockResolvedValueOnce(undefined)
    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        verifyReadiness
      })
    ).rejects.toThrow('previous release was restored and verified')
    expect(existsSync(obsolete)).toBe(true)
    expect(existsSync(deployment.candidateRelease)).toBe(true)
  })

  it('reports cleanup failure without rolling back a healthy deployment', async () => {
    const deployment = createDeployment()
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const unknownPointer = join(
      deployment.paths.releasesRoot,
      'operator-directory'
    )
    mkdirSync(unknownPointer)
    // A retained pointer with an unmanaged name must stop cleanup.
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness: async () => {
        rmSync(deployment.paths.previous)
        symlinkSync(unknownPointer, deployment.paths.previous, 'dir')
      }
    })
    expect(warning).toHaveBeenCalledOnce()
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
    expect(existsSync(deployment.paths.journal)).toBe(false)
  })

  it('keeps the candidate only after its readiness succeeds', async () => {
    const deployment = createDeployment()
    const verifyReadiness = vi.fn(async () => undefined)
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness
    })
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
    expect(verifyReadiness).toHaveBeenCalledOnce()
  })

  it('restores and verifies the known-good release after candidate failure', async () => {
    const deployment = createDeployment()
    const verifyReadiness = vi
      .fn<(releasePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('candidate failed'))
      .mockResolvedValueOnce(undefined)

    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        verifyReadiness
      })
    ).rejects.toThrow('previous release was restored and verified')
    expect(
      verifyReadiness.mock.calls.map(([path]) => realpathSync(path))
    ).toEqual([
      realpathSync(deployment.candidateRelease),
      realpathSync(deployment.legacyRelease)
    ])
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
  })

  it('reports both failures when candidate and restored release are unhealthy', async () => {
    const deployment = createDeployment()
    const verifyReadiness = vi
      .fn<(releasePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('candidate failed'))
      .mockRejectedValueOnce(new Error('previous failed'))

    await expect(
      activateReleaseWithReadiness({
        ...deployment,
        verifyReadiness
      })
    ).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'candidate failed' }),
        expect.objectContaining({ message: 'previous failed' })
      ]
    })
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
  })

  it('restores the original current release when a manual rollback fails readiness', async () => {
    const deployment = createDeployment()
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness: async () => undefined
    })
    const verifyReadiness = vi
      .fn<(releasePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('previous failed'))
      .mockResolvedValueOnce(undefined)

    await expect(
      rollbackReleaseWithReadiness({
        paths: deployment.paths,
        verifyReadiness
      })
    ).rejects.toThrow('original release was restored and verified')
    expect(
      verifyReadiness.mock.calls.map(([path]) => realpathSync(path))
    ).toEqual([
      realpathSync(deployment.legacyRelease),
      realpathSync(deployment.candidateRelease)
    ])
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.candidateRelease)
    )
  })

  it('commits a manual rollback only after the previous release passes readiness', async () => {
    const deployment = createDeployment()
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness: async () => undefined
    })
    const verifyReadiness = vi.fn(async () => undefined)

    await rollbackReleaseWithReadiness({
      paths: deployment.paths,
      verifyReadiness
    })
    expect(verifyReadiness).toHaveBeenCalledWith(
      realpathSync(deployment.legacyRelease)
    )
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
  })

  it('aggregates a failed manual rollback and failed original-release recovery', async () => {
    const deployment = createDeployment()
    await activateReleaseWithReadiness({
      ...deployment,
      verifyReadiness: async () => undefined
    })
    const verifyReadiness = vi
      .fn<(releasePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('previous failed'))
      .mockRejectedValueOnce(new Error('original failed'))

    await expect(
      rollbackReleaseWithReadiness({
        paths: deployment.paths,
        verifyReadiness
      })
    ).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'previous failed' }),
        expect.objectContaining({ message: 'original failed' })
      ]
    })
  })

  it('recovers an existing activation journal instead of starting another rollback', async () => {
    const deployment = createDeployment()
    beginCandidateActivation(deployment.paths, deployment.candidateRelease)
    const verifyReadiness = vi.fn(async () => undefined)

    await expect(
      recoverOrRollbackWithReadiness({
        paths: deployment.paths,
        verifyReadiness
      })
    ).resolves.toBe('recovered-interrupted')
    expect(verifyReadiness).toHaveBeenCalledOnce()
    expect(verifyReadiness).toHaveBeenCalledWith(
      realpathSync(deployment.legacyRelease)
    )
    expect(getCurrentDeployRelease(deployment.paths)).toBe(
      realpathSync(deployment.legacyRelease)
    )
  })
})
