import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  restartAndVerifyProduction,
  validateStandaloneRuntime
} from '~/scripts/deployPm2'

const roots: string[] = []

const createRuntime = () => {
  const root = mkdtempSync(join(tmpdir(), 'otoame-pm2-runtime-'))
  roots.push(root)
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
  ]) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  for (const file of [
    'server.mjs',
    '.next/BUILD_ID',
    'config/redirect.json',
    'package.json'
  ]) {
    writeFileSync(join(root, file), 'ok')
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const successResult = { status: 0, stdout: '', stderr: '' }
const onlineProcesses = (runtime: string) =>
  JSON.stringify(
    Array.from({ length: 3 }, () => ({
      name: 'kun-touchgal-next',
      pm2_env: {
        status: 'online',
        pm_cwd: runtime,
        pm_exec_path: join(runtime, 'server.mjs')
      }
    }))
  )

describe('PM2 deployment readiness', () => {
  it('accepts package links that remain inside the standalone release', () => {
    const runtime = createRuntime()
    const packagePath = join(runtime, 'node_modules/next')
    const internalPackage = join(
      runtime,
      'node_modules/.pnpm/next@15.5.18/node_modules/next'
    )
    rmSync(packagePath, { recursive: true, force: true })
    mkdirSync(internalPackage, { recursive: true })
    symlinkSync('.pnpm/next@15.5.18/node_modules/next', packagePath, 'dir')

    expect(validateStandaloneRuntime(runtime)).toBe('server.mjs')
  })

  it('rejects package links that escape the standalone release', () => {
    const runtime = createRuntime()
    const externalRuntime = createRuntime()
    const packagePath = join(runtime, 'node_modules/next')
    rmSync(packagePath, { recursive: true, force: true })
    symlinkSync(join(externalRuntime, 'node_modules/next'), packagePath, 'dir')

    expect(() => validateStandaloneRuntime(runtime)).toThrow(
      'symbolic link escapes the release: node_modules/next'
    )
  })

  it('rejects broken package links in the standalone release', () => {
    const runtime = createRuntime()
    const packagePath = join(runtime, 'node_modules/next')
    rmSync(packagePath, { recursive: true, force: true })
    symlinkSync('.pnpm/missing/node_modules/next', packagePath, 'dir')

    expect(() => validateStandaloneRuntime(runtime)).toThrow(
      'broken symbolic link: node_modules/next'
    )
  })

  it('preflights the complete runtime before touching PM2', async () => {
    const runtime = createRuntime()
    rmSync(join(runtime, 'node_modules/.prisma'), {
      recursive: true,
      force: true
    })
    const run = vi.fn(() => successResult)

    expect(() => validateStandaloneRuntime(runtime)).toThrow(
      'node_modules/.prisma'
    )
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: {
          run,
          smoke: vi.fn(),
          sleep: vi.fn(),
          now: () => 0
        }
      })
    ).rejects.toThrow('node_modules/.prisma')
    expect(run).not.toHaveBeenCalled()
  })

  it('only tolerates the explicit PM2 process-not-found deletion result', async () => {
    const runtime = createRuntime()
    const run = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: '[PM2][ERROR] permission denied'
    }))

    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: {
          run,
          smoke: vi.fn(),
          sleep: vi.fn(),
          now: () => 0
        }
      })
    ).rejects.toThrow('permission denied')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('waits for PM2 online and a successful loopback HTTP smoke', async () => {
    const runtime = createRuntime()
    const run = vi.fn((_command: string, args: string[]) => {
      if (args[0] === 'delete') {
        return {
          status: 1,
          stdout: '',
          stderr:
            '[PM2][ERROR] Process or Namespace kun-touchgal-next not found'
        }
      }
      if (args[0] === 'jlist') {
        return {
          status: 0,
          stdout: onlineProcesses(runtime),
          stderr: ''
        }
      }
      return successResult
    })
    const smoke = vi.fn(async () => 200)

    await restartAndVerifyProduction({
      standaloneDir: runtime,
      dependencies: {
        run,
        smoke,
        sleep: vi.fn(async () => undefined),
        now: () => 0
      }
    })

    expect(run.mock.calls.map(([, args]) => args[0])).toEqual([
      'delete',
      'start',
      'jlist'
    ])
    expect(smoke).toHaveBeenCalledOnce()
  })

  it('does not accept online PM2 workers from a different release', async () => {
    const runtime = createRuntime()
    let now = 0
    const wrongRuntime = createRuntime()
    const run = vi.fn((_command: string, args: string[]) =>
      args[0] === 'jlist'
        ? {
            status: 0,
            stdout: onlineProcesses(wrongRuntime),
            stderr: ''
          }
        : successResult
    )
    const smoke = vi.fn(async () => 200)

    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        env: {
          NODE_ENV: 'production',
          KUN_DEPLOY_READINESS_TIMEOUT_MS: '5000'
        },
        dependencies: {
          run,
          smoke,
          sleep: vi.fn(async (milliseconds: number) => {
            now += milliseconds
          }),
          now: () => now
        }
      })
    ).rejects.toThrow('readiness timed out')
    expect(smoke).not.toHaveBeenCalled()
  })

  it('fails within the configured deadline when smoke never succeeds', async () => {
    const runtime = createRuntime()
    let now = 0
    const run = vi.fn((_command: string, args: string[]) =>
      args[0] === 'jlist'
        ? {
            status: 0,
            stdout: onlineProcesses(runtime),
            stderr: ''
          }
        : successResult
    )

    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        env: {
          NODE_ENV: 'production',
          KUN_DEPLOY_READINESS_TIMEOUT_MS: '5000'
        },
        dependencies: {
          run,
          smoke: vi.fn(async () => 503),
          sleep: vi.fn(async (milliseconds: number) => {
            now += milliseconds
          }),
          now: () => now
        }
      })
    ).rejects.toThrow('readiness timed out')
    expect(now).toBe(5000)
  })

  it('rejects non-loopback smoke URLs before deleting PM2', async () => {
    const runtime = createRuntime()
    const run = vi.fn(() => successResult)
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        env: {
          NODE_ENV: 'production',
          KUN_DEPLOY_SMOKE_URL: 'https://example.com/'
        },
        dependencies: {
          run,
          smoke: vi.fn(),
          sleep: vi.fn(),
          now: () => 0
        }
      })
    ).rejects.toThrow('loopback')
    expect(run).not.toHaveBeenCalled()
  })
})
