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
  assertNoPendingActivation,
  readActivationJournal
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
    expect(realpathSync(paths.current)).toBe(
      realpathSync(join(paths.releasesRoot, legacyId))
    )
    expect(realpathSync(paths.standaloneLink)).toBe(
      realpathSync(join(paths.releasesRoot, legacyId))
    )
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

  it('retains an interrupted activation without changing pointers or forgetting the candidate', () => {
    const { root, paths } = createProject()
    const candidate = join(root, 'candidate')
    createRelease(candidate, 'candidate')
    const installed = installCandidateRelease(paths, candidate, candidateId)
    beginCandidateActivation(paths, installed)
    const journal = readFileSync(paths.journal, 'utf8')
    expect(() => assertNoPendingActivation(paths)).toThrow('Unresolved')
    expect(() => beginCandidateActivation(paths, installed)).toThrow(
      'Unresolved'
    )
    expect(readFileSync(paths.journal, 'utf8')).toBe(journal)
    expect(getCurrentDeployRelease(paths)).toBe(
      realpathSync(join(paths.releasesRoot, legacyId))
    )
    expect(existsSync(installed)).toBe(true)
  })

  it('recognizes version 1 journals and refuses unknown or damaged records without deleting them', () => {
    const { paths } = createProject()
    adoptLegacyDeploySlot(paths)
    const journal = {
      version: 1,
      oldCurrent: 'releases/legacy-initial',
      candidate: 'releases/legacy-initial'
    }
    writeFileSync(paths.journal, JSON.stringify(journal))
    expect(readActivationJournal(paths)).toEqual(journal)
    for (const value of ['{', JSON.stringify({ ...journal, version: 9 })]) {
      writeFileSync(paths.journal, value)
      expect(() => readActivationJournal(paths)).toThrow()
      expect(() => assertNoPendingActivation(paths)).toThrow('Unresolved')
      expect(readFileSync(paths.journal, 'utf8')).toBe(value)
    }
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
