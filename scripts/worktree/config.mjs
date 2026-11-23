import { createHash, randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'

export const VERSION = 1
export const LABEL = 'com.otoame.worktree'
export const PG_IMAGE = 'postgres:16'
export const REDIS_IMAGE = 'redis:7'
export const MANAGER_ROLE = 'otoame_manager'
export const WORKTREE_LOGIN_PASSWORD = 'test1234'

export const isWorktreeLoginPassword = (value) =>
  typeof value === 'string' &&
  (value === WORKTREE_LOGIN_PASSWORD || /^[a-f0-9]{64}$/.test(value))

const SHARED_KEYS = [
  'JWT_ISS',
  'JWT_AUD',
  'KUN_VISUAL_NOVEL_EMAIL_FROM',
  'KUN_VISUAL_NOVEL_EMAIL_HOST',
  'KUN_VISUAL_NOVEL_EMAIL_PORT',
  'KUN_VISUAL_NOVEL_EMAIL_ACCOUNT',
  'KUN_VISUAL_NOVEL_EMAIL_PASSWORD',
  'KUN_VISUAL_NOVEL_S3_STORAGE_ACCESS_KEY_ID',
  'KUN_VISUAL_NOVEL_S3_STORAGE_SECRET_ACCESS_KEY',
  'KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME',
  'KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT',
  'KUN_VISUAL_NOVEL_S3_STORAGE_REGION',
  'NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL',
  'KUN_VISUAL_NOVEL_IMAGE_BED_HOST',
  'KUN_VISUAL_NOVEL_IMAGE_BED_URL',
  'BANGUMI_ACCESS_TOKEN',
  'KUN_NEXTMOE_API_KEY',
  'KUN_GALLERY_FFMPEG_PATH'
]

export const digest = (text) => createHash('sha256').update(text).digest('hex')
export const secret = () => randomBytes(32).toString('hex')

export const createIdentity = (root, primary) => {
  if (root === primary)
    throw new Error('请在独立 worktree 中运行，主仓库不属于初始化对象。')
  const repoId = digest(primary).slice(0, 12)
  const id = digest(`${primary}\0${root}`).slice(0, 12)
  return {
    version: VERSION,
    id,
    repoId,
    root,
    primary,
    database: `otoame_wt_${id}`,
    role: `otoame_wt_${id}`,
    redisName: `otoame-redis-${id}`,
    postgresName: `otoame-pg-${repoId}`,
    prefix: `worktrees/${id}`
  }
}

export const assertState = (state, identity) => {
  for (const key of [
    'version',
    'id',
    'repoId',
    'root',
    'primary',
    'database',
    'role',
    'redisName',
    'postgresName',
    'prefix'
  ]) {
    if (state[key] !== identity[key])
      throw new Error('worktree 状态与当前目录不符，拒绝复用。')
  }
  if (!/^[a-f0-9]{64}$/.test(state.nonce ?? ''))
    throw new Error('worktree 身份记录损坏。')
  if (
    !Number.isInteger(state.appPort) ||
    state.appPort < 3300 ||
    state.appPort > 49999
  ) {
    throw new Error('worktree 应用端口记录损坏。')
  }
  const redis = state.redis
  const labels = {
    [`${LABEL}.repo`]: identity.repoId,
    [`${LABEL}.owner`]: identity.id,
    [`${LABEL}.nonce`]: state.nonce,
    [`${LABEL}.kind`]: 'redis'
  }
  if (
    redis?.name !== identity.redisName ||
    redis?.volume !== `${identity.redisName}-data` ||
    Object.entries(labels).some(
      ([key, value]) => redis.labels?.[key] !== value
    ) ||
    (redis.id !== undefined && !/^[a-f0-9]{64}$/.test(redis.id))
  ) {
    throw new Error('worktree Redis 身份记录损坏。')
  }
}

export const assertContainer = (info, expected, containerId) => {
  if (!info || (containerId && info.id !== containerId)) {
    throw new Error('容器身份缺失或已被替换，拒绝操作。')
  }
  for (const [key, value] of Object.entries(expected)) {
    if (info.labels?.[key] !== value)
      throw new Error('同名容器不属于本次 worktree，拒绝操作。')
  }
}

export const containerPort = (info, port) => {
  const bindings = info.ports?.[`${port}/tcp`]
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0].HostIp !== '127.0.0.1'
  ) {
    throw new Error('容器端口必须唯一绑定到 127.0.0.1。')
  }
  const value = Number(bindings[0].HostPort)
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('容器端口无效。')
  return value
}

