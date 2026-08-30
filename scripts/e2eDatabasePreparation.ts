import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

export interface E2EDatabaseTarget {
  connectionUrl: URL
  databaseName: string
  host: string
}

export interface E2ESeedResult {
  submitterUid: number
  reviewerUid: number
  patchUniqueId: string
}

export interface E2EPreparationDependencies {
  createBackup: (target: E2EDatabaseTarget, backupPath: string) => void
  resetSchema: (target: E2EDatabaseTarget) => void
  runSqlFile: (target: E2EDatabaseTarget, filePath: string) => void
  seed: (target: E2EDatabaseTarget) => Promise<E2ESeedResult>
}

export interface E2EDockerCommand {
  command: 'docker'
  args: string[]
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const migrationPath = (name: string) => join(projectRoot, 'migration', name)

const invalidTarget = () =>
  new Error(
    'KUN_E2E_DATABASE_URL must identify a disposable PostgreSQL database whose name ends in _e2e'
  )

const databaseIdentity = (url: URL) =>
  `${normalizeDatabaseHost(url.hostname)}:${url.port || '5432'}/${decodeURIComponent(
    url.pathname.slice(1)
  )}`

const normalizeDatabaseHost = (host: string) => {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  return ['localhost', '127.0.0.1', '::1'].includes(normalized)
    ? 'loopback'
    : normalized
}

const dockerDatabaseArguments = (target: E2EDatabaseTarget) => {
  const username = decodeURIComponent(target.connectionUrl.username)
  return [
    '--no-password',
    ...(username ? ['-U', username] : []),
    '-d',
    target.databaseName
  ]
}

export const parseE2EPgContainer = (
  rawValue: string,
  target: E2EDatabaseTarget
) => {
  const container = rawValue
  if (
    container !== container.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container)
  ) {
    throw new Error('KUN_E2E_PG_CONTAINER is not a valid Docker container name')
  }
  if (normalizeDatabaseHost(target.connectionUrl.hostname) !== 'loopback') {
    throw new Error(
      'KUN_E2E_PG_CONTAINER requires a loopback KUN_E2E_DATABASE_URL target'
    )
  }
  return container
}

export const buildDockerPgDumpCommand = (
  container: string,
  target: E2EDatabaseTarget
): E2EDockerCommand => ({
  command: 'docker',
  args: [
    'exec',
    container,
    'pg_dump',
    '-Fc',
    ...dockerDatabaseArguments(target)
  ]
})

export const buildDockerPgRestoreListCommand = (
  container: string
): E2EDockerCommand => ({
  command: 'docker',
  args: ['exec', '-i', container, 'pg_restore', '--list']
})

export const buildDockerPsqlCommand = (
  container: string,
  target: E2EDatabaseTarget
): E2EDockerCommand => ({
  command: 'docker',
  args: [
    'exec',
    '-i',
    container,
    'psql',
    '-X',
    '--set',
    'ON_ERROR_STOP=on',
    ...dockerDatabaseArguments(target)
  ]
})

export const parseE2EDatabaseTarget = (
  rawValue: string,
  applicationDatabaseUrl?: string
): E2EDatabaseTarget => {
  let connectionUrl: URL
  try {
    connectionUrl = new URL(rawValue)
  } catch {
    throw invalidTarget()
  }

  if (
    connectionUrl.protocol !== 'postgresql:' &&
    connectionUrl.protocol !== 'postgres:'
  ) {
    throw invalidTarget()
  }

  let databaseName: string
  try {
    databaseName = decodeURIComponent(connectionUrl.pathname.slice(1))
  } catch {
    throw invalidTarget()
  }
  if (
    !databaseName ||
    !databaseName.endsWith('_e2e') ||
    databaseName.includes('/') ||
    databaseName.includes('\\') ||
    databaseName.includes('\0')
  ) {
    throw invalidTarget()
  }

  if (applicationDatabaseUrl) {
    let applicationUrl: URL
    try {
      applicationUrl = new URL(applicationDatabaseUrl)
    } catch {
      throw new Error(
        'KUN_DATABASE_URL is invalid, so the E2E target cannot be compared safely'
      )
    }
    if (databaseIdentity(connectionUrl) === databaseIdentity(applicationUrl)) {
      throw new Error('KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL')
    }
  }

  return {
    connectionUrl,
    databaseName,
    host: connectionUrl.hostname
  }
}

