import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'

type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export type ReadinessDependencies = {
  run: (
    command: string,
    args: string[],
    options?: SpawnSyncOptions
  ) => CommandResult
  smoke: (url: URL, timeoutMs: number) => Promise<number>
  sleep: (milliseconds: number) => Promise<void>
  now: () => number
  isProcessRunning?: (pid: number) => boolean
}

const requiredDirectories = [
  '.next/server',
  '.next/static',
  'public',
  'server/image',
  'posts',
  'prisma/schema',
  'node_modules/.prisma',
  'node_modules/.prisma/client',
  'node_modules/@prisma/client',
  'node_modules/next',
  'node_modules/react',
  'node_modules/ffmpeg-static'
]

const requiredFiles = ['.next/BUILD_ID', 'config/redirect.json', 'package.json']

const isWithin = (parent: string, child: string) => {
  const nested = relative(parent, child)
  return nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..')
}

const validateContainedRuntimeLinks = (standaloneDir: string) => {
  const runtimeRoot = realpathSync(standaloneDir)
  const pending = [standaloneDir]

  while (pending.length) {
    const directory = pending.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        let resolved: string
        try {
          resolved = realpathSync(target)
        } catch {
          throw new Error(
            `Standalone runtime contains a broken symbolic link: ${relative(standaloneDir, target)}`
          )
        }
        if (!isWithin(runtimeRoot, resolved)) {
          throw new Error(
            `Standalone runtime symbolic link escapes the release: ${relative(standaloneDir, target)}`
          )
        }
      } else if (entry.isDirectory()) {
        pending.push(target)
      }
    }
  }
}

// pnpm links the React peers of next beside next inside node_modules/.pnpm
// rather than at the top level, so check the resolution next itself performs.
const validateNextPeerResolution = (standaloneDir: string) => {
  const runtimeRoot = realpathSync(standaloneDir)
  const nextPackage = realpathSync(join(standaloneDir, 'node_modules/next'))
  const requireFromNext = createRequire(join(nextPackage, 'package.json'))
  for (const specifier of ['react/package.json', 'react-dom/package.json']) {
    let resolved: string
    try {
      resolved = realpathSync(requireFromNext.resolve(specifier))
    } catch {
      throw new Error(
        `Standalone runtime cannot resolve ${specifier} from node_modules/next`
      )
    }
    if (!isWithin(runtimeRoot, resolved)) {
      throw new Error(
        `Standalone runtime resolves ${specifier} outside the release: ${resolved}`
      )
    }
  }
}

const runCommand = (
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): CommandResult => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    shell: false
  })
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error
  }
}

const throwCommandFailure = (
  command: string,
  args: string[],
  result: CommandResult
) => {
  if (result.error) throw result.error
  throw new Error(
    `${command} ${args.join(' ')} failed with exit ${String(result.status)}: ${(result.stderr || result.stdout).trim()}`
  )
}

export const validateStandaloneRuntime = (standaloneDir: string) => {
  if (!existsSync(standaloneDir) || !lstatSync(standaloneDir).isDirectory()) {
    throw new Error(`Standalone release is not a directory: ${standaloneDir}`)
  }

  validateContainedRuntimeLinks(standaloneDir)

  const serverMjs = join(standaloneDir, 'server.mjs')
  const serverJs = join(standaloneDir, 'server.js')
  const serverPath = existsSync(serverMjs) ? serverMjs : serverJs
  if (!existsSync(serverPath) || !statSync(serverPath).isFile()) {
    throw new Error('Standalone release has no server.mjs or server.js.')
  }

  for (const relativePath of requiredDirectories) {
    const target = join(standaloneDir, relativePath)
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      throw new Error(
        `Standalone runtime directory is missing: ${relativePath}`
      )
    }
  }
  for (const relativePath of requiredFiles) {
    const target = join(standaloneDir, relativePath)
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`Standalone runtime file is missing: ${relativePath}`)
    }
  }
  validateNextPeerResolution(standaloneDir)
  return serverPath.endsWith('server.mjs') ? 'server.mjs' : 'server.js'
}

const parseSmokeUrl = (value: string) => {
  const url = new URL(value)
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('Deployment smoke URL must use HTTP on a loopback host.')
  }
  if (url.username || url.password) {
    throw new Error('Deployment smoke URL must not contain credentials.')
  }
  return url
}

const requestSmoke = (url: URL, timeoutMs: number) =>
  new Promise<number>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('HTTP smoke request timed out.'))
    })
    request.on('error', reject)
  })

