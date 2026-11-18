import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${command} exited ${code}: ${output}`))
    )
  })

if (process.versions.node !== '24.22.1')
  throw new Error('Node 24.22.1 is required')
if (process.env.OTOAME_PRIVATE_CHAT_ACCEPTANCE !== '1')
  throw new Error(
    'Set OTOAME_PRIVATE_CHAT_ACCEPTANCE=1 to authorize a disposable PostgreSQL run'
  )
const token = `${Date.now()}_${randomBytes(4).toString('hex')}`
const name = `otoame-private-chat-${token}`
const database = `private_chat_${token}_e2e`
const password = randomBytes(32).toString('hex')
const environment = { ...process.env, POSTGRES_PASSWORD: password }
let containerId
let controlRoot
let passed = false
try {
  containerId = await run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--label',
      `otoame.private-chat.acceptance=${token}`,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_USER=private_chat_test',
      '--env',
      `POSTGRES_DB=${database}`,
      '--env',
      'POSTGRES_PASSWORD',
      'postgres:16'
    ],
    environment
  )
  if (!/^[a-f0-9]{64}$/.test(containerId))
    throw new Error('Invalid disposable container identity')
  const inspect = async () =>
    JSON.parse(
      await run('docker', [
        'inspect',
        '--format',
        '{{json .Id}}|{{json .Config.Labels}}|{{json .NetworkSettings.Ports}}',
        containerId
      ]).then((text) => `[${text.split('|').join(',')}]`)
    )
  const [actualId, labels, ports] = await inspect()
  if (
    actualId !== containerId ||
    labels['otoame.private-chat.acceptance'] !== token
  )
    throw new Error('Container identity mismatch')
  const bindings = ports['5432/tcp']
  if (
    bindings?.length !== 1 ||
    bindings[0].HostIp !== '127.0.0.1' ||
    bindings[0].HostPort === '5432'
  )
    throw new Error('Disposable PostgreSQL must use a dedicated loopback port')
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await run('docker', [
        'exec',
        containerId,
        'pg_isready',
        '-U',
        'private_chat_test',
        '-d',
        database
      ])
      ready = true
      break
    } catch {
      await delay(250)
    }
  }
  if (!ready) throw new Error('Disposable PostgreSQL readiness timed out')
  const url = new URL(
    `postgresql://127.0.0.1:${bindings[0].HostPort}/${database}`
  )
  url.username = 'private_chat_test'
  url.password = password
  await mkdir('.local', { recursive: true })
  controlRoot = await mkdtemp(
    join(process.cwd(), '.local/private-chat-control-')
  )
  const controlCommit = '97613cb939fabe5e140082b0c0b86c5398be4044'
  for (const filename of [
    'deployWriteControl.ts',
    'deployCompatibility.ts',
    'deployRuntimeCache.ts',
    'deployReleaseSafety.ts'
  ]) {
    await writeFile(
      join(controlRoot, filename),
      await run('git', ['show', `${controlCommit}:scripts/${filename}`])
    )
  }
  const testEnvironment = {
    ...process.env,
    DOTENV_CONFIG_PATH: '/dev/null',
    KUN_DATABASE_URL: url.href,
    KUN_PRIVATE_CHAT_TEST_DATABASE_URL: url.href,
    KUN_PRIVATE_CHAT_TEST_DATABASE_NAME: database,
    KUN_PRIVATE_CHAT_CONTROL_ROOT: controlRoot,
    KUN_PRIVATE_CHAT_CONTROL_PASSWORD: password,
    KUN_PRIVATE_CHAT_SOURCE_SHA: await run('git', ['rev-parse', 'HEAD']),
    KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX: ''
  }
  console.log(
    JSON.stringify({
      database,
      host: '127.0.0.1',
      port: Number(bindings[0].HostPort),
      containerId,
      isolated: true
    })
  )
  console.log(
    await run('pnpm', ['exec', 'prisma', 'db', 'push'], testEnvironment)
  )
  console.log(
    await run(
      'pnpm',
      ['test', 'tests/integration/private-chat-transactions.test.ts'],
      testEnvironment
    )
  )
  passed = true
} catch (error) {
  const safe = String(error?.message ?? error)
    .replaceAll(password, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database-url]')
  console.error(safe)
  process.exitCode = 1
} finally {
  if (controlRoot) {
    try {
      await rm(controlRoot, { recursive: true, force: true })
    } catch {
      console.error('Temporary control module cleanup failed')
      process.exitCode = 1
    }
  }
  if (containerId) {
    try {
      const label = await run('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "otoame.private-chat.acceptance"}}',
        containerId
      ])
      if (label !== token)
        throw new Error(
          'Refusing to stop a container with a different identity'
        )
      await run('docker', ['stop', '--time', '10', containerId])
      console.log(JSON.stringify({ containerId, stopped: true, passed }))
    } catch (error) {
      console.error(
        `Disposable PostgreSQL cleanup failed: ${String(error.message).replaceAll(password, '[redacted]')}`
      )
      process.exitCode = 1
    }
  }
}
