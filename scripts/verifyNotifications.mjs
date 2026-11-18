import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

const arguments_ = process.argv.slice(2)
if (arguments_.includes('--help')) {
  console.log(
    'Usage: node scripts/verifyNotifications.mjs [--business-only | --migrations-only]\nCreates and verifies a new disposable PostgreSQL container; stops it and retains its volume and evidence.'
  )
  process.exit(0)
}
if (
  arguments_.length > 1 ||
  arguments_.some(
    (argument) => !['--business-only', '--migrations-only'].includes(argument)
  )
) {
  throw new Error(
    'Only one explicit verification mode is supported; use --help'
  )
}

const nonce = randomBytes(8).toString('hex')
const directory = path.resolve(
  '.local/notification-center',
  `postgres-${nonce}`
)
const backupDirectory = `/private/tmp/otoame-notification-backups-${nonce}`
await mkdir(directory, { recursive: true, mode: 0o700 })
await mkdir(backupDirectory, { mode: 0o700 })
const steps = []
let containerId
let admin
let sequence = 0
let succeeded = false
const run = async (command, args, options = {}, expected = 0) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  })
  const filename = `${String(++sequence).padStart(2, '0')}-${path.basename(command)}.log`
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  await writeFile(path.join(directory, filename), output, { mode: 0o600 })
  steps.push({
    command: [command, ...args].join(' '),
    exitCode: result.status,
    expected,
    evidence: filename
  })
  assert.notEqual(result.status, null, filename)
  if (expected === 'nonzero') assert.notEqual(result.status, 0, filename)
  else
    assert.equal(result.status, expected, `${filename}: ${output.slice(-2000)}`)
  return result.stdout.trim()
}
const sql = (database, input, expected = 0) =>
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
    { input },
    expected
  )
const sources = {}
for (const kind of ['preflight', 'sync', 'postflight']) {
  const name = `production-notifications-${kind}-2026-11-18.sql`
  sources[kind] = await readFile(path.resolve('migration', name), 'utf8')
  await writeFile(path.join(directory, name), sources[kind], { mode: 0o600 })
}
const fingerprints = {
  migrations: Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [
      name,
      createHash('sha256').update(source).digest('hex')
    ])
  )
}
fingerprints.head = await run('git', ['rev-parse', 'HEAD'])
const diff = await run('git', ['diff', '--binary', 'HEAD'])
fingerprints.diffSha256 = createHash('sha256').update(diff).digest('hex')
fingerprints.untracked = await run('git', [
  'ls-files',
  '--others',
  '--exclude-standard'
])
fingerprints.untrackedSha256 = Object.fromEntries(
  await Promise.all(
    fingerprints.untracked
      .split('\n')
      .filter(Boolean)
      .map(async (filename) => [
        filename,
        createHash('sha256')
          .update(await readFile(filename))
          .digest('hex')
      ])
  )
)
fingerprints.harnessSha256 = createHash('sha256')
  .update(await readFile(new URL(import.meta.url)))
  .digest('hex')
