import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  realpath,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { parse as parseDotenv } from 'dotenv'
import {
  createIdentity,
  buildApplicationEnv,
  serializeEnv,
  assertContainer,
  containerPort,
  databaseMarker,
  isWorktreeLoginPassword,
  roleSql,
  databaseSql
} from '~/scripts/worktree/config.mjs'
import {
  WorktreeManager,
  context,
  destroyWorktree
} from '~/scripts/worktree.mjs'
import {
  readJson,
  writeJson,
  withLock,
  Docker
} from '~/scripts/worktree/runtime.mjs'
import { getDatabasePoolMax } from '~/config/database'

const directories: string[] = []
beforeEach(() => {
  vi.stubEnv('DOCKER_HOST', undefined)
  vi.stubEnv('DOCKER_CONTEXT', undefined)
})
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
  vi.unstubAllEnvs()
})

const fixture = async () => {
  const primary = await realpath(
    await mkdtemp(join(tmpdir(), 'otoame-worktree-test-'))
  )
  directories.push(primary)
  const root = join(primary, 'checkout-a')
  await mkdir(root)
  await mkdir(join(root, 'migration'))
  for (const file of [
    'production-tag-company-count-sync-2026-08-30.sql',
    'production-tag-company-count-postflight-2026-08-30.sql'
  ]) {
    await writeFile(join(root, 'migration', file), '-- synthetic SQL fixture')
  }
  await writeFile(
    join(primary, '.env.worktree.local'),
    'KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME="synthetic"\n'
  )
  return { primary, root, identity: createIdentity(root, primary) }
}

class FakeServices {
  containers = new Map<string, any>()
  volumes = new Map<string, any>()
  role: { marker: string; safe: boolean } | null = null
  owner: { role: string; marker: string } | null = null
  databasePhase = 'allocated'
  seedCount = 0
  pushCount = 0
  counterFailure = false
  removeVolumeFailure = false
  dropRoleFailure = false
  statements: string[] = []
  calls: Array<{ command: string; args: string[]; options: any }> = []

  run = async (command: string, args: string[], options: any = {}) => {
    this.calls.push({ command, args, options })
    if (args[0] === '--host') args = args.slice(2)
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    const missing = (stderr: string) => ({ code: 1, stdout: '', stderr })
    if (command === 'docker' && args[0] === 'context')
      return ok('unix:///synthetic/docker.sock')
    if (command === 'pnpm') {
      if (args.includes('push')) this.pushCount++
      if (args.includes('migration:patch-counters') && this.counterFailure)
        return missing('synthetic secret must not reach logs')
      if (args.includes('scripts/worktreeSeed.ts')) {
        this.seedCount++
        this.databasePhase = 'ready'
      }
      return ok()
    }
    if (args[0] === 'volume' && args[1] === 'inspect') {
      const value = this.volumes.get(args.at(-1)!)
      return value ? ok(JSON.stringify(value)) : missing('No such volume')
    }
    if (args[0] === 'volume' && args[1] === 'create') {
      const labels: Record<string, string> = {}
      args.forEach((arg, index) => {
        if (arg === '--label') {
          const [key, ...value] = args[index + 1].split('=')
          labels[key] = value.join('=')
        }
      })
      this.volumes.set(args.at(-1)!, labels)
      return ok(args.at(-1)!)
    }
    if (args[0] === 'volume' && args[1] === 'rm') {
      if (this.removeVolumeFailure) return missing('synthetic volume failure')
      this.volumes.delete(args.at(-1)!)
      return ok()
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      const value = this.containers.get(args.at(-1)!)
      return value ? ok(JSON.stringify(value)) : missing('No such container')
    }
    if (args[0] === 'container' && args[1] === 'create') {
      const name = args[args.indexOf('--name') + 1]
      const labels: Record<string, string> = {}
      args.forEach((arg, index) => {
        if (arg === '--label') {
          const [key, ...value] = args[index + 1].split('=')
          labels[key] = value.join('=')
        }
      })
      const pg = args.includes('postgres:16')
      const resource = {
        id: String(this.containers.size + 1).padStart(64, '0'),
        labels,
        running: false,
        ports: {
          [pg ? '5432/tcp' : '6379/tcp']: [
            { HostIp: '127.0.0.1', HostPort: pg ? '55432' : '56380' }
          ]
        }
      }
      this.containers.set(name, resource)
      return ok(resource.id)
    }
    if (args[0] === 'start') {
      const item = [...this.containers.values()].find(
        (value) => value.id === args[1]
      )
      item.running = true
      return ok()
    }
    if (args[0] === 'stop' || args[0] === 'rm') {
      const entry = [...this.containers].find(
        ([, value]) => value.id === args[1]
      )
      if (!entry) return missing('No such container')
      if (args[0] === 'stop') entry[1].running = false
      else this.containers.delete(entry[0])
      return ok()
    }
    if (args.includes('psql')) {
      const sql: string = options.input
      this.statements.push(sql)
      if (sql.includes('FROM pg_database'))
        return ok(this.owner ? JSON.stringify(this.owner) : '')
      if (sql.includes('FROM pg_roles'))
        return ok(this.role ? JSON.stringify(this.role) : '')
      if (sql.includes('CREATE ROLE'))
        this.role = {
          marker: sql.match(/COMMENT ON ROLE \S+ IS '([^']+)'/)![1],
          safe: true
        }
      if (sql.includes('CREATE DATABASE'))
        this.owner = {
          role: sql.match(/OWNER (\w+)/)![1],
          marker: sql.match(/COMMENT ON DATABASE \S+ IS '([^']+)'/)![1]
        }
      if (sql.startsWith('DROP DATABASE')) this.owner = null
      if (sql.startsWith('DROP ROLE')) {
        if (this.dropRoleFailure) return missing('synthetic role failure')
        this.role = null
      }
      if (sql.includes("SET phase='schema'")) this.databasePhase = 'schema'
      if (sql.includes("json_build_object('id'")) {
        const marker = this.owner!.marker.split(':')
        return ok(
          JSON.stringify({
            id: marker[1],
            nonce: marker[2],
            phase: this.databasePhase
          })
        )
      }
      return ok()
    }
    return ok(args.includes('sh') ? 'PONG' : '')
  }
}

