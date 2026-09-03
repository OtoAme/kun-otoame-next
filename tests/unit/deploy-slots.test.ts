import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginCandidateActivation,
  completeCandidateActivation,
  adoptLegacyDeploySlot,
  getCurrentDeployRelease,
  getDeploySlotPaths,
  installCandidateRelease,
  recoverInterruptedActivation,
  rollbackDeploySlots
} from '~/scripts/deploySlots'

const roots: string[] = []
const legacyId = 'legacy-initial'
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

const createProject = () => {
  const root = mkdtempSync(join(tmpdir(), 'otoame-deploy-slots-'))
  roots.push(root)
  const paths = getDeploySlotPaths(root)
  createRelease(paths.legacyStandalone, 'legacy')
  mkdirSync(join(root, 'prisma/schema'), { recursive: true })
  writeFileSync(join(root, 'prisma/schema/schema.prisma'), 'source-head')
  mkdirSync(join(root, 'node_modules/.prisma/client'), { recursive: true })
  mkdirSync(join(root, 'node_modules/@prisma/client'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.prisma/marker'), 'source-client')
  writeFileSync(join(root, 'node_modules/@prisma/marker'), 'legacy')
  return { root, paths }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('crash-safe immutable deployment slots', () => {
  it('keeps durable releases outside Next cleanDistDir and recreates the compatibility link', () => {
    const { root, paths } = createProject()
    const adopted = adoptLegacyDeploySlot(paths)

    expect(paths.deployRoot).toBe(join(realpathSync(root), '.deploy'))
    expect(paths.deployRoot.startsWith(join(root, '.next'))).toBe(false)
    rmSync(join(root, '.next'), { recursive: true, force: true })

    expect(adoptLegacyDeploySlot(paths)).toBe(adopted)
    expect(realpathSync(paths.current)).toBe(adopted)
    expect(realpathSync(paths.standaloneLink)).toBe(adopted)
  })

  it('keeps previous on the known-good release until readiness completes', () => {
    const { root, paths } = createProject()
    const candidate = join(root, 'candidate')
    createRelease(candidate, 'candidate')
    const installed = installCandidateRelease(paths, candidate, candidateId)

    const activation = beginCandidateActivation(paths, installed)
    expect(realpathSync(paths.current)).toBe(realpathSync(installed))
    expect(realpathSync(paths.standaloneLink)).toBe(realpathSync(installed))
    expect(realpathSync(paths.previous)).toBe(
      realpathSync(join(paths.releasesRoot, legacyId))
    )
    expect(activation.oldCurrent).toBe(realpathSync(paths.previous))
    expect(existsSync(paths.journal)).toBe(true)
    expect(
      readFileSync(join(paths.rootPrisma, 'schema/schema.prisma'), 'utf8')
    ).toBe('source-head')

    completeCandidateActivation(paths)
    expect(existsSync(paths.journal)).toBe(false)
    expect(existsSync(join(paths.releasesRoot, legacyId))).toBe(true)
    expect(existsSync(join(paths.releasesRoot, candidateId))).toBe(true)
  })

  it('recovers an interrupted activation to the known-good release', () => {
    const { root, paths } = createProject()
    const candidate = join(root, 'candidate')
    createRelease(candidate, 'candidate')
    const installed = installCandidateRelease(paths, candidate, candidateId)
    beginCandidateActivation(paths, installed)

    const recovered = recoverInterruptedActivation(paths)
    expect(recovered).toBe(realpathSync(join(paths.releasesRoot, legacyId)))
    expect(getCurrentDeployRelease(paths)).toBe(recovered)
    expect(realpathSync(paths.standaloneLink)).toBe(recovered)
    expect(realpathSync(paths.previous)).toBe(recovered)
    expect(
      readFileSync(join(paths.rootPrisma, 'schema/schema.prisma'), 'utf8')
    ).toBe('source-head')
    expect(
      readFileSync(join(paths.rootNodeModules, '.prisma/marker'), 'utf8')
    ).toBe('source-client')
    expect(existsSync(join(paths.releasesRoot, candidateId))).toBe(true)
  })

  it('performs idempotent offline rollback without pointing back to the rejected release', () => {
    const { root, paths } = createProject()
    const candidate = join(root, 'candidate')
    createRelease(candidate, 'candidate')
    const installed = installCandidateRelease(paths, candidate, candidateId)
    beginCandidateActivation(paths, installed)
    completeCandidateActivation(paths)

    const first = rollbackDeploySlots(paths)
    const second = rollbackDeploySlots(paths)
    expect(first).toBe(realpathSync(join(paths.releasesRoot, legacyId)))
    expect(second).toBe(first)
    expect(getCurrentDeployRelease(paths)).toBe(first)
    expect(realpathSync(paths.previous)).toBe(first)
    expect(existsSync(join(paths.releasesRoot, candidateId))).toBe(true)
  })

  it('adopts a pnpm-linked legacy standalone and atomically replaces its public path with current', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-deploy-slots-'))
    roots.push(root)
    const paths = getDeploySlotPaths(root)
    const storeNodeModules = join(
      paths.legacyStandalone,
      'node_modules/.pnpm/prisma-client/node_modules'
    )
    mkdirSync(join(storeNodeModules, '@prisma/client'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    mkdirSync(join(paths.legacyStandalone, 'node_modules/@prisma'), {
      recursive: true
    })
    symlinkSync(
      relative(
        join(paths.legacyStandalone, 'node_modules/@prisma'),
        join(storeNodeModules, '@prisma/client')
      ),
      join(paths.legacyStandalone, 'node_modules/@prisma/client'),
      'dir'
    )
    mkdirSync(join(root, 'prisma/schema'), { recursive: true })
    writeFileSync(join(root, 'prisma/schema/schema.prisma'), 'legacy')

    const adopted = adoptLegacyDeploySlot(paths)
    expect(existsSync(join(adopted, 'node_modules/.prisma/client'))).toBe(true)
    expect(realpathSync(paths.standaloneLink)).toBe(adopted)
    expect(existsSync(paths.legacyStandaloneBackup)).toBe(true)
    expect(readlinkSync(join(adopted, 'node_modules/@prisma/client'))).toBe(
      '../.pnpm/prisma-client/node_modules/@prisma/client'
    )
  })

  it('rewrites absolute legacy links left by earlier adoptions into the release', () => {
    const { paths } = createProject()
    const adopted = adoptLegacyDeploySlot(paths)
    const storeReactDom = join(
      adopted,
      'node_modules/.pnpm/react-dom/node_modules/react-dom'
    )
    mkdirSync(storeReactDom, { recursive: true })
    const linkPath = join(adopted, 'node_modules/react-dom')
    symlinkSync(
      join(
        paths.legacyStandalone,
        'node_modules/.pnpm/react-dom/node_modules/react-dom'
      ),
      linkPath,
      'dir'
    )

    expect(adoptLegacyDeploySlot(paths)).toBe(adopted)
    expect(readlinkSync(linkPath)).toBe(
      '.pnpm/react-dom/node_modules/react-dom'
    )
    expect(realpathSync(linkPath)).toBe(realpathSync(storeReactDom))
  })

  it('fails closed when an absolute legacy link has no target inside the release', () => {
    const { paths } = createProject()
    const adopted = adoptLegacyDeploySlot(paths)
    symlinkSync(
      join(
        paths.legacyStandaloneBackup,
        'node_modules/.pnpm/missing@1.0.0/node_modules/missing'
      ),
      join(adopted, 'node_modules/missing'),
      'dir'
    )

    expect(() => adoptLegacyDeploySlot(paths)).toThrow(
      'Legacy release link target is missing inside the release: node_modules/missing'
    )
  })
})