export const createPgCommandEnvironment = (target: E2EDatabaseTarget) => ({
  ...process.env,
  PGHOST: target.connectionUrl.hostname,
  PGPORT: target.connectionUrl.port || '5432',
  PGUSER: decodeURIComponent(target.connectionUrl.username),
  PGPASSWORD: decodeURIComponent(target.connectionUrl.password),
  PGDATABASE: target.databaseName
})

export const assertSafeBackupDestination = (backupPath: string) => {
  if (!isAbsolute(backupPath)) {
    throw new Error('The E2E backup path must be absolute')
  }

  const parent = dirname(backupPath)
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 })
  }
  if (realpathSync(parent) !== resolve(parent)) {
    throw new Error('The E2E backup directory must not contain symlinks')
  }
  if (existsSync(backupPath)) {
    const stats = lstatSync(backupPath)
    if (stats.isSymbolicLink()) {
      throw new Error('The E2E backup path must not be a symbolic link')
    }
    throw new Error('The E2E backup path already exists')
  }
}

const runCommand = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'pipe']
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr?.trim()
    throw new Error(
      `${command} failed${detail ? `: ${detail.slice(0, 1000)}` : ''}`
    )
  }
}

const runBinaryCommand = (
  command: string,
  args: string[],
  options: { input?: Buffer; stdout?: 'capture' | 'ignore' | 'inherit' } = {}
) => {
  const stdout = options.stdout ?? 'capture'
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    input: options.input,
    encoding: null,
    stdio: [
      options.input ? 'pipe' : 'ignore',
      stdout === 'capture' ? 'pipe' : stdout,
      'pipe'
    ],
    // E2E databases are disposable but can still exceed Node's small default
    // spawn buffer. Keep the archive binary in memory only long enough to write
    // and verify its host-side temporary file.
    maxBuffer: 1024 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim()
    throw new Error(
      `${command} failed${detail ? `: ${detail.slice(0, 1000)}` : ''}`
    )
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
}