describe('worktree configuration', () => {
  it('accepts the fixed development password and existing random credentials', () => {
    expect(isWorktreeLoginPassword('test1234')).toBe(true)
    expect(isWorktreeLoginPassword('a'.repeat(64))).toBe(true)
    for (const value of [
      '',
      undefined,
      null,
      'arbitrary-password',
      'test1234 '
    ])
      expect(isWorktreeLoginPassword(value)).toBe(false)
  })
  it('rejects remote Docker endpoints before any container operation', async () => {
    vi.stubEnv('DOCKER_HOST', 'ssh://remote.example.invalid')
    const runner = vi.fn()
    await expect(
      new Docker(runner).command(['container', 'create', 'redis:7'])
    ).rejects.toThrow('本机 Unix socket')
    expect(runner).not.toHaveBeenCalled()
  })

  it('rejects a remote named context and pins an accepted local endpoint for later calls', async () => {
    vi.stubEnv('DOCKER_CONTEXT', 'remote-test')
    const remote = vi.fn(async () => ({
      code: 0,
      stdout: 'tcp://remote.example.invalid:2376',
      stderr: ''
    }))
    await expect(
      new Docker(remote).command(['start', 'synthetic'])
    ).rejects.toThrow('本机 Unix socket')
    expect(remote).toHaveBeenCalledOnce()

    vi.stubEnv('DOCKER_CONTEXT', undefined)
    vi.stubEnv('DOCKER_HOST', 'unix:///synthetic/local.sock')
    const runner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    const docker = new Docker(runner)
    await docker.localEndpoint()
    vi.stubEnv('DOCKER_HOST', 'ssh://changed.example.invalid')
    await docker.command(['version'])
    expect(runner.mock.calls[0]).toEqual([
      'docker',
      ['--host', 'unix:///synthetic/local.sock', 'version'],
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_HOST: 'unix:///synthetic/local.sock',
          DOCKER_CONTEXT: ''
        })
      })
    ])
  })

  it('isolates generated values and ignores inherited production/deployment settings', () => {
    const identity = createIdentity('/repo/feature', '/repo/main')
    const state = { ...identity, appPort: 3301 }
    const credentials = {
      databasePassword: 'db-test',
      redisPassword: 'redis-test',
      jwtSecret: 'jwt-test'
    }
    const env = buildApplicationEnv(
      [
        'KUN_DATABASE_URL=postgresql://production.invalid/private',
        'REDIS_HOST=production.invalid',
        'JWT_SECRET=shared',
        'GITHUB_TOKEN=deployment-test',
        'KUN_CF_CACHE_PURGE_API_TOKEN=remote-test',
        'KUN_ENABLE_CRON=true',
        'KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME=development-bucket'
      ].join('\n'),
      state,
      credentials,
      55432,
      56380
    )
    expect(new URL(env.KUN_DATABASE_URL).pathname).toBe(`/${identity.database}`)
    expect(new URL(env.KUN_DATABASE_URL).hostname).toBe('127.0.0.1')
    expect(env).toMatchObject({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '56380',
      REDIS_PASSWORD: 'redis-test',
      JWT_SECRET: 'jwt-test',
      KUN_DATABASE_POOL_MAX: '5',
      KUN_ENABLE_CRON: 'false',
      KUN_CF_CACHE_PURGE_API_TOKEN: '',
      KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX: identity.prefix,
      NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV: 'http://127.0.0.1:3301'
    })
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
    expect(serializeEnv(env)).not.toContain('production.invalid')
  })

  it('round-trips credentials through both Node and dotenv without interpreting shell text', () => {
    const values = {
      TOKEN: 'literal\\nvalue',
      PASSWORD: "with'quote\\n",
      BODY: 'line1\nline2',
      TEXT: '`$(literal)`'
    }
    expect(parseEnv(serializeEnv(values))).toEqual(values)
    expect(parseDotenv(serializeEnv(values))).toEqual(values)
  })

  it('refuses the primary checkout and foreign containers or non-loopback port bindings', () => {
    expect(() => createIdentity('/repo', '/repo')).toThrow('主仓库')
    expect(() =>
      assertContainer({ id: 'other', labels: {} }, { own: 'yes' }, 'expected')
    ).toThrow('身份')
    expect(() =>
      containerPort(
        { ports: { '6379/tcp': [{ HostIp: '0.0.0.0', HostPort: '6379' }] } },
        6379
      )
    ).toThrow('127.0.0.1')
  })

  it('creates restricted application roles and revokes shared database access', () => {
    const state = {
      ...createIdentity('/repo/feature', '/repo'),
      nonce: 'a'.repeat(64)
    }
    expect(roleSql(state, 'test-only')).toContain(
      'NOSUPERUSER NOCREATEDB NOCREATEROLE'
    )
    expect(databaseSql(state)).toContain(
      `REVOKE ALL ON DATABASE ${state.database} FROM PUBLIC`
    )
    expect(databaseSql(state)).toContain(databaseMarker(state))
  })

  it('keeps the production pool default and supports a smaller bounded worktree pool', () => {
    vi.stubEnv('KUN_DATABASE_POOL_MAX', undefined)
    expect(getDatabasePoolMax()).toBe(30)
    expect(getDatabasePoolMax('5')).toBe(5)
    for (const value of ['0', '-1', '1.5', 'NaN', '1001', ' 5']) {
      expect(() => getDatabasePoolMax(value)).toThrow('KUN_DATABASE_POOL_MAX')
    }
  })
})