export const buildApplicationEnv = (
  baseText,
  state,
  credentials,
  pgPort,
  redisPort
) => {
  const base = parseEnv(baseText)
  const result = Object.fromEntries(
    SHARED_KEYS.map((key) => [key, base[key] ?? ''])
  )
  const origin = `http://127.0.0.1:${state.appPort}`
  const url = new URL(`postgresql://127.0.0.1:${pgPort}/${state.database}`)
  url.username = state.role
  url.password = credentials.databasePassword
  url.searchParams.set('schema', 'public')
  return {
    ...result,
    JWT_ISS: base.JWT_ISS || 'otoame',
    JWT_AUD: base.JWT_AUD || 'otoame_admin',
    JWT_SECRET: credentials.jwtSecret,
    NODE_ENV: 'development',
    HOSTNAME: '127.0.0.1',
    PORT: String(state.appPort),
    KUN_DATABASE_URL: url.toString(),
    KUN_DATABASE_POOL_MAX: '5',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_PASSWORD: credentials.redisPassword,
    KUN_VISUAL_NOVEL_SITE_URL: origin,
    NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV: origin,
    NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD: origin,
    KUN_VISUAL_NOVEL_S3_STORAGE_PREFIX: state.prefix,
    KUN_ENABLE_CRON: 'false',
    KUN_COMPANY_IDENTITY_RESOLVER_ENABLED: 'false',
    KUN_CF_CACHE_ZONE_ID: '',
    KUN_CF_CACHE_PURGE_API_TOKEN: '',
    KUN_CF_CACHE_SITE_ZONE_ID: '',
    KUN_CF_CACHE_SITE_PURGE_API_TOKEN: '',
    KUN_VISUAL_NOVEL_INDEX_NOW_KEY: '',
    KUN_LINK_CHECKER_ENDPOINT: '',
    KUN_LINK_CHECKER_API_KEY: '',
    KUN_LINK_HEALTH_TRACKING_STARTED_AT: '',
    KUN_VISUAL_NOVEL_TEST_SITE_LABEL: 'worktree',
    AWS_EC2_METADATA_DISABLED: 'true',
    OTOAME_WORKTREE_ID: state.id
  }
}

export const serializeEnv = (values) =>
  Object.entries(values)
    .map(([key, value]) => {
      // Dotenv quotes preserve newlines; an unrepresentable quote combination is
      // rejected instead of emitting a different credential.
      const quote = ["'", '`', '"'].find(
        (candidate) =>
          !String(value).includes(candidate) &&
          parseEnv(`VALUE=${candidate}${value}${candidate}`).VALUE ===
            String(value)
      )
      if (!quote || String(value).includes('\0'))
        throw new Error(`无法安全写入配置字段 ${key}。`)
      return `${key}=${quote}${value}${quote}`
    })
    .join('\n') + '\n'

export const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`
export const databaseMarker = (state) =>
  `otoame-worktree:${state.id}:${state.nonce}`

export const roleSql = (state, password) => `
CREATE ROLE ${state.role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD ${quoteSql(password)};
COMMENT ON ROLE ${state.role} IS ${quoteSql(databaseMarker(state))};
`

export const databaseSql = (state) => `
CREATE DATABASE ${state.database} OWNER ${state.role} TEMPLATE template0;
REVOKE ALL ON DATABASE ${state.database} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${state.database} TO ${state.role};
COMMENT ON DATABASE ${state.database} IS ${quoteSql(databaseMarker(state))};
`
