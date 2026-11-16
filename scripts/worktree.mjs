import { realpath, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { createServer, createConnection } from 'node:net'
import {
  VERSION,
  PG_IMAGE,
  REDIS_IMAGE,
  MANAGER_ROLE,
  createIdentity,
  assertState,
  containerPort,
  digest,
  secret,
  buildApplicationEnv,
  serializeEnv,
  databaseMarker,
  quoteSql,
  roleSql,
  databaseSql
} from './worktree/config.mjs'
import {
  run,
  checked,
  readText,
  readJson,
  writeJson,
  writePrivate,
  privateDirectory,
  fileInfo,
  withLock,
  portAvailable,
  pause,
  Docker,
  resourceLabels
} from './worktree/runtime.mjs'

export const context = async (cwd = process.cwd(), runner = run) => {
  const root = await realpath(
    await checked(
      runner,
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd },
      '定位工作区'
    )
  )
  const saved = await readJson(join(root, '.worktree', 'state.json'), true)
  const primary = await realpath(
    process.env.ORCA_ROOT_PATH ||
      saved?.primary ||
      (
        await checked(
          runner,
          'git',
          ['worktree', 'list', '--porcelain'],
          { cwd: root },
          '定位主仓库'
        )
      )
        .split('\n')[0]
        .replace(/^worktree /, '')
  )
  if (
    process.env.ORCA_WORKTREE_PATH &&
    (await realpath(process.env.ORCA_WORKTREE_PATH)) !== root
  ) {
    throw new Error('Orca worktree 路径与当前工作区不符。')
  }
  const common = async (path) =>
    realpath(
      resolve(
        path,
        await checked(
          runner,
          'git',
          ['rev-parse', '--git-common-dir'],
          { cwd: path },
          '核对 Git 仓库'
        )
      )
    )
  if ((await common(root)) !== (await common(primary)))
    throw new Error('主仓库与 worktree 不属于同一 Git 仓库。')
  return createIdentity(root, primary)
}

export class WorktreeManager {
  constructor(identity, options = {}) {
    this.identity = identity
    this.runner = options.run ?? run
    this.docker = new Docker(this.runner)
    this.probe = options.portAvailable ?? portAvailable
    this.local = join(identity.root, '.worktree')
    this.shared = join(identity.primary, '.worktree', 'manager')
    this.statePath = join(this.local, 'state.json')
    this.secretsPath = join(this.local, 'secrets.json')
    this.sharedPath = join(this.shared, 'postgres.json')
    this.log = options.log ?? console.log
  }

  async load() {
    const state = await readJson(this.statePath, true)
    if (!state) throw new Error('当前 worktree 尚未初始化，请先运行 setup。')
    assertState(state, this.identity)
    return state
  }

  async credentials() {
    const value = await readJson(this.secretsPath)
    for (const key of [
      'databasePassword',
      'redisPassword',
      'jwtSecret',
      'loginPassword'
    ]) {
      if (!/^[a-f0-9]{64}$/.test(value[key] ?? ''))
        throw new Error('worktree 凭据缺失或损坏，拒绝重置已有账号。')
    }
    return value
  }

  async sharedState() {
    const state = await readJson(this.sharedPath)
    const labels = resourceLabels(this.identity, state.nonce, 'postgres')
    if (
      state.name !== this.identity.postgresName ||
      state.volume !== `${state.name}-data` ||
      state.primary !== this.identity.primary ||
      !/^[a-f0-9]{64}$/.test(state.nonce ?? '') ||
      JSON.stringify(state.labels) !== JSON.stringify(labels)
    ) {
      throw new Error('共享 PostgreSQL 身份记录不符。')
    }
    return state
  }