describe('managed worktree destruction', () => {
  const prepared = async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const state = await manager.setup()
    return { manager, services, state }
  }

  it('removes only its Redis, database, role and allocation while keeping shared PostgreSQL', async () => {
    const { manager, services, state } = await prepared()
    await destroyWorktree(manager)
    expect(services.containers.has(state.redis.name)).toBe(false)
    expect(services.volumes.has(state.redis.volume)).toBe(false)
    expect(services.containers.has(state.postgresName)).toBe(true)
    expect(services.volumes.has(`${state.postgresName}-data`)).toBe(true)
    expect(services.owner).toBeNull()
    expect(services.role).toBeNull()
    expect(
      await readJson(join(manager.shared, 'ports.json'))
    ).not.toHaveProperty(state.id)
    expect(await readJson(manager.statePath)).toMatchObject({
      destroyed: true,
      ready: false
    })
    await expect(manager.setup()).rejects.toThrow('销毁')
    const calls = services.calls.length
    await destroyWorktree(manager)
    expect(services.calls).toHaveLength(calls)
  })

  it.each(['container', 'volume', 'database', 'role'])(
    'rejects foreign %s ownership before deleting any resources',
    async (kind) => {
      const { manager, services, state } = await prepared()
      if (kind === 'container')
        services.containers.get(state.redis.name).id = 'f'.repeat(64)
      if (kind === 'volume') services.volumes.set(state.redis.volume, {})
      if (kind === 'database') services.owner!.marker = 'foreign'
      if (kind === 'role') services.role!.marker = 'foreign'
      const start = services.calls.length
      await expect(destroyWorktree(manager)).rejects.toThrow()
      expect(
        services.calls
          .slice(start)
          .some(({ args }) => args.includes('rm') || args[2] === 'stop')
      ).toBe(false)
      expect(services.statements.some((sql) => sql.startsWith('DROP '))).toBe(
        false
      )
      expect(await readJson(join(manager.shared, 'ports.json'))).toHaveProperty(
        state.id
      )
    }
  )

  it('resumes after Redis removal succeeds but volume removal fails', async () => {
    const { manager, services, state } = await prepared()
    services.removeVolumeFailure = true
    await expect(destroyWorktree(manager)).rejects.toThrow('退出码')
    expect(services.containers.has(state.redis.name)).toBe(false)
    expect(await readJson(join(manager.shared, 'ports.json'))).toHaveProperty(
      state.id
    )
    services.removeVolumeFailure = false
    await destroyWorktree(manager)
    expect(services.owner).toBeNull()
    expect(services.volumes.has(state.redis.volume)).toBe(false)
  })

  it('resumes after the database was removed but role deletion failed', async () => {
    const { manager, services, state } = await prepared()
    services.dropRoleFailure = true
    await expect(destroyWorktree(manager)).rejects.toThrow('退出码')
    expect(services.owner).toBeNull()
    expect(services.role).not.toBeNull()
    expect(await readJson(join(manager.shared, 'ports.json'))).toHaveProperty(
      state.id
    )
    services.dropRoleFailure = false
    await destroyWorktree(manager)
    expect(services.role).toBeNull()
  })

  it('preserves neighboring allocations and releases a completed allocation on retry', async () => {
    const { manager, state } = await prepared()
    const registryPath = join(manager.shared, 'ports.json')
    const ownEntry = { root: state.root, port: state.appPort }
    const neighbor = { root: '/synthetic/neighbor', port: 3400 }
    await writeJson(registryPath, {
      [state.id]: ownEntry,
      abcdef012345: neighbor
    })
    await destroyWorktree(manager)
    expect(await readJson(registryPath)).toEqual({ abcdef012345: neighbor })
    await writeJson(registryPath, {
      [state.id]: ownEntry,
      abcdef012345: neighbor
    })
    await destroyWorktree(manager)
    expect(await readJson(registryPath)).toEqual({ abcdef012345: neighbor })
  })

  it('can clean an allocation whose setup never created infrastructure', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const state = await manager.allocate()
    await destroyWorktree(manager)
    expect(services.containers.size).toBe(0)
    expect(
      await readJson(join(manager.shared, 'ports.json'))
    ).not.toHaveProperty(state.id)
  })

  it('refuses an unknown listener and retains all resources for diagnosis', async () => {
    const { manager, services, state } = await prepared()
    manager.probe = async () => false
    await expect(destroyWorktree(manager)).rejects.toThrow('应用端口仍被占用')
    expect(services.containers.get(state.redis.name).running).toBe(true)
    expect(services.owner).not.toBeNull()
    await expect(manager.environment(await manager.load())).rejects.toThrow(
      '销毁'
    )
  })

  it('requires a matching allocation before attempting any deletion', async () => {
    const { manager, services, state } = await prepared()
    await writeJson(join(manager.shared, 'ports.json'), {
      [state.id]: { root: '/foreign', port: state.appPort }
    })
    const calls = services.calls.length
    await expect(destroyWorktree(manager)).rejects.toThrow('端口登记')
    expect(services.calls).toHaveLength(calls)
  })

  it('skips an unmanaged worktree without using Docker', async () => {
    const { identity } = await fixture()
    const runner = vi.fn()
    const manager = new WorktreeManager(identity, { run: runner, log: vi.fn() })
    await destroyWorktree(manager)
    expect(runner).not.toHaveBeenCalled()
  })

  it('refuses lost local identity and leaves the shared allocation intact', async () => {
    const { manager, services, state } = await prepared()
    await rm(manager.statePath)
    const calls = services.calls.length
    await expect(destroyWorktree(manager)).rejects.toThrow('身份记录')
    expect(services.calls).toHaveLength(calls)
    expect(await readJson(join(manager.shared, 'ports.json'))).toHaveProperty(
      state.id
    )
  })

  it('does not destroy while setup owns the lifecycle lock', async () => {
    const { manager, services } = await prepared()
    const calls = services.calls.length
    await withLock(join(manager.local, 'setup.lock'), async () => {
      await expect(destroyWorktree(manager)).rejects.toThrow('操作锁')
    })
    expect(services.calls).toHaveLength(calls)
  })
})