const defaultDependencies: ReadinessDependencies = {
  run: runCommand,
  smoke: requestSmoke,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now()
}

const parseTimeout = (value: string | undefined) => {
  if (!value) return 120_000
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 5_000 || parsed > 120_000) {
    throw new Error(
      'KUN_DEPLOY_READINESS_TIMEOUT_MS must be an integer from 5000 to 120000.'
    )
  }
  return parsed
}

const pm2IsOnline = (
  output: string,
  standaloneDir: string,
  scriptName: string
) => {
  try {
    const processes = JSON.parse(output) as unknown
    if (!Array.isArray(processes)) return false
    const matching = processes.filter(
      (process) =>
        typeof process === 'object' &&
        process !== null &&
        (process as { name?: unknown }).name === 'kun-touchgal-next'
    ) as Array<{
      pm2_env?: {
        status?: unknown
        pm_cwd?: unknown
        pm_exec_path?: unknown
      }
    }>
    const expectedCwd = realpathSync(standaloneDir)
    const expectedScript = realpathSync(join(standaloneDir, scriptName))
    return (
      matching.length === 3 &&
      matching.every(
        (process) =>
          process.pm2_env?.status === 'online' &&
          typeof process.pm2_env.pm_cwd === 'string' &&
          typeof process.pm2_env.pm_exec_path === 'string' &&
          realpathSync(process.pm2_env.pm_cwd) === expectedCwd &&
          realpathSync(process.pm2_env.pm_exec_path) === expectedScript
      )
    )
  } catch {
    return false
  }
}

type Pm2Process = {
  pm_id: number
  name?: string
  pid?: number
  pm2_env?: { status?: string; pm_cwd?: string; pm_exec_path?: string }
}

const listProcesses = (dependencies: ReadinessDependencies): Pm2Process[] => {
  const result = dependencies.run('pm2', ['jlist', '--silent'])
  if (result.error || result.status !== 0)
    throw new Error(
      'PM2 process list could not be read; process identity is unconfirmed.',
      { cause: result.error }
    )
  const processes = JSON.parse(result.stdout) as Pm2Process[]
  if (
    !Array.isArray(processes) ||
    processes.some(
      (entry) => !entry || !Number.isSafeInteger(entry.pm_id) || entry.pm_id < 0
    )
  ) {
    throw new Error(
      'PM2 process list is invalid; no process identity can be confirmed.'
    )
  }
  return processes
}

const belongsToRelease = (entry: Pm2Process, release: string) => {
  try {
    const cwd = entry.pm2_env?.pm_cwd
    const script = entry.pm2_env?.pm_exec_path
    return (
      entry.name === 'kun-touchgal-next' &&
      typeof cwd === 'string' &&
      typeof script === 'string' &&
      realpathSync(cwd) === realpathSync(release) &&
      ['server.mjs', 'server.js'].some(
        (name) =>
          existsSync(join(release, name)) &&
          realpathSync(script) === realpathSync(join(release, name))
      )
    )
  } catch {
    return false
  }
}