  async allocate() {
    return withLock(
      join(this.shared, 'lock'),
      async () => {
        let state = await readJson(this.statePath, true)
        const registryPath = join(this.shared, 'ports.json')
        const registry = await readJson(registryPath, true)
        if (state) {
          assertState(state, this.identity)
          if (
            registry?.[state.id]?.root !== state.root ||
            registry[state.id].port !== state.appPort
          ) {
            throw new Error(
              '共享端口登记缺失或已变化，拒绝重新分配已有 worktree 的端口。'
            )
          }
          return state
        }
        if ((await readText(join(this.identity.root, '.env'), true)) !== null) {
          throw new Error(
            '已有 .env 不属于本管理器，拒绝覆盖；请先移走配置并核对 worktree。'
          )
        }
        if (!registry && (await readJson(this.sharedPath, true)))
          throw new Error('共享端口登记缺失，拒绝复用未知端口分配。')
        const ports = registry ?? {}
        for (const [id, entry] of Object.entries(ports)) {
          if (
            !/^[a-f0-9]{12}$/.test(id) ||
            typeof entry.root !== 'string' ||
            !Number.isInteger(entry.port) ||
            entry.port < 3300 ||
            entry.port > 49999
          ) {
            throw new Error('共享端口登记内容损坏。')
          }
        }
        const used = new Set(Object.values(ports).map((entry) => entry.port))
        let appPort
        const registered = ports[this.identity.id]
        if (registered) {
          if (registered.root !== this.identity.root)
            throw new Error('worktree 标识冲突。')
          appPort = registered.port
        } else {
          for (let port = 3300; port <= 49999; port++) {
            if (!used.has(port) && (await this.probe(port))) {
              appPort = port
              break
            }
          }
        }
        if (!appPort) throw new Error('没有可用的 worktree 应用端口。')
        ports[this.identity.id] = { root: this.identity.root, port: appPort }
        await writeJson(registryPath, ports)
        const nonce = secret()
        state = {
          ...this.identity,
          nonce,
          appPort,
          ready: false,
          redis: {
            name: this.identity.redisName,
            volume: `${this.identity.redisName}-data`,
            labels: resourceLabels(this.identity, nonce, 'redis')
          }
        }
        await writeJson(this.secretsPath, {
          databasePassword: secret(),
          redisPassword: secret(),
          jwtSecret: secret(),
          loginPassword: secret()
        })
        await writeJson(this.statePath, state)
        return state
      },
      30_000
    )
  }

  async postgres() {
    return withLock(
      join(this.shared, 'lock'),
      async () => {
        let state = await readJson(this.sharedPath, true)
        if (!state) {
          const nonce = secret()
          state = {
            name: this.identity.postgresName,
            primary: this.identity.primary,
            nonce,
            volume: `${this.identity.postgresName}-data`,
            labels: resourceLabels(this.identity, nonce, 'postgres')
          }
          await writePrivate(
            join(this.shared, 'postgres.env'),
            Object.entries({
              POSTGRES_USER: MANAGER_ROLE,
              POSTGRES_PASSWORD: secret(),
              POSTGRES_DB: 'postgres',
              PGDATA: '/data/pgdata'
            })
              .map(([key, value]) => `${key}=${value}`)
              .join('\n') + '\n'
          )
          await writeJson(this.sharedPath, state)
        }
        state = await this.sharedState()
        const info = await this.docker.ensure(
          state,
          [
            '--env-file',
            join(this.shared, 'postgres.env'),
            '--publish',
            '127.0.0.1::5432',
            PG_IMAGE
          ],
          () => writeJson(this.sharedPath, state)
        )
        // The image briefly starts a Unix-socket-only server during initdb.
        await this.docker.ready(state, [
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          MANAGER_ROLE,
          '-d',
          'postgres'
        ])
        return { resource: state, port: containerPort(info, 5432) }
      },
      30_000
    )
  }

