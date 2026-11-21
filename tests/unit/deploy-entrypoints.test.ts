import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readlinkSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDeploySlotPaths } from '~/scripts/deploySlots'
import { acquireDeployLock } from '~/scripts/deployLock'

const roots: string[] = []
const originalArgv = process.argv
const originalExitCode = process.exitCode

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('automatic deployment rejects unresolved activation before any external command', () => {
  describe.each(['damaged', 'legacy-v1-switched'])(
    '%s journal',
    (journalState) => {
      it.each([
        ['deployPullLauncher', []],
        ['deployPullLauncher', ['--pinned']],
        ['deployPull', []],
        ['deployPull', ['--pinned']],
        ['deployBuild', []],
        ['deployBuild', ['--lock-held']],
        ['deployPull', ['--pinned', '--lock-held']]
      ] as const)(
        '%s %j leaves the journal intact with zero process or mutation commands',
        async (entry, args) => {
          vi.resetModules()
          const root = mkdtempSync(join(tmpdir(), 'otoame-pending-entry-'))
          roots.push(root)
          const paths = getDeploySlotPaths(root)
          mkdirSync(paths.deployRoot, { recursive: true })
          const journal =
            journalState === 'damaged'
              ? '{unresolved'
              : JSON.stringify({
                  version: 1,
                  oldCurrent: 'releases/legacy-initial',
                  candidate: `releases/${'b'.repeat(40)}-failed`
                })
          writeFileSync(paths.journal, journal)
          if (journalState === 'legacy-v1-switched') {
            mkdirSync(join(paths.releasesRoot, 'legacy-initial'), {
              recursive: true
            })
            mkdirSync(join(paths.releasesRoot, `${'b'.repeat(40)}-failed`), {
              recursive: true
            })
            writeFileSync(
              join(
                paths.releasesRoot,
                `${'b'.repeat(40)}-failed`,
                'release-manifest.json'
              ),
              JSON.stringify({
                version: 1,
                tag: 'failed',
                commitSha: 'b'.repeat(40)
              })
            )
            symlinkSync(
              `releases/${'b'.repeat(40)}-failed`,
              paths.current,
              'dir'
            )
            symlinkSync('releases/legacy-initial', paths.previous, 'dir')
          }
          const command = vi.fn(() => {
            throw new Error('No external command is allowed')
          })
          const startup = vi.fn(async () => {
            throw new Error('No process start is allowed')
          })
          const preflight = vi.fn(() => {
            throw new Error('No release adoption or validation is allowed')
          })
          const errors = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined)
          vi.doMock('dotenv', () => ({ config: vi.fn() }))
          vi.doMock('~/validations/dotenv-check', () => ({
            envSchema: { safeParse: () => ({ success: true }) }
          }))
          vi.doMock('~/scripts/deployProcess', () => ({
            assertCleanDeployWorktree: command,
            runDeployCommand: command,
            readDeployCommand: command
          }))
          vi.doMock('~/scripts/deployPm2', () => ({
            restartAndVerifyProduction: startup,
            validateStandaloneRuntime: preflight
          }))
          vi.doMock('~/scripts/deploySlots', async () => ({
            ...(await vi.importActual<typeof import('~/scripts/deploySlots')>(
              '~/scripts/deploySlots'
            )),
            getDeploySlotPaths: () => paths
          }))
          vi.stubEnv('GITHUB_REPO', 'sample/unused')
          process.argv = ['node', entry, ...args]
          let unlock: (() => void) | undefined
          if (args.includes('--lock-held' as never)) {
            unlock = acquireDeployLock(paths.deployRoot)
            vi.stubEnv('KUN_DEPLOY_LOCK_OWNER_PID', String(process.pid))
          }
          try {
            try {
              await import(`../../scripts/${entry}.ts`)
            } catch (error) {
              expect(String(error)).toContain(
                'Unresolved deployment activation'
              )
            }
            await new Promise((resolve) => setImmediate(resolve))
            expect(errors.mock.calls.flat().map(String).join('\n')).toContain(
              entry === 'deployPullLauncher'
                ? 'Deployment state'
                : 'Unresolved deployment activation'
            )
            expect(command).not.toHaveBeenCalled()
            expect(startup).not.toHaveBeenCalled()
            expect(readFileSync(paths.journal, 'utf8')).toBe(journal)
            if (journalState === 'legacy-v1-switched')
              expect(readlinkSync(paths.current)).toBe(
                `releases/${'b'.repeat(40)}-failed`
              )
          } finally {
            unlock?.()
          }
          expect(existsSync(join(paths.deployRoot, 'operation.lock'))).toBe(
            false
          )
        }
      )
    }
  )
})
