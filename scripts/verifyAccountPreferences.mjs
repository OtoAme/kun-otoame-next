import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

const nonce = randomBytes(8).toString('hex')
const runDirectory = path.resolve(
  '.local/account-preferences',
  `acceptance-${nonce}`
)
await mkdir(runDirectory, { recursive: true })
const steps = []
let containerId
let admin
let sequence = 0
const run = (command, args, options = {}, expected = 0) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  })
  const name = `${String(++sequence).padStart(2, '0')}-${path.basename(command)}.log`
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const file = path.join(runDirectory, name)
  steps.push({
    command: [command, ...args].join(' '),
    exitCode: result.status,
    expected,
    evidence: name
  })
  const writing = writeFile(file, output)
  pendingLogs.push(writing)
  if (expected === 'nonzero') assert.notEqual(result.status, 0, name)
  else assert.equal(result.status, expected, `${name}: ${output.slice(-2000)}`)
  return result.stdout.trim()
}
const pendingLogs = []
const sql = (database, text, expected = 0) =>
  run(
    'docker',
    [
      'exec',
      '-i',
      containerId,
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database
    ],
    { input: text },
    expected
  )
const filename = (kind) =>
  `production-account-preferences-${kind}-2026-11-17.sql`
const migrate = (database, kind, expected = 0) =>
  run(
    'docker',
    [
      'exec',
      containerId,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database,
      '-f',
      `/tmp/${filename(kind)}`
    ],
    {},
    expected
  )
const base = `CREATE TABLE public."user" (id serial PRIMARY KEY, blocked_tag_ids integer[] NOT NULL DEFAULT '{}', enable_email_notice boolean NOT NULL DEFAULT true);`
let succeeded = false
try {
  const password = randomBytes(24).toString('hex')
  containerId = run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--name',
      `otoame-preferences-${nonce}`,
      '--label',
      `com.otoame.preferences.acceptance=${nonce}`,
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data',
      '-e',
      'POSTGRES_PASSWORD',
      'postgres:16'
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password } }
  )
  assert.match(containerId, /^[a-f0-9]{64}$/)
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      'docker',
      ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
      { encoding: 'utf8' }
    )
    if (probe.status === 0) {
      ready = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(ready, 'isolated PostgreSQL readiness')
  const port = run('docker', [
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    containerId
  ])
  assert(port !== '5432' && /^\d+$/.test(port))
  const connection = (database) =>
    `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`
  admin = new pg.Client({ connectionString: connection('postgres') })
  await admin.connect()
  for (const kind of ['preflight', 'sync', 'postflight']) {
    run('docker', [
      'cp',
      path.resolve('migration', filename(kind)),
      `${containerId}:/tmp/${filename(kind)}`
    ])
    await copyFile(
      path.resolve('migration', filename(kind)),
      path.join(runDirectory, filename(kind))
    )
  }
  for (const scenario of [
    'empty',
    'existing',
    'interrupt',
    'timeout',
    'incompatible'
  ]) {
    const database = `account_preferences_${nonce}_${scenario}`
    await admin.query(`CREATE DATABASE ${database}`)
    sql(database, base)
    if (scenario === 'existing')
      sql(
        database,
        `INSERT INTO public."user" (blocked_tag_ids,enable_email_notice) VALUES (ARRAY[7,9],false);`
      )
    migrate(database, 'preflight')
    if (scenario === 'interrupt') {
      const source = await readFile(
        path.resolve('migration', filename('sync')),
        'utf8'
      )
      const staged = source.slice(
        source.indexOf('BEGIN;'),
        source.indexOf('COMMIT;')
      )
      sql(
        database,
        `${staged}\nSELECT pg_terminate_backend(pg_backend_pid());`,
        'nonzero'
      )
      assert.equal(
        sql(
          database,
          `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='nsfw_mode'`
        ),
        '0'
      )
    }
    if (scenario === 'timeout') {
      const lock = new pg.Client({ connectionString: connection(database) })
      await lock.connect()
      await lock.query(
        'BEGIN; LOCK TABLE public."user" IN ACCESS EXCLUSIVE MODE'
      )
      try {
        migrate(database, 'sync', 'nonzero')
      } finally {
        await lock.query('ROLLBACK')
        await lock.end()
      }
      assert.equal(
        sql(
          database,
          `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user' AND column_name='nsfw_mode'`
        ),
        '0'
      )
    }
    migrate(database, 'sync')
    migrate(database, 'postflight')
    if (scenario === 'incompatible') {
      sql(
        database,
        `ALTER TABLE public."user" DROP CONSTRAINT user_preference_version_check; ALTER TABLE public."user" ADD CONSTRAINT user_preference_version_check CHECK (preference_version >= -1);`
      )
      migrate(database, 'preflight', 'nonzero')
      migrate(database, 'sync', 'nonzero')
      migrate(database, 'postflight', 'nonzero')
      sql(
        database,
        `ALTER TABLE public."user" DROP CONSTRAINT user_preference_version_check; ALTER TABLE public."user" ADD CONSTRAINT user_preference_version_check CHECK (preference_version >= 0);`
      )
    }
    migrate(database, 'sync')
    if (scenario === 'existing')
      assert.equal(
        sql(
          database,
          `SELECT blocked_tag_ids::text || ':' || enable_email_notice::text || ':' || preference_version || ':' || (nsfw_mode IS NULL)::text FROM public."user"`
        ),
        '{7,9}:false:0:true'
      )
  }
  const serviceDatabase = `account_preferences_${nonce}_e2e`
  await admin.query(`CREATE DATABASE ${serviceDatabase}`)
  const environment = {
    ...process.env,
    KUN_DATABASE_URL: connection(serviceDatabase),
    KUN_ACCOUNT_PREFERENCES_TEST_DATABASE_URL: connection(serviceDatabase),
    KUN_ACCOUNT_PREFERENCES_TEST_NONCE: nonce
  }
  run('pnpm', ['exec', 'prisma', 'db', 'push'], { env: environment })
  sql(
    serviceDatabase,
    `CREATE TABLE acceptance_identity (nonce text NOT NULL); INSERT INTO acceptance_identity VALUES ('${nonce}');`
  )
  migrate(serviceDatabase, 'sync')
  run('pnpm', ['test', 'tests/integration/account-preferences.test.ts'], {
    env: environment
  })
  succeeded = true
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await admin?.end()
  if (containerId) {
    const marker = run('docker', [
      'inspect',
      '--format',
      '{{index .Config.Labels "com.otoame.preferences.acceptance"}}',
      containerId
    ])
    assert.equal(marker, nonce)
    run('docker', ['stop', '--time', '10', containerId])
  }
  await Promise.all(pendingLogs)
  await writeFile(
    path.join(runDirectory, 'receipt.json'),
    JSON.stringify(
      {
        succeeded,
        nonce,
        containerId,
        cleaned: true,
        steps
      },
      null,
      2
    )
  )
  console.log(`ACCOUNT_PREFERENCES_EVIDENCE=${runDirectory}`)
}