  async database(state, pg, credentials) {
    const marker = databaseMarker(state)
    const owner = await this.docker.psql(
      pg,
      'postgres',
      MANAGER_ROLE,
      `SELECT json_build_object('role', pg_get_userbyid(datdba), 'marker', shobj_description(oid, 'pg_database')) FROM pg_database WHERE datname=${quoteSql(state.database)};`
    )
    const role = await this.docker.psql(
      pg,
      'postgres',
      MANAGER_ROLE,
      `SELECT json_build_object('marker', shobj_description(oid, 'pg_authid'), 'safe', NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) FROM pg_roles WHERE rolname=${quoteSql(state.role)};`
    )
    if (role) {
      let found
      try {
        found = JSON.parse(role)
      } catch {
        throw new Error('数据库角色元数据无效。')
      }
      if (found.marker !== marker || !found.safe)
        throw new Error('同名数据库账号不属于当前 worktree 或权限过高。')
    } else {
      if (owner) throw new Error('已有数据库缺少匹配账号，拒绝接管。')
      await this.docker.psql(
        pg,
        'postgres',
        MANAGER_ROLE,
        roleSql(state, credentials.databasePassword)
      )
    }
    if (owner) {
      let found
      try {
        found = JSON.parse(owner)
      } catch {
        throw new Error('数据库元数据无效。')
      }
      if (found.role !== state.role || found.marker !== marker)
        throw new Error('同名数据库来源不明，拒绝接管。')
    } else {
      if (state.databaseCreated)
        throw new Error('已登记数据库缺失，拒绝自动重建。')
      await this.docker.psql(pg, 'postgres', MANAGER_ROLE, databaseSql(state))
    }
    await this.docker.psql(
      pg,
      'postgres',
      MANAGER_ROLE,
      'REVOKE CONNECT ON DATABASE postgres FROM PUBLIC; REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;'
    )
    await this.docker.psql(
      pg,
      state.database,
      state.role,
      `
      CREATE SCHEMA IF NOT EXISTS worktree_meta AUTHORIZATION ${state.role};
      CREATE TABLE IF NOT EXISTS worktree_meta.identity (id text PRIMARY KEY, nonce text NOT NULL, phase text NOT NULL);
      INSERT INTO worktree_meta.identity VALUES (${quoteSql(state.id)}, ${quoteSql(state.nonce)}, 'allocated') ON CONFLICT (id) DO NOTHING;
    `
    )
    state.databaseCreated = true
    await writeJson(this.statePath, state)
    const record = await this.docker.psql(
      pg,
      state.database,
      state.role,
      `SELECT json_build_object('id',id,'nonce',nonce,'phase',phase) FROM worktree_meta.identity;`
    )
    let identity
    try {
      identity = JSON.parse(record)
    } catch {
      throw new Error('开发数据库身份标记无效。')
    }
    if (
      identity.id !== state.id ||
      identity.nonce !== state.nonce ||
      !['allocated', 'schema', 'ready'].includes(identity.phase)
    ) {
      throw new Error('开发数据库身份或准备状态不符。')
    }
    return identity.phase
  }

  async writeEnvironment(state, env) {
    const path = join(this.identity.root, '.env')
    const previous = await readText(path, true)
    if (
      previous !== null &&
      ![state.envHash, state.pendingEnvHash].includes(digest(previous))
    ) {
      throw new Error(
        '.env 已被手动修改，拒绝覆盖；请先保存修改并将共享设置移入 .env.worktree.local。'
      )
    }
    const text = serializeEnv(env)
    state.pendingEnvHash = digest(text)
    await writeJson(this.statePath, state)
    await writePrivate(path, text)
    state.envHash = state.pendingEnvHash
    delete state.pendingEnvHash
    await writeJson(this.statePath, state)
  }