describe('managed worktree setup', () => {
  it('reuses database, credentials and ports without resetting or reseeding on a second setup', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const first = await manager.setup()
    const credentials = await readFile(manager.secretsPath, 'utf8')
    expect(JSON.parse(credentials).loginPassword).toBe('test1234')
    expect(JSON.parse(credentials).databasePassword).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(credentials).redisPassword).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(credentials).jwtSecret).toMatch(/^[a-f0-9]{64}$/)
    const env = await readFile(join(identity.root, '.env'), 'utf8')
    const second = await manager.setup()
    expect(second).toMatchObject({
      id: first.id,
      appPort: first.appPort,
      nonce: first.nonce,
      ready: true
    })
    expect(await readFile(manager.secretsPath, 'utf8')).toBe(credentials)
    expect(await readFile(join(identity.root, '.env'), 'utf8')).toBe(env)
    expect(services.pushCount).toBe(1)
    expect(services.seedCount).toBe(1)
    expect(
      services.calls.some(({ args }) =>
        args.some((arg) => /force-reset|accept-data-loss/.test(arg))
      )
    ).toBe(false)
    expect((await stat(join(identity.root, '.env'))).mode & 0o777).toBe(0o600)
    const status = await manager.status()
    expect(JSON.stringify(status)).not.toContain(
      JSON.parse(credentials).databasePassword
    )
    expect(status).toMatchObject({
      ready: true,
      postgresRunning: true,
      redisRunning: true
    })
  })

  it('preserves existing random login credentials when setup is repeated', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await manager.allocate()
    const legacy = {
      ...(await manager.credentials()),
      loginPassword: 'a'.repeat(64)
    }
    await writeJson(manager.secretsPath, legacy)
    await manager.setup()
    expect(
      services.calls.find(({ args }) =>
        args.includes('scripts/worktreeSeed.ts')
      )?.options.env.OTOAME_WORKTREE_PASSWORD
    ).toBe(legacy.loginPassword)
    await manager.setup()
    expect((await manager.credentials()).loginPassword).toBe(
      legacy.loginPassword
    )
    expect(services.seedCount).toBe(1)
  })

  it('preserves an existing unmanaged .env without starting containers', async () => {
    const { identity } = await fixture()
    await writeFile(join(identity.root, '.env'), 'PRIVATE=synthetic-existing')
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await expect(manager.setup()).rejects.toThrow('拒绝覆盖')
    expect(services.containers.size).toBe(0)
    expect(await readFile(join(identity.root, '.env'), 'utf8')).toBe(
      'PRIVATE=synthetic-existing'
    )
  })

  it('refuses state directories that lead through a symlink', async () => {
    const { identity, primary } = await fixture()
    const elsewhere = join(primary, 'elsewhere')
    await mkdir(elsewhere)
    await symlink(elsewhere, join(identity.root, '.worktree'))
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true
    })
    await expect(manager.setup()).rejects.toThrow('符号链接')
    expect(services.calls).toEqual([])
  })

  it('refuses linked dependency directories before installing into another checkout', async () => {
    const { identity, primary } = await fixture()
    const dependencies = join(primary, 'dependencies')
    await mkdir(dependencies)
    await symlink(dependencies, join(identity.root, 'node_modules'))
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true
    })
    await expect(manager.setup()).rejects.toThrow('符号链接')
    expect(services.calls).toEqual([])
  })

  it('does not reuse an application port after its shared allocation record is lost', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await manager.setup()
    await rm(join(manager.shared, 'ports.json'))
    await expect(manager.setup()).rejects.toThrow('端口登记')
  })

  it('refuses a replaced container rather than adopting it', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const state = await manager.setup()
    services.containers.get(state.redis.name).id = 'f'.repeat(64)
    await expect(manager.setup()).rejects.toThrow('被替换')
    expect(services.seedCount).toBe(1)
  })

  it('rejects altered nested ownership records before operating on a container', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const state = await manager.setup()
    state.redis.labels = {}
    await writeJson(manager.statePath, state)
    const commandsBefore = services.calls.length
    await expect(manager.setup()).rejects.toThrow('Redis 身份记录')
    expect(services.calls.length).toBe(commandsBefore)
  })

  it('requires configuration refresh after a container host port changes', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    const state = await manager.setup()
    services.containers.get(state.redis.name).ports['6379/tcp'][0].HostPort =
      '56381'
    await expect(manager.environment(state)).rejects.toThrow('端口映射已变化')
    const updated = await manager.setup()
    expect(
      parseEnv(await readFile(join(identity.root, '.env'), 'utf8')).REDIS_PORT
    ).toBe('56381')
    expect((await manager.environment(updated)).REDIS_PORT).toBe('56381')
    expect(services.seedCount).toBe(1)
  })

  it('uses the saved Orca primary checkout when later commands have no setup variables', async () => {
    const { identity, primary } = await fixture()
    await mkdir(join(primary, '.git'))
    await writeJson(join(identity.root, '.worktree', 'state.json'), { primary })
    vi.stubEnv('ORCA_ROOT_PATH', undefined)
    vi.stubEnv('ORCA_WORKTREE_PATH', undefined)
    const runner = vi.fn(async (_command: string, args: string[]) => ({
      code: 0,
      stderr: '',
      stdout: args.includes('--show-toplevel')
        ? identity.root
        : join(primary, '.git')
    }))
    expect(await context(identity.root, runner)).toEqual(identity)
    expect(runner.mock.calls.some(([, args]) => args[0] === 'worktree')).toBe(
      false
    )
  })

  it('keeps a manually edited environment intact', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await manager.setup()
    await writeFile(join(identity.root, '.env'), 'PRIVATE=synthetic-edited')
    await expect(manager.setup()).rejects.toThrow('手动修改')
    expect(await readFile(join(identity.root, '.env'), 'utf8')).toBe(
      'PRIVATE=synthetic-edited'
    )
  })

  it('resumes after a failed initialization without resetting the installed schema', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    services.counterFailure = true
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await expect(manager.setup()).rejects.toThrow('条目计数')
    expect((await readJson(manager.statePath)).ready).toBe(false)
    services.counterFailure = false
    await manager.setup()
    expect(services.pushCount).toBe(1)
    expect(services.seedCount).toBe(1)
  })

  it('refuses a foreign database with a colliding name', async () => {
    const { identity } = await fixture()
    const services = new FakeServices()
    services.owner = { role: 'someone_else', marker: 'foreign' }
    const manager = new WorktreeManager(identity, {
      run: services.run,
      portAvailable: async () => true,
      log: vi.fn()
    })
    await expect(manager.setup()).rejects.toThrow('拒绝接管')
    expect(services.pushCount).toBe(0)
    expect(services.seedCount).toBe(0)
  })

  it('waits for another shared operation rather than failing on ordinary lock contention', async () => {
    const { primary } = await fixture()
    const lock = join(primary, 'lock')
    const sequence: number[] = []
    let started!: () => void
    const acquired = new Promise<void>((resolve) => {
      started = resolve
    })
    const first = withLock(lock, async () => {
      sequence.push(1)
      started()
      await new Promise((resolve) => setTimeout(resolve, 80))
      sequence.push(2)
    })
    await acquired
    await Promise.all([
      first,
      withLock(
        lock,
        async () => {
          sequence.push(3)
        },
        1000
      )
    ])
    expect(sequence).toEqual([1, 2, 3])
  })

  it('allocates distinct stable ports and identities for concurrent worktrees', async () => {
    const { primary, identity } = await fixture()
    const secondRoot = join(primary, 'checkout-b')
    await mkdir(secondRoot)
    const first = new WorktreeManager(identity, {
      portAvailable: async () => true
    })
    const second = new WorktreeManager(createIdentity(secondRoot, primary), {
      portAvailable: async () => true
    })
    const states = await Promise.all([first.allocate(), second.allocate()])
    expect(new Set(states.map((state) => state.appPort)).size).toBe(2)
    expect(new Set(states.map((state) => state.database)).size).toBe(2)
    expect(new Set(states.map((state) => state.redisName)).size).toBe(2)
    expect(new Set(states.map((state) => state.postgresName)).size).toBe(1)
    expect((await first.allocate()).appPort).toBe(states[0].appPort)
  })
})