await writeFile(
  path.join(directory, 'fingerprints.json'),
  JSON.stringify(fingerprints, null, 2),
  { mode: 0o600 }
)
const base = `CREATE TABLE public."user" (id serial PRIMARY KEY, blocked_tag_ids integer[] NOT NULL DEFAULT '{}', enable_email_notice boolean NOT NULL DEFAULT true);
CREATE TABLE user_message (id serial PRIMARY KEY,type varchar(100) NOT NULL,content text NOT NULL,link varchar(1007) NOT NULL,status integer NOT NULL DEFAULT 0,sender_id integer REFERENCES public."user"(id) ON DELETE SET NULL,recipient_id integer REFERENCES public."user"(id) ON DELETE CASCADE,created timestamp NOT NULL DEFAULT now(),updated timestamp NOT NULL DEFAULT now());`
const preferenceSync = await readFile(
  'migration/production-account-preferences-sync-2026-11-17.sql',
  'utf8'
)
try {
  const password = randomBytes(24).toString('hex')
  const volume = `otoame-notifications-${nonce}`
  await run('docker', [
    'volume',
    'create',
    '--label',
    `com.otoame.notifications.acceptance=${nonce}`,
    volume
  ])
  containerId = await run(
    'docker',
    [
      'run',
      '--detach',
      '--pull=never',
      '--name',
      volume,
      '--label',
      `com.otoame.notifications.acceptance=${nonce}`,
      '--publish',
      '127.0.0.1::5432',
      '--volume',
      `${volume}:/var/lib/postgresql/data`,
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
  assert(ready)
  const identity = JSON.parse(
    await run('docker', [
      'inspect',
      '--format',
      '{"Id":{{json .Id}},"Labels":{{json .Config.Labels}},"Ports":{{json .NetworkSettings.Ports}}}',
      containerId
    ])
  )
  assert.equal(identity.Id, containerId)
  assert.equal(identity.Labels['com.otoame.notifications.acceptance'], nonce)
  assert.equal(identity.Ports['5432/tcp'][0].HostIp, '127.0.0.1')
  const port = identity.Ports['5432/tcp'][0].HostPort
  assert.match(port, /^\d+$/)
  assert.notEqual(port, '5432')
  const connection = (database) =>
    `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`
  admin = new pg.Client({ connectionString: connection('postgres') })
  await admin.connect()
  await writeFile(
    path.join(directory, 'identity.json'),
    JSON.stringify(
      { nonce, containerId, volume, host: '127.0.0.1', port },
      null,
      2
    ),
    { mode: 0o600 }
  )
  if (!process.argv.includes('--business-only')) {
    const missing = `notifications_${nonce}_missing_prerequisite`
    await admin.query(`CREATE DATABASE ${missing}`)
    await sql(missing, sources.preflight, 'nonzero')
    for (const scenario of [
      'empty',
      'historical',
      'partial',
      'invalid-data',
      'interrupt',
      'timeout',
      'definition-conflict',
      'prerequisite-conflict',
      'index-conflict',
      'cursor-index-conflict',
      'invalid-subscription',
      'invalid-sequence',
      'duplicate-subscription',
      'orphan-sequence'
    ]) {
      const database = `notifications_${nonce}_${scenario.replaceAll('-', '_')}`
      await admin.query(`CREATE DATABASE ${database}`)
      assert.equal(await sql(database, 'SELECT current_database();'), database)
      assert.equal(await sql(database, 'SELECT current_user;'), 'postgres')
      await sql(database, base)
      await sql(database, preferenceSync)
      if (scenario === 'historical')
        await sql(
          database,
          `INSERT INTO public."user" (id,blocked_tag_ids,enable_email_notice) VALUES (1,ARRAY[7,9],false),(2,'{}',true); INSERT INTO user_message (id,type,content,link,status,sender_id,recipient_id,created,updated) VALUES (11,'system','无法细分的旧站务','/old',0,1,2,'2026-01-01','2026-01-02'),(12,'comment','旧回复','/old?comment=12',1,1,2,'2026-01-03','2026-01-04');`
        )
      const history = await sql(
        database,
        `SELECT row_to_json(message)::text FROM user_message message ORDER BY id;`
      )
      const backup = spawnSync(
        'docker',
        [
          'exec',
          containerId,
          'pg_dump',
          '-U',
          'postgres',
          '-d',
          database,
          '--format=custom',
          '--no-owner',
          '--no-privileges'
        ],
        { maxBuffer: 20 * 1024 * 1024 }
      )
      assert.equal(backup.status, 0)
      const backupPath = path.join(backupDirectory, `${database}.dump`)
      await writeFile(backupPath, backup.stdout, { mode: 0o600, flag: 'wx' })
      assert(backup.stdout.length > 0)
      await run('docker', ['exec', '-i', containerId, 'pg_restore', '--list'], {
        input: backup.stdout
      })
      const migrate = (kind, expected = 0) =>
        sql(database, sources[kind], expected)
      assert.match(await migrate('preflight'), /not-installed\|0/)
      if (scenario === 'partial') {
        await sql(
          database,
          'ALTER TABLE user_message ADD COLUMN event_type varchar(100);'
        )
        assert.match(await migrate('preflight'), /partial\|1/)
      }
      if (scenario === 'invalid-data') {
        await sql(
          database,
          `ALTER TABLE user_message ADD COLUMN event_type varchar(100); INSERT INTO public."user" (id) VALUES (1); INSERT INTO user_message (type,content,link,recipient_id,event_type) VALUES ('system','合成非法历史','/invalid',1,'unknown-event');`
        )
        await migrate('preflight', 'nonzero')
        await migrate('sync', 'nonzero')
        assert.equal(
          await sql(
            database,
            "SELECT count(*) FROM information_schema.columns WHERE table_name='user_message' AND column_name='content_version';"
          ),
          '0'
        )
        await sql(database, 'UPDATE user_message SET event_type=NULL;')
      }
      if (scenario === 'interrupt') {
        await sql(
          database,
          sources.sync.slice(0, sources.sync.lastIndexOf('COMMIT;')) +
            '\nSELECT pg_terminate_backend(pg_backend_pid());',
          'nonzero'
        )
        assert.equal(
          await sql(
            database,
            `SELECT count(*) FROM information_schema.columns WHERE table_name='user_message' AND column_name='event_type';`
          ),
          '0'
        )
      }
      if (scenario === 'timeout') {
        const lock = new pg.Client({ connectionString: connection(database) })
        await lock.connect()
        await lock.query(
          'BEGIN; LOCK TABLE public."user" IN ACCESS EXCLUSIVE MODE;'
        )
        try {
          await migrate('sync', 'nonzero')
        } finally {
          await lock.query('ROLLBACK')
          await lock.end()
        }
        assert.equal(
          await sql(
            database,
            `SELECT count(*) FROM information_schema.columns WHERE table_name='user_message' AND column_name='event_type';`
          ),
          '0'
        )
      }
      await migrate('sync')
      assert.match(await migrate('postflight'), /complete\|24/)
      await migrate('sync')
      if (scenario === 'historical') {
        const retained = await sql(
          database,
          `SELECT row_to_json(message)::jsonb - ARRAY['event_type','content_version','aggregate_count','dedup_key'] FROM user_message message ORDER BY id;`
        )
        assert.deepEqual(
          retained
            .split('\n')
            .filter(Boolean)
            .map((row) => JSON.parse(row)),
          history
            .split('\n')
            .filter(Boolean)
            .map((row) => JSON.parse(row))
        )
        assert.equal(
          await sql(
            database,
            `SELECT count(*) FROM user_message WHERE event_type IS NULL AND content_version=1 AND aggregate_count=1;`
          ),
          '2'
        )
        assert.equal(
          await sql(
            database,
            `SELECT count(*) FROM notification_content_sequence;`
          ),
          '0'
        )
        const recovery = `notifications_${nonce}_recovery`
        await admin.query(`CREATE DATABASE ${recovery}`)
        await run(
          'docker',
          [
            'exec',
            '-i',
            containerId,
            'pg_restore',
            '--exit-on-error',
            '--no-owner',
            '--no-privileges',
            '-U',
            'postgres',
            '-d',
            recovery
          ],
          { input: backup.stdout }
        )
        const restored = await sql(
          recovery,
          'SELECT row_to_json(message)::text FROM user_message message ORDER BY id;'
        )
        assert.deepEqual(
          restored
            .split('\n')
            .filter(Boolean)
            .map((row) => JSON.parse(row)),
          history
            .split('\n')
            .filter(Boolean)
            .map((row) => JSON.parse(row))
        )
        assert.equal(
          await sql(
            recovery,
            "SELECT count(*) FROM information_schema.columns WHERE table_name='user_message' AND column_name='event_type';"
          ),
          '0'
        )
      }
      if (scenario === 'index-conflict') {
        await sql(
          database,
          'DROP INDEX user_message_dedup_key_key; CREATE UNIQUE INDEX user_message_dedup_key_key ON user_message (content);'
        )
        for (const kind of ['preflight', 'sync', 'postflight'])
          await migrate(kind, 'nonzero')
      }
      if (scenario === 'cursor-index-conflict') {
        await sql(
          database,
          'DROP INDEX user_message_recipient_id_status_id_idx; CREATE INDEX user_message_recipient_id_status_id_idx ON user_message (recipient_id, type, id);'
        )
        for (const kind of ['preflight', 'sync', 'postflight'])
          await migrate(kind, 'nonzero')
      }
      const invalidData = {
        'invalid-subscription':
          'ALTER TABLE notification_subscription DROP CONSTRAINT notification_subscription_event_type_check; INSERT INTO public."user" (id) VALUES (1); INSERT INTO notification_subscription VALUES (1,\'creator-result\',false);',
        'invalid-sequence':
          'ALTER TABLE notification_content_sequence DROP CONSTRAINT notification_content_sequence_scope_check; INSERT INTO public."user" (id) VALUES (1); INSERT INTO notification_content_sequence VALUES (1,\'\',-1);',
        'duplicate-subscription':
          "ALTER TABLE notification_subscription DROP CONSTRAINT notification_subscription_pkey; INSERT INTO public.\"user\" (id) VALUES (1); INSERT INTO notification_subscription VALUES (1,'like',true),(1,'like',false);",
        'orphan-sequence':
          "ALTER TABLE notification_content_sequence DROP CONSTRAINT notification_content_sequence_user_id_fkey; INSERT INTO notification_content_sequence VALUES (1,'',1);"
      }[scenario]
      if (invalidData) {
        await sql(database, invalidData)
        for (const kind of ['preflight', 'sync', 'postflight'])
          await migrate(kind, 'nonzero')
      }
      if (
        scenario === 'definition-conflict' ||
        scenario === 'prerequisite-conflict'
      ) {
        const relation =
          scenario === 'definition-conflict' ? 'user_message' : 'public."user"'
        const name =
          scenario === 'definition-conflict'
            ? 'user_message_content_version_check'
            : 'user_preference_version_check'
        const expression =
          scenario === 'definition-conflict'
            ? 'content_version >= 0'
            : 'preference_version >= -1'
        await sql(
          database,
          `ALTER TABLE ${relation} DROP CONSTRAINT ${name}; ALTER TABLE ${relation} ADD CONSTRAINT ${name} CHECK (${expression});`
        )
        for (const kind of ['preflight', 'sync', 'postflight'])
          await migrate(kind, 'nonzero')
      }
    }
  }
  if (!process.argv.includes('--migrations-only')) {
    const business = `notifications_${nonce}_business`
    await admin.query(`CREATE DATABASE ${business}`)
    const environment = {
      ...process.env,
      KUN_DATABASE_URL: connection(business),
      KUN_NOTIFICATIONS_TEST_DATABASE_URL: connection(business),
      KUN_NOTIFICATIONS_TEST_NONCE: nonce,
      KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX: `notifications/${nonce}`
    }
    await run('pnpm', ['exec', 'prisma', 'db', 'push'], { env: environment })
    await sql(business, preferenceSync)
    await sql(business, sources.sync)
    await sql(
      business,
      `CREATE TABLE acceptance_identity (nonce text NOT NULL); INSERT INTO acceptance_identity VALUES ('${nonce}');`
    )
    await run(
      'pnpm',
      ['vitest', 'run', 'tests/integration/notifications.test.ts'],
      { env: environment }
    )
  }
  succeeded = true
} finally {
  if (admin) await admin.end()
  if (containerId) await run('docker', ['stop', '--time', '10', containerId])
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify(
      {
        succeeded,
        steps,
        backupDirectory,
        retainedContainer: containerId,
        finishedAt: new Date().toISOString()
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      succeeded,
      directory,
      retainedContainer: containerId,
      backupDirectory
    })
  )
}