  async setup() {
    await privateDirectory(this.local)
    return withLock(join(this.local, 'setup.lock'), async () => {
      await fileInfo(join(this.identity.root, 'node_modules'))
      await fileInfo(join(this.identity.root, '.next'))
      const base =
        (await readText(
          join(this.identity.root, '.env.worktree.local'),
          true
        )) ??
        (await readText(join(this.identity.primary, '.env.worktree.local')))
      await this.docker.localEndpoint()
      const state = await this.allocate()
      if (!(await this.probe(state.appPort)))
        throw new Error('应用端口已占用，请先停止该 worktree 的开发服务。')
      const credentials = await this.credentials()
      this.log('准备 worktree 专用 PostgreSQL 与 Redis…')
      const pg = await this.postgres()
      const phase = await this.database(state, pg.resource, credentials)
      await writePrivate(
        join(this.local, 'redis.conf'),
        [
          'bind 0.0.0.0',
          'protected-mode yes',
          'appendonly yes',
          'maxmemory 128mb',
          'maxmemory-policy noeviction',
          `requirepass ${credentials.redisPassword}`,
          ''
        ].join('\n')
      )
      const redisInfo = await this.docker.ensure(
        state.redis,
        [
          '--publish',
          '127.0.0.1::6379',
          '--memory',
          '192m',
          '--volume',
          `${join(this.local, 'redis.conf')}:/run/otoame-redis.conf:ro`,
          REDIS_IMAGE,
          'sh',
          '-c',
          'cp /run/otoame-redis.conf /data/redis.conf && chmod 600 /data/redis.conf && chown redis:redis /data /data/redis.conf && exec docker-entrypoint.sh redis-server /data/redis.conf'
        ],
        () => writeJson(this.statePath, state)
      )
      await this.docker.ready(
        state.redis,
        [
          'sh',
          '-c',
          'read -r REDISCLI_AUTH; export REDISCLI_AUTH; exec redis-cli --raw ping'
        ],
        `${credentials.redisPassword}\n`,
        'PONG'
      )
      const env = buildApplicationEnv(
        base,
        state,
        credentials,
        pg.port,
        containerPort(redisInfo, 6379)
      )
      await this.writeEnvironment(state, env)
      const childEnv = { ...process.env, ...env }
      const command = (args, label, extras = {}) =>
        checked(
          this.runner,
          'pnpm',
          args,
          { cwd: state.root, env: { ...childEnv, ...extras } },
          label
        )
      this.log('安装当前分支依赖并生成 Prisma 客户端…')
      await command(['install', '--frozen-lockfile'], '安装依赖')
      if (phase !== 'ready') {
        await this.docker.psql(
          pg.resource,
          state.database,
          state.role,
          `DO $guard$
          DECLARE item record; occupied boolean;
          BEGIN
            FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
              EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)', item.tablename) INTO occupied;
              IF occupied THEN RAISE EXCEPTION 'worktree initialization requires empty business tables'; END IF;
            END LOOP;
          END $guard$;`
        )
        if (phase === 'allocated') {
          this.log('初始化空开发库结构…')
          await command(['exec', 'prisma', 'db', 'push'], '初始化开发结构')
          await this.docker.psql(
            pg.resource,
            state.database,
            state.role,
            `UPDATE worktree_meta.identity SET phase='schema' WHERE id=${quoteSql(state.id)};`
          )
        }
        for (const file of [
          'production-tag-company-count-sync-2026-08-30.sql',
          'production-tag-company-count-postflight-2026-08-30.sql'
        ])
          await this.docker.psql(
            pg.resource,
            state.database,
            state.role,
            await readText(join(state.root, 'migration', file))
          )
        await command(['migration:patch-counters'], '安装条目计数触发器')
        await command(
          ['exec', 'esno', 'scripts/worktreeSeed.ts'],
          '准备合成开发账号',
          {
            OTOAME_WORKTREE_NONCE: state.nonce,
            OTOAME_WORKTREE_PASSWORD: credentials.loginPassword
          }
        )
      }
      state.ready = true
      state.pgPort = pg.port
      state.redisPort = containerPort(redisInfo, 6379)
      await writeJson(this.statePath, state)
      this.log(
        `准备完成：${env.NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV}；账号凭据见 .worktree/secrets.json。`
      )
      return state
    })
  }

  async status() {
    const state = await this.load()
    const pg = await this.sharedState()
    const postgres = await this.docker.inspect(pg.name)
    const redis = await this.docker.inspect(state.redis.name)
    return {
      worktree: state.id,
      ready: state.ready,
      url: `http://127.0.0.1:${state.appPort}`,
      database: state.database,
      postgresRunning: Boolean(postgres?.id === pg.id && postgres.running),
      redisRunning: Boolean(redis?.id === state.redis.id && redis.running),
      s3Prefix: state.prefix,
      credentialsFile: '.worktree/secrets.json'
    }
  }

  async environment(state) {
    const text = await readText(join(state.root, '.env'))
    if (digest(text) !== state.envHash || !state.ready)
      throw new Error('开发配置已变化或尚未就绪，请先完成 setup。')
    const pg = await this.sharedState()
    for (const [resource, internalPort, expectedPort] of [
      [pg, 5432, state.pgPort],
      [state.redis, 6379, state.redisPort]
    ]) {
      const info = await this.docker.verify(resource)
      if (!info.running) throw new Error('开发容器未运行，请先重新执行 setup。')
      if (containerPort(info, internalPort) !== expectedPort) {
        throw new Error(
          '容器端口映射已变化，请重新执行 setup 更新本 worktree 配置。'
        )
      }
    }
    return { ...process.env, ...parseEnv(text) }
  }
}

const runtimePath = (manager) => join(manager.local, 'runtime.json')

