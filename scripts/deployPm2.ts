import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'

type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

type ReadinessDependencies = {
  run: (
    command: string,
    args: string[],
    options?: SpawnSyncOptions
  ) => CommandResult
  smoke: (url: URL, timeoutMs: number) => Promise<number>
  sleep: (milliseconds: number) => Promise<void>
  now: () => number
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
  'node_modules/react-dom',
  'node_modules/ffmpeg-static'
]

const requiredFiles = ['.next/BUILD_ID', 'config/redirect.json', 'package.json']

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

  const serverMjs = join(standaloneDir, 'server.mjs')
  const serverJs = join(standaloneDir, 'server.js')
  const serverPath = existsSync(serverMjs) ? serverMjs : serverJs
  if (!existsSync(serverPath) || !lstatSync(serverPath).isFile()) {
    throw new Error('Standalone release has no server.mjs or server.js.')
  }

  for (const relativePath of requiredDirectories) {
    const target = join(standaloneDir, relativePath)
    if (!existsSync(target) || !lstatSync(target).isDirectory()) {
      throw new Error(
        `Standalone runtime directory is missing: ${relativePath}`
      )
    }
  }
  for (const relativePath of requiredFiles) {
    const target = join(standaloneDir, relativePath)
    if (!existsSync(target) || !lstatSync(target).isFile()) {
      throw new Error(`Standalone runtime file is missing: ${relativePath}`)
    }
  }
  return serverPath.endsWith('server.mjs') ? 'server.mjs' : 'server.js'
}

export const isPm2ProcessNotFound = (result: CommandResult) => {
  const output = `${result.stdout}\n${result.stderr}`
  return /Process or Namespace\s+kun-touchgal-next\s+not found/i.test(output)
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
  if (!value) return 30_000
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

export const restartAndVerifyProduction = async ({
  standaloneDir,
  env = process.env,
  dependencies = defaultDependencies
}: {
  standaloneDir: string
  env?: NodeJS.ProcessEnv
  dependencies?: ReadinessDependencies
}) => {
  const scriptName = validateStandaloneRuntime(standaloneDir)
  const smokeUrl = parseSmokeUrl(
    env.KUN_DEPLOY_SMOKE_URL?.trim() || 'http://127.0.0.1:3000/'
  )
  const timeoutMs = parseTimeout(env.KUN_DEPLOY_READINESS_TIMEOUT_MS)

  const deleteArgs = ['delete', 'kun-touchgal-next']
  const deletion = dependencies.run('pm2', deleteArgs)
  if (deletion.error) throw deletion.error
  if (deletion.status !== 0 && !isPm2ProcessNotFound(deletion)) {
    throwCommandFailure('pm2', deleteArgs, deletion)
  }

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
  if (started.error || started.status !== 0) {
    throwCommandFailure('pm2', startArgs, started)
  }

  const deadline = dependencies.now() + timeoutMs
  let lastFailure = 'PM2 process has not reached online state.'
  while (dependencies.now() < deadline) {
    const list = dependencies.run('pm2', ['jlist'])
    if (
      !list.error &&
      list.status === 0 &&
      pm2IsOnline(list.stdout, standaloneDir, scriptName)
    ) {
      try {
        const status = await dependencies.smoke(
          smokeUrl,
          Math.min(5_000, Math.max(1, deadline - dependencies.now()))
        )
        if (status >= 200 && status < 400) return
        lastFailure = `HTTP smoke returned status ${status}.`
      } catch (error) {
        lastFailure =
          error instanceof Error ? error.message : 'HTTP smoke request failed.'
      }
    } else {
      lastFailure = 'PM2 process has not reached online state.'
    }
    await dependencies.sleep(
      Math.min(500, Math.max(1, deadline - dependencies.now()))
    )
  }

  throw new Error(`Deployment readiness timed out: ${lastFailure}`)
}
