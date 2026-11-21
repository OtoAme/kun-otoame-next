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
  const ask = vi.fn(async (_prompt: string) => null as string | null)
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
      const output = deployment.log.mock.calls.flat().join('\n')
      expect(output).toContain('标签：target')
      expect(output).toContain('提交：bbbbbbbb')
      if (args[0] === '--preview') {
        expect(output).toContain(targetId)
        expect(output).toContain(join(deployment.paths.releasesRoot, targetId))
      } else {
        expect(output).not.toContain(targetId)
        expect(output).not.toContain(deployment.paths.releasesRoot)
      }
      expect(deployment.prepare).not.toHaveBeenCalled()
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it('shows a plain Chinese numbered menu with failure, successful and earlier release roles', async () => {
    const deployment = createDeployment()
    rmSync(deployment.paths.previous)
    symlinkSync('releases/legacy-initial', deployment.paths.previous, 'dir')
    writeFileSync(
      deployment.paths.journal,
      JSON.stringify({
        version: 2,
        oldCurrent: `releases/${currentId}`,
        candidate: `releases/${targetId}`,
        failure: {
          message: 'Synthetic repeated diagnostic\nSynthetic repeated diagnostic',
          stopConfirmed: true
        }
      })
    )
    const before = snapshot(deployment.projectRoot)
    await runDeployRecovery({ ...deployment, args: ['--list'], isTTY: false })
    const output = deployment.log.mock.calls.flat().join('\n')

    expect(output).toContain('1. 本次失败版本（可重试）')
    expect(output).toContain('2. 最近成功版本（指针不等于在线）')
    expect(output).toContain('3. 更早版本')
    expect(output).toContain('标签：target | 提交：bbbbbbbb')
    expect(output).toContain('候选进程：已确认停止')
    expect(output).toContain('.deploy/activation-journal.json')
    expect(output).not.toContain('Synthetic repeated diagnostic')
    expect(output).not.toContain(targetId)
    expect(output).not.toContain(deployment.paths.releasesRoot)
    expect(output).not.toContain('\u001b[')
    expect(output.match(/下一步：/g)).toHaveLength(1)
    expect(snapshot(deployment.projectRoot)).toBe(before)
    expect(deployment.activate).not.toHaveBeenCalled()
  })

  it('previews a numbered choice without loading configuration or starting a release', async () => {
    const deployment = createDeployment()
    const before = snapshot(deployment.projectRoot)
    await expect(
      runDeployRecovery({ ...deployment, args: ['--preview', '1'], isTTY: false })
    ).resolves.toBe('previewed')
    const output = deployment.log.mock.calls.flat().join('\n')
    expect(output).toContain(targetId)
    expect(output).toContain(join(deployment.paths.releasesRoot, targetId))
    expect(snapshot(deployment.projectRoot)).toBe(before)
    expect(deployment.prepare).not.toHaveBeenCalled()
    expect(deployment.activate).not.toHaveBeenCalled()
  })

  it('uses the original journal release for the last successful role when current points to an unverified candidate', async () => {
    const deployment = createDeployment()
    rmSync(deployment.paths.current)
    symlinkSync(join('releases', targetId), deployment.paths.current, 'dir')
    const before = snapshot(deployment.projectRoot)
    await runDeployRecovery({ ...deployment, args: ['--list'] })
    const output = deployment.log.mock.calls.flat().join('\n')
    expect(output).toContain(
      '1. 本次未决版本（可重试）\n   标签：target | 提交：bbbbbbbb'
    )
    expect(output).toContain(
      '2. 最近成功版本（指针不等于在线）\n   标签：current | 提交：aaaaaaaa'
    )
    expect(snapshot(deployment.projectRoot)).toBe(before)
    expect(deployment.activate).not.toHaveBeenCalled()
  })

  it('binds a numbered selection to its full release ID and confirms with y under the lock', async () => {
    const deployment = createDeployment()
    deployment.ask
      .mockImplementationOnce(async (prompt) => {
        expect(prompt).toContain('编号')
        return '1'
      })
      .mockImplementationOnce(async (prompt) => {
        expect(prompt).toContain('y')
        expect(() => acquireDeployLock(deployment.paths.deployRoot)).toThrow(
          'Another deployment'
        )
        const output = deployment.log.mock.calls.flat().join('\n')
        expect(output).toContain('标签：target | 提交：bbbbbbbb')
        expect(output).toContain('本次未决版本（可重试）')
        expect(output).toContain(targetId)
        return 'y'
      })
    await expect(runDeployRecovery(deployment)).resolves.toBe('recovered')
    expect(deployment.activate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        candidateRelease: join(deployment.paths.releasesRoot, targetId),
        explicitRecovery: true
      })
    )
    expect(deployment.prepare).toHaveBeenCalledOnce()
    expect(existsSync(join(deployment.paths.deployRoot, 'operation.lock'))).toBe(
      false
    )
  })

  it.each(['0', '-1', '4', '1.5', '1abc', targetId])(
    'cancels an invalid menu choice %s without preparing or starting a release',
    async (choice) => {
      const deployment = createDeployment()
      const before = snapshot(deployment.projectRoot)
      deployment.ask.mockResolvedValueOnce(choice)
      await expect(runDeployRecovery(deployment)).resolves.toBe('cancelled')
      expect(deployment.ask).toHaveBeenCalledOnce()
      expect(deployment.log.mock.calls.flat().join('\n')).toContain('编号无效')
      expect(snapshot(deployment.projectRoot)).toBe(before)
      expect(deployment.prepare).not.toHaveBeenCalled()
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it.each([null, '', 'invalid', 'yes', targetId])(
    'cancels on confirmation %s without persistent state changes',
    async (answer) => {
      const deployment = createDeployment()
      const before = snapshot(deployment.projectRoot)
      deployment.ask
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce(answer)
      await expect(runDeployRecovery(deployment)).resolves.toBe('cancelled')
      expect(snapshot(deployment.projectRoot)).toBe(before)
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it.each([null, '', '   '])(
    'cancels an empty or interrupted selection %s without startup',
    async (answer) => {
      const deployment = createDeployment()
      const before = snapshot(deployment.projectRoot)
      deployment.ask.mockResolvedValueOnce(answer)
      await expect(runDeployRecovery(deployment)).resolves.toBe('cancelled')
      expect(deployment.ask).toHaveBeenCalledOnce()
      expect(snapshot(deployment.projectRoot)).toBe(before)
      expect(deployment.prepare).not.toHaveBeenCalled()
      expect(deployment.activate).not.toHaveBeenCalled()
    }
  )

  it('keeps non-TTY execution bound to a full release ID rather than a menu number', async () => {
    const deployment = createDeployment()
    await expect(
      runDeployRecovery({
        ...deployment,
        isTTY: false,
        args: ['--release', '1', '--confirm', '1']
      })
    ).rejects.toThrow('managed release ID')
    expect(deployment.prepare).not.toHaveBeenCalled()
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
        .mockResolvedValueOnce('1')
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
          return 'y'
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
      .mockResolvedValueOnce('3')
      .mockResolvedValueOnce('y')
    await runDeployRecovery(deployment)
    expect(deployment.log.mock.calls.flat().join('\n')).toContain(
      '未知（历史运行目录；需人工核对来源）'
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