export const serveDevelopment = async (manager) => {
  const state = await manager.load()
  const env = await manager.environment(state)
  if (!(await manager.probe(state.appPort)))
    throw new Error('应用端口已占用，拒绝启动第二个服务。')
  if ((await readText(join(state.root, '.next', 'dev', 'lock'), true)) !== null)
    throw new Error('当前工作区已有 Next 开发锁。')
  return withLock(join(manager.local, 'dev.lock'), async () => {
    const token = secret()
    let child
    let stopRequested = false
    const stop = () => {
      stopRequested = true
      if (child && child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
    }
    const server = createServer((socket) => {
      socket.setTimeout(2000, () => socket.destroy())
      let text = ''
      socket.on('data', (data) => {
        text += data
        if (text.length > 2048) return socket.destroy()
        if (!text.includes('\n')) return
        try {
          const request = JSON.parse(text)
          if (
            request.token !== token ||
            request.id !== state.id ||
            request.action !== 'stop'
          )
            return socket.destroy()
          stop()
          socket.end('accepted\n')
        } catch {
          socket.destroy()
        }
      })
      socket.on('error', () => {})
    })
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    await writeJson(runtimePath(manager), {
      id: state.id,
      token,
      port: server.address().port
    })
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    try {
      if (stopRequested) return 0
      const code = await new Promise((resolvePromise, reject) => {
        child = spawn(
          process.execPath,
          [
            join(state.root, 'node_modules', 'next', 'dist', 'bin', 'next'),
            'dev',
            '--turbo',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(state.appPort)
          ],
          {
            cwd: state.root,
            env,
            detached: true,
            stdio: 'inherit'
          }
        )
        child.once('error', () =>
          reject(new Error('无法启动本 worktree 的 Next 开发服务。'))
        )
        child.once('exit', (exitCode) =>
          resolvePromise(exitCode ?? (stopRequested ? 0 : 1))
        )
      })
      return code
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      server.close()
      await rm(runtimePath(manager), { force: true })
    }
  })
}

export const stopDevelopment = async (manager) => {
  const state = await manager.load()
  await manager.docker.verify(state.redis)
  const runtime = await readJson(runtimePath(manager), true)
  if (runtime) {
    if (runtime.id !== state.id || !/^[a-f0-9]{64}$/.test(runtime.token ?? ''))
      throw new Error('开发进程身份不符。')
    await new Promise((resolvePromise, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: runtime.port })
      socket.setTimeout(3000, () => socket.destroy(new Error('停止请求超时。')))
      socket.on('connect', () =>
        socket.write(
          JSON.stringify({
            id: state.id,
            token: runtime.token,
            action: 'stop'
          }) + '\n'
        )
      )
      socket.on('data', (data) => {
        if (String(data).trim() === 'accepted') {
          socket.end()
          resolvePromise()
        } else socket.destroy(new Error('开发进程未确认身份。'))
      })
      socket.on('error', () =>
        reject(new Error('无法确认开发进程，请在原终端停止服务后重试。'))
      )
    })
    for (let i = 0; i < 40 && !(await manager.probe(state.appPort)); i++)
      await pause(250)
  }
  if (!(await manager.probe(state.appPort)))
    throw new Error('应用端口仍被占用，拒绝停止未知进程或继续清理。')
  await manager.docker.command(
    ['stop', state.redis.id],
    undefined,
    '停止本 worktree 的 Redis'
  )
  manager.log(
    '本 worktree 服务已停止，数据库与数据卷保留，共享 PostgreSQL 继续运行。'
  )
}

const main = async () => {
  if (
    !['setup', 'dev', 'status', 'stop'].includes(process.argv[2]) ||
    process.argv.length !== 3
  ) {
    throw new Error('用法：node scripts/worktree.mjs setup|dev|status|stop')
  }
  if (process.platform === 'win32')
    throw new Error('本地管理器支持 macOS/Linux；Windows 请在 WSL 中运行。')
  const manager = new WorktreeManager(await context())
  switch (process.argv[2]) {
    case 'setup':
      await manager.setup()
      break
    case 'status':
      console.log(JSON.stringify(await manager.status(), null, 2))
      break
    case 'dev':
      process.exitCode = await serveDevelopment(manager)
      break
    case 'stop':
      await stopDevelopment(manager)
      break
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
