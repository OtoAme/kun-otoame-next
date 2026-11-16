import { join } from 'node:path'
import {
  assertContainer,
  databaseMarker,
  MANAGER_ROLE,
  quoteSql
} from './config.mjs'
import { readJson, withLock, writeJson } from './runtime.mjs'

const allocation = (registry, state) => {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry))
    throw new Error('共享端口登记缺失或损坏，拒绝销毁。')
  const entry = registry[state.id]
  if (entry && (entry.root !== state.root || entry.port !== state.appPort))
    throw new Error('共享端口登记与当前 worktree 不符，拒绝销毁。')
  if (!entry && !state.destroyed)
    throw new Error('共享端口登记缺失，拒绝销毁。')
}

const redis = async (manager, state) => {
  const info = await manager.docker.inspect(state.redis.name)
  if (info) assertContainer(info, state.redis.labels, state.redis.id)
  await manager.docker.inspectVolume(state.redis.volume, state.redis.labels)
  return info
}

const ownership = async (manager, state, pg) => {
  const marker = databaseMarker(state)
  const query = (sql) => manager.docker.psql(pg, 'postgres', MANAGER_ROLE, sql)
  const ownerText = await query(
    `SELECT json_build_object('role', pg_get_userbyid(datdba), 'marker', shobj_description(oid, 'pg_database')) FROM pg_database WHERE datname=${quoteSql(state.database)};`
  )
  const roleText = await query(
    `SELECT json_build_object('marker', shobj_description(oid, 'pg_authid'), 'safe', NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) FROM pg_roles WHERE rolname=${quoteSql(state.role)};`
  )
  let owner, role
  try {
    owner = ownerText ? JSON.parse(ownerText) : null
    role = roleText ? JSON.parse(roleText) : null
  } catch {
    throw new Error('数据库归属记录无效，拒绝销毁。')
  }
  if (owner && (owner.role !== state.role || owner.marker !== marker))
    throw new Error('数据库不属于当前 worktree，拒绝销毁。')
  if (role && (role.marker !== marker || role.safe !== true))
    throw new Error('数据库账号不属于当前 worktree 或权限过高，拒绝销毁。')
  if (owner && !role) throw new Error('数据库账号身份缺失，拒绝销毁。')
  return { owner, role }
}

const postgres = async (manager, state) => {
  const recorded = await readJson(manager.sharedPath, true)
  if (!recorded) {
    if (
      state.databaseCreated ||
      (await manager.docker.inspect(state.postgresName))
    )
      throw new Error('共享 PostgreSQL 身份记录缺失，拒绝销毁。')
    return null
  }
  const pg = await manager.sharedState()
  const info = await manager.docker.inspect(pg.name)
  if (!info && !pg.id && !state.databaseCreated) return null
  assertContainer(info, pg.labels, pg.id)
  if (!pg.id) throw new Error('共享 PostgreSQL 容器身份未登记，拒绝销毁。')
  if (!info.running) {
    await manager.docker.command(
      ['start', pg.id],
      undefined,
      '启动共享 PostgreSQL'
    )
    await manager.docker.ready(pg, [
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      MANAGER_ROLE,
      '-d',
      'postgres'
    ])
  }
  await ownership(manager, state, pg)
  return pg
}

export const destroyManagedWorktree = async (manager, stopApplication) =>
  withLock(join(manager.local, 'setup.lock'), () =>
    withLock(
      join(manager.shared, 'lock'),
      async () => {
        const state = await readJson(manager.statePath, true)
        const registryPath = join(manager.shared, 'ports.json')
        const registry = await readJson(registryPath, true)
        if (!state) {
          if (registry?.[manager.identity.id])
            throw new Error(
              'worktree 身份记录缺失但端口仍已登记，拒绝跳过清理。'
            )
          manager.log('当前 worktree 未受管，无需清理开发资源。')
          return
        }
        // load validates names, paths, nonce, labels and identifiers before deletion.
        await manager.load()
        allocation(registry, state)
        if (state.destroyed) {
          if (registry[state.id]) {
            delete registry[state.id]
            await writeJson(registryPath, registry)
          }
          manager.log('本 worktree 开发资源已销毁。')
          return
        }
        await manager.docker.localEndpoint()
        await redis(manager, state)
        const pg = await postgres(manager, state)
        state.destroying = true
        state.ready = false
        await writeJson(manager.statePath, state)
        await stopApplication(manager, state)
        return withLock(
          join(manager.local, 'dev.lock'),
          async () => {
            // Recheck after the launcher has exited and its lifetime lock is held.
            const info = await redis(manager, state)
            if (pg) await ownership(manager, state, pg)
            if (info) {
              if (info.running)
                await manager.docker.command(
                  ['stop', info.id],
                  undefined,
                  '停止本 worktree 的 Redis'
                )
              await manager.docker.verify(state.redis)
              await manager.docker.command(
                ['rm', info.id],
                undefined,
                '删除本 worktree 的 Redis'
              )
            }
            if (
              await manager.docker.inspectVolume(
                state.redis.volume,
                state.redis.labels
              )
            )
              await manager.docker.command(
                ['volume', 'rm', state.redis.volume],
                undefined,
                '删除本 worktree 的 Redis 数据卷'
              )
            if (pg) {
              const current = await ownership(manager, state, pg)
              if (current.owner)
                await manager.docker.psql(
                  pg,
                  'postgres',
                  MANAGER_ROLE,
                  `DROP DATABASE ${state.database} WITH (FORCE);`
                )
              const remaining = await ownership(manager, state, pg)
              if (remaining.owner)
                throw new Error('数据库仍然存在，销毁未完成。')
              if (remaining.role)
                await manager.docker.psql(
                  pg,
                  'postgres',
                  MANAGER_ROLE,
                  `DROP ROLE ${state.role};`
                )
              const final = await ownership(manager, state, pg)
              if (final.owner || final.role)
                throw new Error('数据库或账号仍然存在，销毁未完成。')
            }
            // Persist completion before releasing the allocation so retries also work
            // if the process exits between these two writes.
            state.destroyed = true
            state.destroying = false
            await writeJson(manager.statePath, state)
            delete registry[state.id]
            await writeJson(registryPath, registry)
            manager.log(
              '本 worktree 的 Redis、数据卷、数据库和账号已销毁，端口登记已释放；共享 PostgreSQL 保留。'
            )
          },
          30_000
        )
      },
      30_000
    )
  )