export const stopFailedRelease = async (
  standaloneDir: string,
  dependencies = defaultDependencies
) => {
  const processes = listProcesses(dependencies)
  const owned = processes.filter((entry) =>
    belongsToRelease(entry, standaloneDir)
  )
  const failures: unknown[] = []
  for (const entry of owned) {
    const args = ['stop', String(entry.pm_id)]
    const stopped = dependencies.run('pm2', args)
    if (stopped.error || stopped.status !== 0) {
      try {
        throwCommandFailure('pm2', args, stopped)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  const isRunning =
    dependencies.isProcessRunning ??
    ((pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    })
  const deadline = dependencies.now() + 5_000
  while (true) {
    const remaining = listProcesses(dependencies).filter(
      (entry) =>
        entry.name === 'kun-touchgal-next' &&
        (!belongsToRelease(entry, standaloneDir) ||
          entry.pm2_env?.status !== 'stopped' ||
          entry.pid !== 0)
    )
    const liveOwnedPid = owned.some(
      (entry) =>
        typeof entry.pid === 'number' && entry.pid > 0 && isRunning(entry.pid)
    )
    if (!remaining.length && !liveOwnedPid && !failures.length) return
    if (failures.length || dependencies.now() >= deadline) {
      throw new AggregateError(
        failures,
        '未能确认停止: failed application instances or their recorded PIDs could not be confirmed stopped; inspect PM2 without starting another release.'
      )
    }
    await dependencies.sleep(
      Math.min(100, Math.max(1, deadline - dependencies.now()))
    )
  }
}

export class DeploymentStartError extends AggregateError {
  constructor(error: unknown, stopError?: unknown) {
    super(
      stopError === undefined ? [error] : [error, stopError],
      `${error instanceof Error ? error.message : String(error)}; ${stopError === undefined ? 'Failed candidate instances confirmed stopped.' : '未能确认停止: failed candidate stop could not be confirmed.'} No other release was started.`,
      { cause: error }
    )
    this.stopConfirmed = stopError === undefined
  }
  readonly stopConfirmed: boolean
}

export const restartAndVerifyProduction = async ({
  standaloneDir,
  allowedReleaseDirs = [standaloneDir],
  env = process.env,
  dependencies = defaultDependencies
}: {
  standaloneDir: string
  allowedReleaseDirs?: string[]
  env?: NodeJS.ProcessEnv
  dependencies?: ReadinessDependencies
}) => {
  const scriptName = validateStandaloneRuntime(standaloneDir)
  const smokeUrl = parseSmokeUrl(
    env.KUN_DEPLOY_SMOKE_URL?.trim() || 'http://127.0.0.1:3000/'
  )
  const timeoutMs = parseTimeout(env.KUN_DEPLOY_READINESS_TIMEOUT_MS)
  const existing = listProcesses(dependencies).filter(
    (entry) => entry.name === 'kun-touchgal-next'
  )
  if (
    existing.some(
      (entry) =>
        !allowedReleaseDirs.some((release) => belongsToRelease(entry, release))
    )
  ) {
    throw new Error(
      'Unknown PM2 application identity; refusing to delete or start any instance.'
    )
  }
  for (const entry of existing) {
    const args = ['delete', String(entry.pm_id)]
    const deletion = dependencies.run('pm2', args)
    if (deletion.error || deletion.status !== 0)
      throwCommandFailure('pm2', args, deletion)
  }
  if (
    listProcesses(dependencies).some(
      (entry) => entry.name === 'kun-touchgal-next'
    )
  ) {
    throw new Error(
      'Existing application removal could not be confirmed; no candidate was started.'
    )
  }

  let interrupted = false
  const onInterrupt = () => {
    interrupted = true
  }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)
  try {
    const startArgs = [
      'start',
      scriptName,
      '--name',
      'kun-touchgal-next',
      '--cwd',
      standaloneDir,
      '-i',
      '3',
      '--max-memory-restart',
      '1G',
      '--',
      '--port',
      '3000',
      '--hostname',
      '127.0.0.1'
    ]
    const started = dependencies.run('pm2', startArgs, {
      env: { ...env, NODE_ENV: 'production' }
    })
    if (started.error || started.status !== 0)
      throwCommandFailure('pm2', startArgs, started)
    const deadline = dependencies.now() + timeoutMs
    let lastFailure = 'PM2 process has not reached online state.'
    while (dependencies.now() < deadline) {
      if (interrupted)
        throw new Error('Deployment startup interrupted by signal.')
      const list = dependencies.run('pm2', ['jlist', '--silent'])
      if (
        !list.error &&
        list.status === 0 &&
        pm2IsOnline(list.stdout, standaloneDir, scriptName)
      ) {
        const remainingMs = deadline - dependencies.now()
        if (remainingMs <= 0) {
          lastFailure = 'Readiness budget exhausted during PM2 inspection.'
          break
        }
        try {
          const status = await dependencies.smoke(
            smokeUrl,
            Math.min(5_000, remainingMs)
          )
          if (interrupted)
            throw new Error('Deployment startup interrupted by signal.')
          if (status >= 200 && status < 400) return
          lastFailure = `HTTP smoke returned status ${status}.`
        } catch (error) {
          lastFailure =
            error instanceof Error
              ? error.message
              : 'HTTP smoke request failed.'
        }
      } else {
        lastFailure = 'PM2 process has not reached online state.'
      }
      const remainingMs = deadline - dependencies.now()
      if (remainingMs <= 0) break
      await dependencies.sleep(Math.min(500, remainingMs))
    }
    throw new Error(
      `Deployment readiness timed out after ${timeoutMs} ms: ${lastFailure}`
    )
  } catch (error) {
    try {
      await stopFailedRelease(standaloneDir, dependencies)
    } catch (stopError) {
      throw new DeploymentStartError(error, stopError)
    }
    throw new DeploymentStartError(error)
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onInterrupt)
  }
}
