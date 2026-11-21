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

const createRuntime = (
  root = mkdtempSync(join(tmpdir(), 'otoame-pm2-runtime-'))
) => {
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
  for (const peer of ['react', 'react-dom']) {
    writeFileSync(join(root, `node_modules/${peer}/package.json`), '{}')
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

  it('accepts React peers linked beside next in the pnpm store', () => {
    const runtime = createRuntime()
    rmSync(join(runtime, 'node_modules/react-dom'), {
      recursive: true,
      force: true
    })
    const nextLink = join(runtime, 'node_modules/next')
    rmSync(nextLink, { recursive: true, force: true })
    const storeNodeModules = join(
      runtime,
      'node_modules/.pnpm/next@15.5.18/node_modules'
    )
    const storeReactDom = join(
      runtime,
      'node_modules/.pnpm/react-dom@19.2.4/node_modules/react-dom'
    )
    mkdirSync(join(storeNodeModules, 'next'), { recursive: true })
    mkdirSync(storeReactDom, { recursive: true })
    writeFileSync(join(storeReactDom, 'package.json'), '{}')
    symlinkSync(
      '../../react-dom@19.2.4/node_modules/react-dom',
      join(storeNodeModules, 'react-dom'),
      'dir'
    )
    symlinkSync('.pnpm/next@15.5.18/node_modules/next', nextLink, 'dir')

    expect(validateStandaloneRuntime(runtime)).toBe('server.mjs')
  })

  it('rejects a release whose next cannot resolve react-dom', () => {
    const runtime = createRuntime()
    rmSync(join(runtime, 'node_modules/react-dom'), {
      recursive: true,
      force: true
    })

    expect(() => validateStandaloneRuntime(runtime)).toThrow(
      'cannot resolve react-dom/package.json from node_modules/next'
    )
  })

  it('rejects React peers that resolve outside the release', () => {
    const outer = mkdtempSync(join(tmpdir(), 'otoame-pm2-outer-'))
    roots.push(outer)
    mkdirSync(join(outer, 'node_modules/react-dom'), { recursive: true })
    writeFileSync(join(outer, 'node_modules/react-dom/package.json'), '{}')
    const runtime = createRuntime(join(outer, 'runtime'))
    rmSync(join(runtime, 'node_modules/react-dom'), {
      recursive: true,
      force: true
    })

    expect(() => validateStandaloneRuntime(runtime)).toThrow(
      'resolves react-dom/package.json outside the release'
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

  it('waits for exactly three owned online instances and loopback HTTP', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime)
    await restartAndVerifyProduction({
      standaloneDir: runtime,
      dependencies: harness.dependencies
    })
    expect(
      harness.processes.filter((entry) => entry.pm2_env.status === 'online')
    ).toHaveLength(3)
    expect(harness.dependencies.smoke).toHaveBeenCalledOnce()
    expect(harness.calls.filter((args) => args[0] === 'start')).toHaveLength(1)
  })

  it.each(['partial-start', 'http-failure', 'signal'] as const)(
    'stops only the failed candidate after %s and never starts another release',
    async (mode) => {
      const runtime = createRuntime()
      const harness = createPm2Harness(runtime, { mode })
      await expect(
        restartAndVerifyProduction({
          standaloneDir: runtime,
          env: {
            NODE_ENV: 'production',
            KUN_DEPLOY_READINESS_TIMEOUT_MS: '5000'
          },
          dependencies: harness.dependencies
        })
      ).rejects.toMatchObject({ stopConfirmed: true })
      expect(
        harness.processes.every(
          (entry) => entry.pm2_env.status === 'stopped' && entry.pid === 0
        )
      ).toBe(true)
      expect(harness.calls.filter((args) => args[0] === 'start')).toHaveLength(
        1
      )
      expect(harness.calls.filter((args) => args[0] === 'stop')).toHaveLength(
        mode === 'partial-start' ? 1 : 3
      )
      expect(
        harness.calls
          .filter((args) => args[0] === 'stop')
          .every((args) => /^\d+$/.test(args[1]))
      ).toBe(true)
    }
  )

  it('preserves the startup and stop errors and never claims confirmed shutdown on stop failure', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime, {
      mode: 'partial-start',
      stopFails: true
    })
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: harness.dependencies
      })
    ).rejects.toMatchObject({
      stopConfirmed: false,
      errors: [
        expect.objectContaining({
          message: expect.stringContaining('partial startup failure')
        }),
        expect.objectContaining({
          message: expect.stringContaining('未能确认停止')
        })
      ]
    })
    expect(harness.processes[0].pm2_env.status).toBe('online')
    expect(harness.calls.filter((args) => args[0] === 'start')).toHaveLength(1)
  })

  it('does not infer stop confirmation from a successful stop command when instances remain online', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime, {
      mode: 'partial-start',
      stopNoEffect: true
    })
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: harness.dependencies
      })
    ).rejects.toMatchObject({
      stopConfirmed: false,
      message: expect.stringContaining('未能确认停止')
    })
    expect(harness.processes[0].pm2_env.status).toBe('online')
  })

  it('does not confirm shutdown when PM2 reports stopped but a recorded PID is still alive', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime, { mode: 'partial-start' })
    harness.dependencies.isProcessRunning = () => true
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: harness.dependencies
      })
    ).rejects.toMatchObject({ stopConfirmed: false })
    expect(harness.processes[0].pm2_env.status).toBe('stopped')
  })

  it('refuses unknown same-name PM2 processes without deleting or starting anything', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime)
    harness.processes.push(...makeProcesses(createRuntime(), 1))
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: harness.dependencies
      })
    ).rejects.toThrow('Unknown PM2 application identity')
    expect(harness.calls.every((args) => args[0] === 'jlist')).toBe(true)
  })

  it('does not touch other PM2 applications', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime, { mode: 'partial-start' })
    harness.processes.push({
      ...makeProcesses(createRuntime(), 1)[0],
      name: 'unrelated-app',
      pid: 9999,
      pm_id: 42
    })
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        dependencies: harness.dependencies
      })
    ).rejects.toMatchObject({ stopConfirmed: true })
    expect(
      harness.processes.find((entry) => entry.pm_id === 42)?.pm2_env.status
    ).toBe('online')
    expect(harness.calls.some((args) => args[1] === '42')).toBe(false)
  })

  it('rejects non-loopback probes before any process operation', async () => {
    const runtime = createRuntime()
    const harness = createPm2Harness(runtime)
    await expect(
      restartAndVerifyProduction({
        standaloneDir: runtime,
        env: {
          NODE_ENV: 'production',
          KUN_DEPLOY_SMOKE_URL: 'https://example.com/'
        },
        dependencies: harness.dependencies
      })
    ).rejects.toThrow('loopback')
    expect(harness.calls).toHaveLength(0)
  })
})

