import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireDeployLock } from '~/scripts/deployLock'
import { runDeployRecovery } from '~/scripts/deployRecovery'
import {
  getDeploySlotPaths,
  readActivationJournal
} from '~/scripts/deploySlots'

const roots: string[] = []
const currentId = `${'a'.repeat(40)}-current`
const targetId = `${'b'.repeat(40)}-target`
const createRelease = (path: string, releaseId: string) => {
  for (const directory of [
    '.next/server',
    '.next/static',
    'public',
    'server/image',
    'posts',
    'prisma/schema',
    'node_modules/.prisma/client',
    'node_modules/@prisma/client',
    'node_modules/next',
    'node_modules/react',
    'node_modules/react-dom',
    'node_modules/ffmpeg-static',
    'config'
  ])
    mkdirSync(join(path, directory), { recursive: true })
  for (const file of [
    'server.mjs',
    '.next/BUILD_ID',
    'config/redirect.json',
    'package.json',
    'node_modules/react/package.json',
    'node_modules/react-dom/package.json'
  ])
    writeFileSync(join(path, file), '{}')
  if (releaseId !== 'legacy-initial')
    writeFileSync(
      join(path, 'release-manifest.json'),
      JSON.stringify({
        version: 1,
        commitSha: releaseId.slice(0, 40),
        tag: releaseId.slice(41)
      })
    )
}
const createDeployment = () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'otoame-explicit-recovery-'))
  roots.push(projectRoot)
  const paths = getDeploySlotPaths(projectRoot)
  for (const releaseId of [currentId, targetId, 'legacy-initial'])
    createRelease(join(paths.releasesRoot, releaseId), releaseId)
  symlinkSync(join('releases', currentId), paths.current, 'dir')
  symlinkSync(join('releases', targetId), paths.previous, 'dir')
  writeFileSync(
    paths.journal,
    JSON.stringify({
      version: 1,
      oldCurrent: `releases/${currentId}`,
      candidate: `releases/${targetId}`
    })
  )
  const activate = vi.fn(async () => undefined)
  const prepare = vi.fn()
  const log = vi.fn()
  const ask = vi.fn(async () => null as string | null)
  return {
    projectRoot,
    paths,
    activate,
    prepare,
    log,
    ask,
    isTTY: true,
    args: [] as string[]
  }
}
const snapshot = (root: string): string =>
  JSON.stringify(
    readdirSync(root, { recursive: true })
      .sort()
      .map((entry) => {
        const path = join(root, String(entry))
        const stat = lstatSync(path)
        return [
          entry,
          stat.isFile()
            ? readFileSync(path, 'utf8')
            : stat.isSymbolicLink()
              ? 'link'
              : 'dir'
        ]
      })
  )
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('explicit managed release recovery', () => {
  it.each([['--list'], ['--preview', targetId]])(
    'makes %j read-only and shows real manifest identities',
    async (...args) => {
      const deployment = createDeployment()
      const before = snapshot(deployment.projectRoot)
      await runDeployRecovery({ ...deployment, args, isTTY: false })
      expect(snapshot(deployment.projectRoot)).toBe(before)
      expect(deployment.log.mock.calls.flat().join('\n')).toContain(
        `tag=target; commit=${'b'.repeat(40)}`
      )
      expect(deployment.prepare).not.toHaveBeenCalled()
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it.each([null, '', 'invalid'])(
    'cancels on confirmation %s without persistent state changes',
    async (answer) => {
      const deployment = createDeployment()
      const before = snapshot(deployment.projectRoot)
      deployment.ask
        .mockResolvedValueOnce(targetId)
        .mockResolvedValueOnce(answer)
      await expect(runDeployRecovery(deployment)).resolves.toBe('cancelled')
      expect(snapshot(deployment.projectRoot)).toBe(before)
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it('cancels selection on EOF without startup', async () => {
    const deployment = createDeployment()
    await expect(runDeployRecovery(deployment)).resolves.toBe('cancelled')
    expect(deployment.activate).not.toHaveBeenCalled()
  })

  it('requires a TTY or concrete matching execution arguments', async () => {
    const deployment = createDeployment()
    await expect(
      runDeployRecovery({ ...deployment, isTTY: false })
    ).rejects.toThrow('requires a TTY')
    for (const args of [
      ['--yes'],
      ['--release', targetId],
      ['--release', targetId, '--confirm', currentId]
    ])
      await expect(
        runDeployRecovery({ ...deployment, args, isTTY: false })
      ).rejects.toThrow('No default target')
    expect(deployment.activate).not.toHaveBeenCalled()
    await runDeployRecovery({
      ...deployment,
      isTTY: false,
      args: ['--release', targetId, '--confirm', targetId]
    })
    expect(deployment.activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        candidateRelease: join(deployment.paths.releasesRoot, targetId),
        explicitRecovery: true
      })
    )
  })

  it.each(['../outside', '/tmp/outside', 'current', 'previous'])(
    'refuses unbound or escaping target %s',
    async (releaseId) => {
      const deployment = createDeployment()
      await expect(
        runDeployRecovery({ ...deployment, args: ['--preview', releaseId] })
      ).rejects.toThrow('managed release ID')
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it('rejects release directory symlinks and manifest or runtime mismatches', async () => {
    const deployment = createDeployment()
    const target = join(deployment.paths.releasesRoot, targetId)
    renameSync(target, join(deployment.projectRoot, 'outside'))
    symlinkSync(join(deployment.projectRoot, 'outside'), target, 'dir')
    await expect(
      runDeployRecovery({ ...deployment, args: ['--preview', targetId] })
    ).rejects.toThrow('not a directory')
    rmSync(target)
    renameSync(join(deployment.projectRoot, 'outside'), target)
    writeFileSync(
      join(target, 'release-manifest.json'),
      JSON.stringify({ version: 1, tag: 'other', commitSha: 'b'.repeat(40) })
    )
    await expect(
      runDeployRecovery({ ...deployment, args: ['--preview', targetId] })
    ).rejects.toThrow('does not match')
    expect(deployment.activate).not.toHaveBeenCalled()
  })

  it.each(['directory', 'manifest', 'pointer', 'runtime'])(
    'rejects a %s change during confirmation while holding the deployment lock',
    async (change) => {
      const deployment = createDeployment()
      const target = join(deployment.paths.releasesRoot, targetId)
      deployment.ask
        .mockResolvedValueOnce(targetId)
        .mockImplementationOnce(async () => {
          expect(() => acquireDeployLock(deployment.paths.deployRoot)).toThrow(
            'Another deployment'
          )
          if (change === 'directory') {
            renameSync(target, `${target}-saved`)
            createRelease(target, targetId)
          }
          if (change === 'manifest')
            writeFileSync(
              join(target, 'release-manifest.json'),
              JSON.stringify({
                version: 1,
                commitSha: 'b'.repeat(40),
                tag: 'target'
              }) + '\n'
            )
          if (change === 'runtime')
            writeFileSync(join(target, 'server.mjs'), 'modified')
          if (change === 'pointer') {
            rmSync(deployment.paths.current)
            symlinkSync(
              join('releases', targetId),
              deployment.paths.current,
              'dir'
            )
          }
          return targetId
        })
      await expect(runDeployRecovery(deployment)).rejects.toThrow(
        'changed during confirmation'
      )
      expect(deployment.activate).not.toHaveBeenCalled()
      expect(
        existsSync(join(deployment.paths.deployRoot, 'operation.lock'))
      ).toBe(false)
    }
  )

  it('labels legacy provenance as unknown and permits only an explicitly confirmed selection', async () => {
    const deployment = createDeployment()
    deployment.ask
      .mockResolvedValueOnce('legacy-initial')
      .mockResolvedValueOnce('legacy-initial')
    await runDeployRecovery(deployment)
    expect(deployment.log.mock.calls.flat().join('\n')).toContain(
      'unknown (legacy source; operator verification required)'
    )
    expect(deployment.activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        candidateRelease: join(deployment.paths.releasesRoot, 'legacy-initial')
      })
    )
    expect(readActivationJournal(deployment.paths)?.version).toBe(1)
  })

  it('does not activate a release with an unreadable or unknown journal', async () => {
    const deployment = createDeployment()
    writeFileSync(deployment.paths.journal, '{')
    await expect(
      runDeployRecovery({
        ...deployment,
        args: ['--release', targetId, '--confirm', targetId]
      })
    ).rejects.toThrow()
    expect(readFileSync(deployment.paths.journal, 'utf8')).toBe('{')
    expect(deployment.activate).not.toHaveBeenCalled()
  })
  it('refuses a symlink deployment root before writing a lock outside the managed root', async () => {
    const deployment = createDeployment()
    const moved = join(deployment.projectRoot, 'outside-deploy')
    renameSync(deployment.paths.deployRoot, moved)
    symlinkSync(moved, deployment.paths.deployRoot, 'dir')
    await expect(
      runDeployRecovery({ ...deployment, args: ['--list'] })
    ).rejects.toThrow('lock root must be a real directory')
    expect(existsSync(join(moved, 'operation.lock'))).toBe(false)
  })
})
