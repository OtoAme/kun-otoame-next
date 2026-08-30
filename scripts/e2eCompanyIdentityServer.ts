import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseE2EDatabaseTarget } from './e2eDatabasePreparation'

export type E2EResolverMode = 'off' | 'on'
export type E2ETerminationSignal = 'SIGINT' | 'SIGTERM'

export interface E2ECompanyServerLaunchConfig {
  command: 'pnpm'
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  databaseName: string
  resolverMode: E2EResolverMode
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const E2E_HOST = '127.0.0.1'
const E2E_PORT = 3100
const E2E_ORIGIN = `http://${E2E_HOST}:${E2E_PORT}`

export const parseE2EResolverMode = (args: string[]): E2EResolverMode => {
  const normalized = args[0] === '--' ? args.slice(1) : args
  if (normalized.length !== 1) {
    throw new Error('The E2E server requires exactly --resolver=off|on')
  }
  if (normalized[0] === '--resolver=off') return 'off'
  if (normalized[0] === '--resolver=on') return 'on'
  throw new Error('The E2E server requires exactly --resolver=off|on')
}

export const buildE2ECompanyServerLaunchConfig = (
  args: string[],
  sourceEnv: Readonly<Record<string, string | undefined>>
): E2ECompanyServerLaunchConfig => {
  const resolverMode = parseE2EResolverMode(args)
  const databaseUrl = sourceEnv.KUN_E2E_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('KUN_E2E_DATABASE_URL is required for the E2E server')
  }
  const target = parseE2EDatabaseTarget(databaseUrl, sourceEnv.KUN_DATABASE_URL)

  return {
    command: 'pnpm',
    args: [
      'exec',
      'next',
      'dev',
      '--hostname',
      E2E_HOST,
      '--port',
      String(E2E_PORT)
    ],
    cwd: projectRoot,
    databaseName: target.databaseName,
    resolverMode,
    env: {
      ...sourceEnv,
      NODE_ENV: 'development',
      KUN_DATABASE_URL: target.connectionUrl.toString(),
      KUN_COMPANY_IDENTITY_RESOLVER_ENABLED:
        resolverMode === 'on' ? 'true' : 'false',
      NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV: E2E_ORIGIN,
      KUN_E2E_BASE_URL: E2E_ORIGIN,
      KUN_E2E_ORIGIN: E2E_ORIGIN,
      // Empty values override raw .env values. Cloudflare already treats an
      // incomplete pair as disabled; IndexNow has the same fail-closed guard.
      KUN_CF_CACHE_ZONE_ID: '',
      KUN_CF_CACHE_PURGE_API_TOKEN: '',
      KUN_VISUAL_NOVEL_INDEX_NOW_KEY: ''
    }
  }
}

export const assertE2EDevPortAvailable = (port: number, host = E2E_HOST) =>
  new Promise<void>((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', () => {
      reject(
        new Error(
          `Refusing to start: ${host}:${port} is already in use; only one Next dev server may run in this worktree`
        )
      )
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error)
        else resolvePromise()
      })
    })
  })

export const assertSoleE2EDevServer = async (
  probe: (
    port: number,
    host?: string
  ) => Promise<void> = assertE2EDevPortAvailable
) => {
  // 3000 and 3100 share this worktree's .next. Checking both prevents the
  // launcher from corrupting another dev server even though it binds only 3100.
  await Promise.all([probe(3000, E2E_HOST), probe(E2E_PORT, E2E_HOST)])
}

export const assertNoSharedNextDevLock = (
  exists: (path: string) => boolean = existsSync,
  lockPath = join(projectRoot, '.next', 'dev', 'lock')
) => {
  if (exists(lockPath)) {
    throw new Error(
      `Refusing to start: Next dev lock already exists at ${lockPath}; stop the other dev server first`
    )
  }
}

interface SignalSource {
  on: (signal: E2ETerminationSignal, handler: () => void) => unknown
  off: (signal: E2ETerminationSignal, handler: () => void) => unknown
}

interface SignalTarget {
  kill: (signal: E2ETerminationSignal) => unknown
}

export const forwardE2EServerSignals = (
  source: SignalSource,
  child: SignalTarget
) => {
  const handlers = new Map<E2ETerminationSignal, () => void>()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      child.kill(signal)
    }
    handlers.set(signal, handler)
    source.on(signal, handler)
  }
  return () => {
    for (const [signal, handler] of handlers) {
      source.off(signal, handler)
    }
  }
}

const exitCodeFor = (code: number | null, signal: NodeJS.Signals | null) => {
  if (typeof code === 'number') return code
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  return 1
}

const waitForChild = (child: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolvePromise({ code, signal }))
    }
  )

const main = async () => {
  const config = buildE2ECompanyServerLaunchConfig(
    process.argv.slice(2),
    process.env
  )
  assertNoSharedNextDevLock()
  await assertSoleE2EDevServer()

  console.log(
    `Starting isolated company identity E2E server: database=${config.databaseName}, resolver=${config.resolverMode}, address=${E2E_ORIGIN}`
  )
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: config.env,
    shell: false,
    stdio: 'inherit'
  })
  const stopForwarding = forwardE2EServerSignals(process, child)
  try {
    const result = await waitForChild(child)
    process.exitCode = exitCodeFor(result.code, result.signal)
  } finally {
    stopForwarding()
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : ''
if (import.meta.url === entryPath) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