const makeProcesses = (runtime: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    pm_id: index,
    pid: 100 + index,
    name: 'kun-touchgal-next',
    pm2_env: {
      status: 'online',
      pm_cwd: runtime,
      pm_exec_path: join(runtime, 'server.mjs')
    }
  }))

const createPm2Harness = (
  runtime: string,
  options: {
    mode?: 'partial-start' | 'http-failure' | 'signal'
    stopFails?: boolean
    stopNoEffect?: boolean
  } = {}
) => {
  const processes = makeProcesses(runtime, 0)
  const calls: string[][] = []
  let now = 0
  const dependencies = {
    run: vi.fn((_command: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'jlist')
        return { ...successResult, stdout: JSON.stringify(processes) }
      if (args[0] === 'start') {
        processes.push(
          ...makeProcesses(runtime, options.mode === 'partial-start' ? 1 : 3)
        )
        return options.mode === 'partial-start'
          ? { status: 1, stdout: '', stderr: 'partial startup failure' }
          : successResult
      }
      if (args[0] === 'delete') {
        const position = processes.findIndex(
          (entry) => entry.pm_id === Number(args[1])
        )
        if (position >= 0) processes.splice(position, 1)
      }
      if (args[0] === 'stop') {
        if (options.stopNoEffect) return successResult
        if (options.stopFails)
          return { status: 1, stdout: '', stderr: 'stop denied' }
        const entry = processes.find(
          (entry) => entry.pm_id === Number(args[1])
        )!
        entry.pm2_env.status = 'stopped'
        entry.pid = 0
      }
      return successResult
    }),
    smoke: vi.fn(async () => {
      if (options.mode === 'signal') process.emit('SIGINT')
      return options.mode === 'http-failure' ? 503 : 200
    }),
    sleep: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
    isProcessRunning: (pid: number) =>
      processes.some((entry) => entry.pid === pid),
    now: () => now
  }
  return { processes, calls, dependencies }
}