const createVerifiedBackup = (
  target: E2EDatabaseTarget,
  backupPath: string
) => {
  assertSafeBackupDestination(backupPath)
  const temporaryPath = join(
    dirname(backupPath),
    `.${basename(backupPath)}.${randomUUID()}.tmp`
  )
  const pgEnvironment = createPgCommandEnvironment(target)

  try {
    runCommand('pg_dump', ['-Fc', '-f', temporaryPath], pgEnvironment)
    chmodSync(temporaryPath, 0o600)
    runCommand('pg_restore', ['--list', temporaryPath], pgEnvironment)
    linkSync(temporaryPath, backupPath)
    rmSync(temporaryPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

const createVerifiedDockerBackup = (
  container: string,
  target: E2EDatabaseTarget,
  backupPath: string
) => {
  assertSafeBackupDestination(backupPath)
  const temporaryPath = join(
    dirname(backupPath),
    `.${basename(backupPath)}.${randomUUID()}.tmp`
  )
  const dumpCommand = buildDockerPgDumpCommand(container, target)
  const restoreCommand = buildDockerPgRestoreListCommand(container)

  try {
    const archive = runBinaryCommand(dumpCommand.command, dumpCommand.args)
    if (!archive.length) {
      throw new Error('docker pg_dump returned an empty archive')
    }
    writeFileSync(temporaryPath, archive, { flag: 'wx', mode: 0o600 })
    chmodSync(temporaryPath, 0o600)
    runBinaryCommand(restoreCommand.command, restoreCommand.args, {
      input: readFileSync(temporaryPath),
      stdout: 'ignore'
    })
    linkSync(temporaryPath, backupPath)
    rmSync(temporaryPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

const runPsqlFile = (target: E2EDatabaseTarget, filePath: string) => {
  runCommand(
    'psql',
    ['-X', '--set', 'ON_ERROR_STOP=on', '--file', filePath],
    createPgCommandEnvironment(target)
  )
}

const runDockerPsqlFile = (
  container: string,
  target: E2EDatabaseTarget,
  filePath: string
) => {
  const command = buildDockerPsqlCommand(container, target)
  runBinaryCommand(command.command, command.args, {
    input: readFileSync(filePath),
    stdout: 'inherit'
  })
}

const resetSchema = (target: E2EDatabaseTarget) => {
  runCommand(
    'pnpm',
    ['exec', 'prisma', 'db', 'push', '--force-reset', '--schema=prisma/schema'],
    { ...process.env, KUN_DATABASE_URL: target.connectionUrl.toString() }
  )
}

const seedE2EDatabase = async (
  target: E2EDatabaseTarget
): Promise<E2ESeedResult> => {
  const pool = new pg.Pool({
    connectionString: target.connectionUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5000
  })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const submitter = await client.query<{ id: number }>(`
      INSERT INTO public."user"
        (name, email, password, role, moemoepoint, enable_email_notice, updated)
      VALUES
        ('e2e_submitter', 'e2e_submitter@example.invalid', 'not-used', 1, 1000, false, CURRENT_TIMESTAMP)
      RETURNING id
    `)
    const reviewer = await client.query<{ id: number }>(`
      INSERT INTO public."user"
        (name, email, password, role, moemoepoint, enable_email_notice, updated)
      VALUES
        ('e2e_admin', 'e2e_admin@example.invalid', 'not-used', 4, 1000, false, CURRENT_TIMESTAMP)
      RETURNING id
    `)
    const patchUniqueId = 'e2e00001'
    const patch = await client.query<{ id: number }>(
      `
        INSERT INTO public.patch
          (unique_id, name, banner, introduction, released, content_limit,
           type, language, engine, platform, user_id, updated)
        VALUES
          ($1, 'E2E Rewrite Fixture', '', 'Disposable E2E rewrite fixture.',
           '2026-08-31', 'sfw', ARRAY[]::varchar[], ARRAY[]::varchar[],
           ARRAY[]::varchar[], ARRAY[]::varchar[], $2, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [patchUniqueId, reviewer.rows[0].id]
    )
    await client.query(
      `
        INSERT INTO public.patch_rating_stat (patch_id, updated)
        VALUES ($1, CURRENT_TIMESTAMP)
      `,
      [patch.rows[0].id]
    )
    await client.query('COMMIT')
    return {
      submitterUid: submitter.rows[0].id,
      reviewerUid: reviewer.rows[0].id,
      patchUniqueId
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

export const prepareE2EDatabase = async (
  options: {
    databaseUrl: string
    applicationDatabaseUrl?: string
    backupPath: string
    resetConfirmed: true
    pgContainer?: string
  },
  dependencies?: E2EPreparationDependencies
) => {
  if (options.resetConfirmed !== true) {
    throw new Error(
      'Preparing the E2E database requires explicit reset confirmation'
    )
  }
  const target = parseE2EDatabaseTarget(
    options.databaseUrl,
    options.applicationDatabaseUrl
  )
  const container = options.pgContainer
    ? parseE2EPgContainer(options.pgContainer, target)
    : null
  const runtimeDependencies =
    dependencies ??
    ({
      createBackup: container
        ? (backupTarget, backupPath) =>
            createVerifiedDockerBackup(container, backupTarget, backupPath)
        : createVerifiedBackup,
      resetSchema,
      runSqlFile: container
        ? (sqlTarget, filePath) =>
            runDockerPsqlFile(container, sqlTarget, filePath)
        : runPsqlFile,
      seed: seedE2EDatabase
    } satisfies E2EPreparationDependencies)

  runtimeDependencies.createBackup(target, options.backupPath)
  runtimeDependencies.resetSchema(target)
  runtimeDependencies.runSqlFile(
    target,
    migrationPath('production-tag-company-count-sync-2026-08-30.sql')
  )
  runtimeDependencies.runSqlFile(
    target,
    migrationPath('production-tag-company-count-postflight-2026-08-30.sql')
  )
  runtimeDependencies.runSqlFile(
    target,
    migrationPath(
      'production-company-identity-constraint-postflight-2026-08-30.sql'
    )
  )
  return runtimeDependencies.seed(target)
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      reset: { type: 'boolean' },
      backup: { type: 'string' }
    },
    strict: true,
    allowPositionals: false
  })
  if (!values.reset) {
    throw new Error('Preparing the E2E database requires explicit --reset')
  }
  if (!values.backup) {
    throw new Error('Preparing the E2E database requires --backup=<absolute>')
  }
  const databaseUrl = process.env.KUN_E2E_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('KUN_E2E_DATABASE_URL is required')
  }

  const result = await prepareE2EDatabase({
    databaseUrl,
    applicationDatabaseUrl: process.env.KUN_DATABASE_URL,
    backupPath: values.backup,
    resetConfirmed: true,
    pgContainer: process.env.KUN_E2E_PG_CONTAINER
  })
  console.log(
    JSON.stringify(
      {
        database: parseE2EDatabaseTarget(databaseUrl).databaseName,
        ...result
      },
      null,
      2
    )
  )
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : ''
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
