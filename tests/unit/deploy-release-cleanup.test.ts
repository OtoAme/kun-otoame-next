import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDeployLock } from '~/scripts/deployLock'
import {
  cleanupDeployReleases,
  planDeployReleaseCleanup
} from '~/scripts/deployReleaseCleanup'
import { getDeploySlotPaths } from '~/scripts/deploySlots'

const roots: string[] = []
const locks: Array<() => void> = []
const releaseId = (version: number) =>
  `${'a'.repeat(40)}-v2026.11.03.${version}`

const createDeployment = () => {
  const root = mkdtempSync(join(tmpdir(), 'otoame-release-cleanup-'))
  roots.push(root)
  const paths = getDeploySlotPaths(root)
  mkdirSync(paths.releasesRoot, { recursive: true })
  const releases = [1, 2, 3, 4].map((version) => {
    const release = join(paths.releasesRoot, releaseId(version))
    mkdirSync(release)
    writeFileSync(join(release, 'server.js'), `release ${version}`)
    return release
  })
  symlinkSync(join('releases', releaseId(3)), paths.current, 'dir')
  symlinkSync(join('releases', releaseId(2)), paths.previous, 'dir')
  locks.push(acquireDeployLock(paths.deployRoot))
  return { root, paths, releases }
}

afterEach(() => {
  for (const releaseLock of locks.splice(0).reverse()) releaseLock()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('deployment release retention', () => {
  it('previews unused releases without deleting anything or relying on version order', () => {
    const { paths, releases } = createDeployment()
    const plan = planDeployReleaseCleanup(paths)
    expect(plan.retained).toEqual([releases[2], releases[1]])
    expect(plan.removable).toEqual([releases[0], releases[3]])
    expect(plan.skipped).toEqual([])
    expect(releases.every((release) => existsSync(release))).toBe(true)
  })

  it('removes only unused managed releases and remains safe to repeat', () => {
    const { paths, releases } = createDeployment()
    expect(cleanupDeployReleases(paths)).toEqual([releases[0], releases[3]])
    expect(releases.map((release) => existsSync(release))).toEqual([
      false,
      true,
      true,
      false
    ])
    expect(cleanupDeployReleases(paths)).toEqual([])
  })

  it('retains the shared current/previous release and cleans an unreferenced legacy release', () => {
    const { paths, releases } = createDeployment()
    rmSync(paths.previous)
    symlinkSync(join('releases', releaseId(3)), paths.previous, 'dir')
    const legacy = join(paths.releasesRoot, 'legacy-initial')
    mkdirSync(legacy)
    expect(planDeployReleaseCleanup(paths).retained).toEqual([releases[2]])
    expect(cleanupDeployReleases(paths)).toContain(legacy)
    expect(existsSync(releases[2])).toBe(true)
  })

  it('leaves unknown entries, symlinks and legacy backups untouched', () => {
    const { root, paths, releases } = createDeployment()
    const unknown = join(paths.releasesRoot, 'operator-backup')
    const file = join(paths.releasesRoot, releaseId(5))
    const link = join(paths.releasesRoot, releaseId(6))
    const external = join(root, 'external')
    mkdirSync(unknown)
    mkdirSync(external)
    mkdirSync(paths.legacyStandaloneBackup)
    writeFileSync(file, 'keep')
    symlinkSync(external, link, 'dir')
    symlinkSync(external, join(releases[0], 'external-link'), 'dir')
    expect(planDeployReleaseCleanup(paths).skipped).toEqual([
      file,
      link,
      unknown
    ])
    cleanupDeployReleases(paths)
    for (const path of [
      unknown,
      file,
      link,
      external,
      paths.legacyStandaloneBackup
    ]) {
      expect(existsSync(path)).toBe(true)
    }
  })

  it('requires the deployment lock before deleting releases', () => {
    const { paths, releases } = createDeployment()
    locks.pop()!()
    expect(() => cleanupDeployReleases(paths)).toThrow(/lock/i)
    expect(releases.every((release) => existsSync(release))).toBe(true)
  })

  it.each(['valid', 'corrupt', 'dangling-link'])(
    'refuses cleanup with a %s activation journal',
    (journal) => {
      const { paths, releases } = createDeployment()
      if (journal === 'dangling-link') {
        symlinkSync('missing-journal', paths.journal)
      } else {
        writeFileSync(
          paths.journal,
          journal === 'corrupt'
            ? '{'
            : JSON.stringify({
                version: 1,
                oldCurrent: join('releases', releaseId(1)),
                candidate: join('releases', releaseId(4))
              })
        )
      }
      expect(() => planDeployReleaseCleanup(paths)).toThrow(/interrupted/i)
      expect(() => cleanupDeployReleases(paths)).toThrow(/interrupted/i)
      expect(releases.every((release) => existsSync(release))).toBe(true)
    }
  )

  it.each(['missing', 'outside', 'directory', 'nested'])(
    'refuses cleanup with a %s previous pointer',
    (pointer) => {
      const { root, paths, releases } = createDeployment()
      rmSync(paths.previous)
      if (pointer === 'outside') symlinkSync(root, paths.previous, 'dir')
      if (pointer === 'directory') mkdirSync(paths.previous)
      if (pointer === 'nested') {
        const nested = join(releases[0], 'nested')
        mkdirSync(nested)
        symlinkSync(nested, paths.previous, 'dir')
      }
      expect(() => cleanupDeployReleases(paths)).toThrow()
      expect(releases.every((release) => existsSync(release))).toBe(true)
    }
  )

  it.each(['deployRoot', 'releasesRoot'] as const)(
    'rejects a symlinked %s',
    (key) => {
      const { root, paths, releases } = createDeployment()
      const moved = join(root, `moved-${key}`)
      renameSync(paths[key], moved)
      symlinkSync(moved, paths[key], 'dir')
      expect(() => planDeployReleaseCleanup(paths)).toThrow(/directory/i)
      expect(releases.every((release) => existsSync(release))).toBe(true)
    }
  )
})
