/**
 * Real PostgreSQL + HTTP coverage for the company identity cutover.
 *
 * This script is intentionally not part of Vitest: it mutates a disposable
 * database and Redis sessions. It deliberately never calls the banner upload
 * path: test-database patch ids can overlap production ids, so even a later S3
 * cleanup could overwrite or delete a production cover. Prepare the database
 * first, then run both phases, restarting the sole 3100 server between them:
 *
 *   # server: KUN_COMPANY_IDENTITY_RESOLVER_ENABLED=false
 *   node --env-file=.env tests/e2e/company-identity.e2e.ts --expect-resolver=off
 *   # restart server: KUN_COMPANY_IDENTITY_RESOLVER_ENABLED=true
 *   node --env-file=.env tests/e2e/company-identity.e2e.ts --expect-resolver=on
 *
 * The script refuses any database not ending in `_e2e`, refuses any server
 * address other than loopback port 3100, and proves the server/database binding
 * with a read-only HTTP sentinel before sending a state-changing request.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'
import pg, { type PoolClient } from 'pg'

const KUN_TOKEN_COOKIE = 'kun-galgame-patch-moe-token'
const KUN_REDIS_PREFIX = 'kun:touchgal'
const SESSION_TTL_SECONDS = 24 * 60 * 60
const EXPECTED_TRIGGER_NAMES = [
  'patch_tag_count_trg_ins',
  'patch_tag_count_trg_del',
  'patch_tag_count_trg_upd',
  'patch_company_count_trg_ins',
  'patch_company_count_trg_del',
  'patch_company_count_trg_upd'
] as const

const requireEnv = (name: string) => {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} is required for the company identity e2e`)
  return value
}

const normalizeHost = (host: string) => {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  return ['localhost', '127.0.0.1', '::1'].includes(normalized)
    ? 'loopback'
    : normalized
}

const databaseIdentity = (url: URL) =>
  `${normalizeHost(url.hostname)}:${url.port || '5432'}/${decodeURIComponent(
    url.pathname.slice(1)
  )}`

const parseE2EDatabaseUrl = () => {
  const raw = requireEnv('KUN_E2E_DATABASE_URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('KUN_E2E_DATABASE_URL must be a PostgreSQL URL')
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !databaseName.endsWith('_e2e') ||
    databaseName.includes('/') ||
    databaseName.includes('\\')
  ) {
    throw new Error('KUN_E2E_DATABASE_URL must name a database ending in _e2e')
  }

  const applicationUrl = process.env.KUN_DATABASE_URL
  if (applicationUrl) {
    let parsedApplicationUrl: URL
    try {
      parsedApplicationUrl = new URL(applicationUrl)
    } catch {
      throw new Error('KUN_DATABASE_URL is invalid; refusing the e2e run')
    }
    if (databaseIdentity(url) === databaseIdentity(parsedApplicationUrl)) {
      throw new Error('KUN_E2E_DATABASE_URL must not equal KUN_DATABASE_URL')
    }
  }
  return { url, databaseName }
}

const parseE2EBaseUrl = () => {
  const url = new URL(process.env.KUN_E2E_BASE_URL ?? 'http://127.0.0.1:3100')
  if (
    url.protocol !== 'http:' ||
    normalizeHost(url.hostname) !== 'loopback' ||
    url.port !== '3100' ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'KUN_E2E_BASE_URL must be a loopback HTTP address on port 3100'
    )
  }
  return url.toString().replace(/\/$/, '')
}

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(`FAILED: ${message}`)
  console.log(`  ok  ${message}`)
}

const assertStringArrayEqual = (
  actual: unknown,
  expected: string[],
  message: string
) => {
  assert(Array.isArray(actual), `${message} is an array`)
  const normalizedActual = [...actual].map(String).sort()
  const normalizedExpected = [...expected].sort()
  assert(
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
    `${message}: expected ${normalizedExpected.join(', ')}, got ${normalizedActual.join(', ')}`
  )
}

const normalizeCompanyValue = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

const randomUniqueId = () => randomBytes(4).toString('hex')

type ResolverMode = 'off' | 'on'

const parseExpectedResolverMode = (): ResolverMode => {
  const argument = process.argv.find((value) =>
    value.startsWith('--expect-resolver=')
  )
  const mode = argument?.slice('--expect-resolver='.length)
  if (mode !== 'off' && mode !== 'on') {
    throw new Error('--expect-resolver=off|on is required')
  }
  return mode
}

interface ResolverWorkerInput {
  patchId: number
  userId: number
  resolverMode: ResolverMode
  data: {
    vndbId: string
    vndbTags: string[]
    vndbDevelopers: string[]
    bangumiTags: string[]
    bangumiDevelopers: string[]
    steamTags: string[]
    steamDevelopers: string[]
    steamAliases: string[]
    dlsiteCircleName: string
    dlsiteCircleLink: string
  }
}

interface ResolverWorkerResult {
  ok: boolean
  companyRelationsChanged?: boolean
  errorName?: string
  errorMessage?: string
}

/**
 * These are module singletons created only inside the short-lived resolver
 * worker. The 3100 process owns different handles and is never touched here.
 * Redis must close even if the Prisma adapter reports a disconnect failure,
 * otherwise ioredis keeps the worker event loop alive after COMMIT.
 */
export const disconnectResolverWorkerResources = async (
  disconnectDatabase: () => Promise<unknown>,
  redisClient: { disconnect: () => unknown }
) => {
  try {
    await disconnectDatabase()
  } finally {
    redisClient.disconnect()
  }
}

const resolverWorkerData = (input: {
  vndbDevelopers: string[]
  bangumiDevelopers: string[]
  steamDevelopers?: string[]
}): ResolverWorkerInput['data'] => ({
  vndbId: '',
  vndbTags: [],
  vndbDevelopers: input.vndbDevelopers,
  bangumiTags: [],
  bangumiDevelopers: input.bangumiDevelopers,
  steamTags: [],
  steamDevelopers: input.steamDevelopers ?? [],
  steamAliases: [],
  dlsiteCircleName: '',
  dlsiteCircleLink: ''
})

const runResolverWorker = (
  databaseUrl: URL,
  input: ResolverWorkerInput
): ResolverWorkerResult => {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'esno',
      fileURLToPath(import.meta.url),
      '--resolver-worker',
      JSON.stringify(input)
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KUN_DATABASE_URL: databaseUrl.toString(),
        KUN_E2E_DATABASE_URL: databaseUrl.toString(),
        KUN_COMPANY_IDENTITY_RESOLVER_ENABLED:
          input.resolverMode === 'on' ? 'true' : 'false'
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `company resolver worker failed: ${result.stderr.trim().slice(0, 1000)}`
    )
  }
  const marker = 'COMPANY_RESOLVER_WORKER_RESULT='
  const line = result.stdout
    .split(/\r?\n/)
    .find((value) => value.startsWith(marker))
  if (!line) {
    throw new Error('company resolver worker returned no structured result')
  }
  return JSON.parse(line.slice(marker.length)) as ResolverWorkerResult
}

const runResolverWorkerProcess = async () => {
  const raw = process.argv[3]
  if (!raw) throw new Error('resolver worker input is required')
  const databaseUrl = new URL(requireEnv('KUN_DATABASE_URL'))
  const expectedUrl = new URL(requireEnv('KUN_E2E_DATABASE_URL'))
  if (
    !decodeURIComponent(databaseUrl.pathname.slice(1)).endsWith('_e2e') ||
    databaseIdentity(databaseUrl) !== databaseIdentity(expectedUrl)
  ) {
    throw new Error('resolver worker must use the explicit _e2e database')
  }
  const input = JSON.parse(raw) as ResolverWorkerInput
  const [
    { processSubmittedExternalData },
    { disconnectPrismaAdapter },
    { redis }
  ] = await Promise.all([
    import('~/app/api/edit/processExternalData'),
    import('~/prisma/index'),
    import('~/lib/redis')
  ])
  let result: ResolverWorkerResult
  try {
    const applied = await processSubmittedExternalData(
      input.patchId,
      input.data,
      [],
      input.userId
    )
    result = { ok: true, ...applied }
  } catch (error) {
    result = {
      ok: false,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await disconnectResolverWorkerResources(disconnectPrismaAdapter, redis)
  }
  console.log(`COMPANY_RESOLVER_WORKER_RESULT=${JSON.stringify(result)}`)
}

interface RunFixtures {
  submitter: { id: number; name: string; role: 1 }
  reviewer: { id: number; name: string; role: 4 }
  canonicalCompany: { id: number; name: string; alias: string }
  publisherName: string
  portStudioName: string
  sharedAlias: string
  createPatch: { id: number; uniqueId: string }
  rewritePatch: { id: number; uniqueId: string }
  sentinelPatch: { id: number; uniqueId: string; name: string }
}

const insertCompany = async (
  client: PoolClient,
  input: {
    name: string
    aliases?: string[]
    userId: number
    authoritativeAliases?: string[]
  }
) => {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO public.patch_company
        (name, normalized_name, introduction, count, primary_language,
         official_website, parent_brand, alias, user_id, updated)
      VALUES
        ($1, $2, '', 0, ARRAY[]::varchar[], ARRAY[]::varchar[],
         ARRAY[]::varchar[], $3::varchar[], $4, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [
      input.name,
      normalizeCompanyValue(input.name),
      input.aliases ?? [],
      input.userId
    ]
  )
  const companyId = result.rows[0].id
  await client.query(
    `
      INSERT INTO public.patch_company_name_identity
        (company_id, kind, origin, value, normalized_value, updated)
      VALUES ($1, 'name', 'authoritative', $2, $3, CURRENT_TIMESTAMP)
    `,
    [companyId, input.name, normalizeCompanyValue(input.name)]
  )
  for (const alias of input.authoritativeAliases ?? []) {
    await client.query(
      `
        INSERT INTO public.patch_company_name_identity
          (company_id, kind, origin, value, normalized_value, updated)
        VALUES ($1, 'alias', 'authoritative', $2, $3, CURRENT_TIMESTAMP)
      `,
      [companyId, alias, normalizeCompanyValue(alias)]
    )
  }
  return companyId
}

const insertPatch = async (
  client: PoolClient,
  input: { uniqueId: string; name: string; userId: number }
) => {
  const patch = await client.query<{ id: number }>(
    `
      INSERT INTO public.patch
        (unique_id, name, banner, introduction, released, content_limit,
         type, language, engine, platform, user_id, updated)
      VALUES
        ($1, $2, '', 'Company identity E2E fixture.', '2026-08-31', 'nsfw',
         ARRAY[]::varchar[], ARRAY[]::varchar[], ARRAY[]::varchar[],
         ARRAY[]::varchar[], $3, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [input.uniqueId, input.name, input.userId]
  )
  await client.query(
    `
      INSERT INTO public.patch_rating_stat (patch_id, updated)
      VALUES ($1, CURRENT_TIMESTAMP)
    `,
    [patch.rows[0].id]
  )
  return patch.rows[0].id
}

const seedRunFixtures = async (
  client: PoolClient,
  suffix: string
): Promise<RunFixtures> => {
  await client.query('BEGIN')
  try {
    const submitterName = `e2e_u_${suffix}`
    const reviewerName = `e2e_a_${suffix}`
    const submitter = await client.query<{ id: number }>(
      `
        INSERT INTO public."user"
          (name, email, password, role, moemoepoint, enable_email_notice, updated)
        VALUES ($1, $2, 'not-used', 1, 1000, false, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [submitterName, `${submitterName}@example.invalid`]
    )
    const reviewer = await client.query<{ id: number }>(
      `
        INSERT INTO public."user"
          (name, email, password, role, moemoepoint, enable_email_notice, updated)
        VALUES ($1, $2, 'not-used', 4, 1000, false, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [reviewerName, `${reviewerName}@example.invalid`]
    )
    const reviewerId = reviewer.rows[0].id

    const canonicalName = `E2E Canonical ${suffix}`
    const canonicalAlias = `E2E Canonical Alias ${suffix}`
    const canonicalCompanyId = await insertCompany(client, {
      name: canonicalName,
      aliases: [canonicalAlias],
      authoritativeAliases: [canonicalAlias],
      userId: reviewerId
    })
    const sharedAlias = `e2e shared ${suffix}`
    for (const label of ['Alpha', 'Beta']) {
      await insertCompany(client, {
        name: `E2E Ambiguous ${label} ${suffix}`,
        aliases: [sharedAlias],
        authoritativeAliases: [sharedAlias],
        userId: reviewerId
      })
    }

    const createUniqueId = randomUniqueId()
    const createPatchId = await insertPatch(client, {
      uniqueId: createUniqueId,
      name: `E2E Create Core ${suffix}`,
      userId: reviewerId
    })
    const rewriteUniqueId = randomUniqueId()
    const rewritePatchId = await insertPatch(client, {
      uniqueId: rewriteUniqueId,
      name: `E2E Rewrite ${suffix}`,
      userId: reviewerId
    })
    const sentinelUniqueId = randomUniqueId()
    const sentinelName = `E2E Sentinel ${suffix}`
    const sentinelPatchId = await insertPatch(client, {
      uniqueId: sentinelUniqueId,
      name: sentinelName,
      userId: reviewerId
    })

    await client.query('COMMIT')
    return {
      submitter: { id: submitter.rows[0].id, name: submitterName, role: 1 },
      reviewer: { id: reviewerId, name: reviewerName, role: 4 },
      canonicalCompany: {
        id: canonicalCompanyId,
        name: canonicalName,
        alias: canonicalAlias
      },
      publisherName: `e2e publisher ${suffix}`,
      portStudioName: `e2e port studio ${suffix}`,
      sharedAlias,
      createPatch: { id: createPatchId, uniqueId: createUniqueId },
      rewritePatch: { id: rewritePatchId, uniqueId: rewriteUniqueId },
      sentinelPatch: {
        id: sentinelPatchId,
        uniqueId: sentinelUniqueId,
        name: sentinelName
      }
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const assertPreparedDatabase = async (
  client: PoolClient,
  expectedDatabase: string
) => {
  const database = await client.query<{ name: string }>(
    'SELECT current_database() AS name'
  )
  assert(
    database.rows[0]?.name === expectedDatabase,
    'the pg pool is connected to the explicit _e2e database'
  )

  const schema = await client.query<{
    normalized_not_null: boolean
    normalized_unique: string | null
    external_unique: string | null
    snapshot_column: boolean
  }>(`
    SELECT
      COALESCE((
        SELECT attribute.attnotnull
        FROM pg_attribute attribute
        WHERE attribute.attrelid = 'public.patch_company'::regclass
          AND attribute.attname = 'normalized_name'
          AND NOT attribute.attisdropped
      ), false) AS normalized_not_null,
      to_regclass('public.patch_company_normalized_name_key')::text AS normalized_unique,
      to_regclass('public.patch_company_external_id_source_external_id_key')::text AS external_unique,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'patch_submission'
          AND column_name = 'company_candidates'
      ) AS snapshot_column
  `)
  const row = schema.rows[0]
  assert(
    Boolean(row?.normalized_not_null),
    'Phase B normalized_name is NOT NULL'
  )
  assert(
    Boolean(row?.normalized_unique),
    'Phase B normalized_name unique index exists'
  )
  assert(
    Boolean(row?.external_unique),
    'Phase B external-id unique index exists'
  )
  assert(Boolean(row?.snapshot_column), 'submission company_candidates exists')

  const triggers = await client.query<{ names: string[] }>(
    `
      SELECT COALESCE(array_agg(trigger.tgname ORDER BY trigger.tgname), ARRAY[]::name[])::text[] AS names
      FROM pg_trigger trigger
      WHERE NOT trigger.tgisinternal
        AND trigger.tgname = ANY($1::text[])
    `,
    [[...EXPECTED_TRIGGER_NAMES]]
  )
  assertStringArrayEqual(
    triggers.rows[0]?.names,
    [...EXPECTED_TRIGGER_NAMES],
    'all six relation counter triggers'
  )
}

interface SessionRecord {
  token: string
  uid: number
  jti: string
}

const createSession = async (
  redis: Redis,
  user: { id: number; name: string; role: number }
): Promise<SessionRecord> => {
  const jti = randomUUID()
  const token = jwt.sign(
    {
      iss: requireEnv('JWT_ISS'),
      aud: requireEnv('JWT_AUD'),
      jti,
      uid: user.id,
      name: user.name,
      role: user.role
    },
    requireEnv('JWT_SECRET'),
    { expiresIn: '1d' }
  )
  const createdAt = Date.now()
  await redis.setex(
    `${KUN_REDIS_PREFIX}:access:session:${user.id}:${jti}`,
    SESSION_TTL_SECONDS,
    JSON.stringify({
      uid: user.id,
      jti,
      name: user.name,
      role: user.role,
      createdAt
    })
  )
  await redis.zadd(
    `${KUN_REDIS_PREFIX}:access:sessions:${user.id}`,
    createdAt,
    jti
  )
  return { token, uid: user.id, jti }
}

const requestHeaders = (token: string, baseUrl: string) => ({
  'x-requested-with': 'kun-fetch',
  origin: baseUrl,
  cookie: `${KUN_TOKEN_COOKIE}=${token}`
})

const callJson = async (
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...requestHeaders(token, baseUrl),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const result = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(
      `${method} ${path} returned ${response.status}: ${String(result)}`
    )
  }
  return result
}

const callPublicJson = async (baseUrl: string, path: string) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-requested-with': 'kun-fetch', origin: baseUrl }
  })
  const result = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(
      `GET ${path} returned ${response.status}: ${String(result)}`
    )
  }
  return result
}

const callForm = async (
  baseUrl: string,
  token: string,
  method: string,
  form: FormData
) => {
  const response = await fetch(`${baseUrl}/api/edit`, {
    method,
    headers: requestHeaders(token, baseUrl),
    body: form
  })
  const result = (await response.json()) as unknown
  if (!response.ok) {
    throw new Error(
      `${method} /api/edit returned ${response.status}: ${String(result)}`
    )
  }
  return result
}

const makeRewriteForm = (input: {
  patchId: number
  name: string
  vndbDevelopers: string[]
  bangumiDevelopers: string[]
}) => {
  const form = new FormData()
  form.set('id', String(input.patchId))
  form.set('name', input.name)
  form.set('introduction', 'Company identity rewrite end-to-end test.')
  form.set('vndbId', '')
  form.set('vndbRelationId', '')
  form.set('bangumiId', '')
  form.set('steamId', '')
  form.set('dlsiteCode', '')
  form.set('dlsiteCircleName', '')
  form.set('dlsiteCircleLink', '')
  for (const developer of input.vndbDevelopers) {
    form.append('vndbDevelopers', developer)
  }
  for (const developer of input.bangumiDevelopers) {
    form.append('bangumiDevelopers', developer)
  }
  form.set('officialUrl', '')
  form.set('released', '2026-08-31')
  form.set('contentLimit', 'nsfw')
  return form
}

const submissionPayload = (input: {
  name: string
  vndbId?: string
  vndbDevelopers?: string[]
  bangumiDevelopers?: string[]
}) => ({
  name: input.name,
  introduction: 'Company identity submission end-to-end test introduction.',
  vndbId: input.vndbId ?? '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: input.vndbDevelopers ?? [],
  bangumiTags: [],
  bangumiDevelopers: input.bangumiDevelopers ?? [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  officialUrl: '',
  alias: [],
  tag: [],
  released: '2026-08-31',
  contentLimit: 'nsfw',
  isDuplicate: false
})

const patchCompanyNames = async (client: PoolClient, patchId: number) => {
  const result = await client.query<{ name: string }>(
    `
      SELECT company.name
      FROM public.patch_company_relation relation
      JOIN public.patch_company company ON company.id = relation.company_id
      WHERE relation.patch_id = $1
      ORDER BY company.name
    `,
    [patchId]
  )
  return result.rows.map((row) => row.name)
}

const assertServerUsesDatabase = async (
  baseUrl: string,
  fixture: RunFixtures['sentinelPatch']
) => {
  // The unique id is random for this run, so there cannot be a pre-existing
  // positive cache entry. Keep this probe anonymous: no Redis session is
  // created until the server/database binding has been proven.
  const response = await callPublicJson(
    baseUrl,
    `/api/patch?uniqueId=${fixture.uniqueId}`
  )
  assert(
    typeof response === 'object' &&
      response !== null &&
      'name' in response &&
      response.name === fixture.name,
    'the 3100 server reads the sentinel from KUN_E2E_DATABASE_URL'
  )
}

const runCreateAndRewriteScenarios = async (input: {
  client: PoolClient
  databaseUrl: URL
  baseUrl: string
  reviewerToken: string
  fixtures: RunFixtures
  resolverMode: ResolverMode
}) => {
  const {
    client,
    databaseUrl,
    baseUrl,
    reviewerToken,
    fixtures,
    resolverMode
  } = input
  console.log(
    '\nresolver create preserves distinct sources and canonicalizes names'
  )
  // The patch row represents the already-committed create core. Calling the
  // exact post-commit helper in an isolated process exercises the create path's
  // real Prisma/resolver transaction without entering its S3 banner path.
  const createResult = runResolverWorker(databaseUrl, {
    patchId: fixtures.createPatch.id,
    userId: fixtures.reviewer.id,
    resolverMode,
    data: resolverWorkerData({
      vndbDevelopers: [fixtures.canonicalCompany.name.toLowerCase()],
      bangumiDevelopers: [fixtures.publisherName],
      steamDevelopers: [fixtures.portStudioName]
    })
  })
  assert(createResult.ok, 'the create post-commit resolver succeeded')
  assert(
    createResult.companyRelationsChanged === true,
    'the create post-commit resolver inserted relations'
  )
  assertStringArrayEqual(
    await patchCompanyNames(client, fixtures.createPatch.id),
    resolverMode === 'on'
      ? [
          fixtures.canonicalCompany.name,
          fixtures.publisherName,
          fixtures.portStudioName
        ]
      : [fixtures.canonicalCompany.name, fixtures.portStudioName],
    'create company relations'
  )
  const canonicalDuplicates = await client.query<{ count: number }>(
    `
      SELECT COUNT(*)::integer AS count
      FROM public.patch_company
      WHERE normalized_name = $1
    `,
    [normalizeCompanyValue(fixtures.canonicalCompany.name)]
  )
  assert(
    canonicalDuplicates.rows[0].count === 1,
    'normalized spelling did not create a duplicate canonical company'
  )

  console.log(
    '\nresolver rewrite accepts an authoritative alias without duplicating'
  )
  const rewrittenName = `E2E Rewritten ${randomUniqueId()}`
  const rewriteResult = await callForm(
    baseUrl,
    reviewerToken,
    'PUT',
    makeRewriteForm({
      patchId: fixtures.rewritePatch.id,
      name: rewrittenName,
      vndbDevelopers: [fixtures.canonicalCompany.alias],
      bangumiDevelopers: [fixtures.publisherName]
    })
  )
  assert(
    typeof rewriteResult === 'object' &&
      rewriteResult !== null &&
      'warnings' in rewriteResult &&
      Array.isArray(rewriteResult.warnings) &&
      rewriteResult.warnings.length === 0,
    'rewrite returns a warning-free structured success result'
  )
  assertStringArrayEqual(
    await patchCompanyNames(client, fixtures.rewritePatch.id),
    resolverMode === 'on'
      ? [fixtures.canonicalCompany.name, fixtures.publisherName]
      : [fixtures.canonicalCompany.name],
    'rewrite company relations'
  )
  const rewritten = await client.query<{ name: string }>(
    'SELECT name FROM public.patch WHERE id = $1',
    [fixtures.rewritePatch.id]
  )
  assert(
    rewritten.rows[0]?.name === rewrittenName,
    'rewrite persisted the core patch'
  )
}

const runSubmissionScenario = async (input: {
  client: PoolClient
  baseUrl: string
  submitterToken: string
  reviewerToken: string
  fixtures: RunFixtures
  createdPatchUniqueIds: string[]
  resolverMode: ResolverMode
}) => {
  const {
    client,
    baseUrl,
    submitterToken,
    reviewerToken,
    fixtures,
    resolverMode
  } = input
  console.log(
    '\nsubmission preview and approval use the same canonical companies'
  )
  const vndbId = `v${Date.now().toString().slice(-8)}`
  const payload = submissionPayload({
    name: `E2E Submission ${randomUniqueId()}`,
    vndbId,
    vndbDevelopers: [fixtures.canonicalCompany.name],
    bangumiDevelopers: [fixtures.publisherName]
  })
  const created = (await callJson(
    baseUrl,
    submitterToken,
    'POST',
    '/api/patch-submission',
    { requestId: randomUUID().replace(/-/g, ''), payload }
  )) as { submissionId?: number }
  assert(
    typeof created.submissionId === 'number',
    'submission draft was created'
  )
  const submissionId = created.submissionId
  const producerId = `p-${randomUniqueId()}`
  const snapshot = {
    vndb: {
      lookupId: vndbId,
      fetchedAt: new Date().toISOString(),
      candidates: [
        {
          source: 'vndb',
          externalId: producerId,
          name: fixtures.canonicalCompany.name,
          aliases: [fixtures.canonicalCompany.alias],
          roles: ['developer'],
          sourceRoles: ['developer'],
          entityType: 'company',
          externalUrls: [],
          primaryLanguage: 'ja',
          sourceWebsites: []
        }
      ]
    },
    bangumi: null,
    steam: null,
    dlsite: null
  }
  await client.query(
    `
      UPDATE public.patch_submission
      SET banner_key = $2,
          company_candidates = $3::jsonb,
          updated = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [
      submissionId,
      `patch-submission/e2e-${submissionId}/banner/banner.avif`,
      JSON.stringify(snapshot)
    ]
  )

  const preview = (await callJson(
    baseUrl,
    submitterToken,
    'GET',
    `/api/patch-submission/${submissionId}/preview`
  )) as { companyNames?: string[]; companyNeedsReview?: boolean }
  assert(
    resolverMode === 'on'
      ? preview.companyNeedsReview === false
      : preview.companyNeedsReview === undefined,
    `the 3100 server has resolver flag-${resolverMode}`
  )
  assertStringArrayEqual(
    preview.companyNames,
    [fixtures.canonicalCompany.name, fixtures.publisherName],
    'author preview canonical companies'
  )

  const submitted = await callJson(
    baseUrl,
    submitterToken,
    'POST',
    `/api/patch-submission/${submissionId}/submit`
  )
  assert(
    typeof submitted === 'object' && submitted !== null,
    'submission entered review'
  )
  const adminPage = await fetch(`${baseUrl}/admin/submission/${submissionId}`, {
    headers: requestHeaders(reviewerToken, baseUrl),
    redirect: 'manual'
  })
  const adminHtml = await adminPage.text()
  assert(adminPage.status === 200, 'reviewer detail page is reachable')
  assert(
    adminHtml.includes(fixtures.canonicalCompany.name) &&
      adminHtml.includes(fixtures.publisherName),
    'reviewer preview renders the same canonical companies'
  )

  const approved = (await callJson(
    baseUrl,
    reviewerToken,
    'POST',
    '/api/admin/patch-submission/approve',
    { submissionId }
  )) as { uniqueId?: string }
  assert(
    typeof approved.uniqueId === 'string',
    'reviewer approval published a patch'
  )
  input.createdPatchUniqueIds.push(approved.uniqueId)
  const published = await client.query<{ id: number }>(
    'SELECT id FROM public.patch WHERE unique_id = $1',
    [approved.uniqueId]
  )
  assert(
    published.rows.length === 1,
    'approved patch exists in the E2E database'
  )
  assertStringArrayEqual(
    await patchCompanyNames(client, published.rows[0].id),
    [fixtures.canonicalCompany.name, fixtures.publisherName],
    'published canonical companies'
  )
  const externalIdentity = await client.query<{ company_id: number }>(
    `
      SELECT company_id
      FROM public.patch_company_external_id
      WHERE source = 'vndb' AND external_id = $1
    `,
    [producerId]
  )
  if (resolverMode === 'on') {
    assert(
      externalIdentity.rows[0]?.company_id === fixtures.canonicalCompany.id,
      'trusted snapshot wrote its external identity to the canonical company'
    )
  } else {
    assert(
      externalIdentity.rows.length === 0,
      'flag-off approval did not consume trusted identity evidence'
    )
  }
}

const runAmbiguityScenarios = async (input: {
  client: PoolClient
  databaseUrl: URL
  baseUrl: string
  submitterToken: string
  reviewerToken: string
  fixtures: RunFixtures
}) => {
  const {
    client,
    databaseUrl,
    baseUrl,
    submitterToken,
    reviewerToken,
    fixtures
  } = input
  console.log(
    '\ncreate enrichment ambiguity leaves the committed core untouched'
  )
  const createFixtureId = await insertPatch(client, {
    uniqueId: randomUniqueId(),
    name: `E2E Ambiguous Create ${randomUniqueId()}`,
    userId: fixtures.reviewer.id
  })
  const ambiguousCreate = runResolverWorker(databaseUrl, {
    patchId: createFixtureId,
    userId: fixtures.reviewer.id,
    resolverMode: 'on',
    data: resolverWorkerData({
      vndbDevelopers: [fixtures.sharedAlias],
      bangumiDevelopers: []
    })
  })
  assert(
    !ambiguousCreate.ok &&
      ambiguousCreate.errorName === 'CompanyResolutionAmbiguityError',
    'the create enrichment reports the resolver ambiguity'
  )
  const ambiguousPatch = await client.query<{ name: string }>(
    'SELECT name FROM public.patch WHERE id = $1',
    [createFixtureId]
  )
  assert(
    ambiguousPatch.rows.length === 1,
    'ambiguous create kept its committed core'
  )
  assert(
    (await patchCompanyNames(client, createFixtureId)).length === 0,
    'ambiguous create enrichment did not guess a company relation'
  )

  const rewriteFixtureId = await insertPatch(client, {
    uniqueId: randomUniqueId(),
    name: `E2E Ambiguous Rewrite ${randomUniqueId()}`,
    userId: fixtures.reviewer.id
  })
  const rewrittenName = `E2E Ambiguous Saved ${randomUniqueId()}`
  const ambiguousRewrite = (await callForm(
    baseUrl,
    reviewerToken,
    'PUT',
    makeRewriteForm({
      patchId: rewriteFixtureId,
      name: rewrittenName,
      vndbDevelopers: [fixtures.sharedAlias],
      bangumiDevelopers: []
    })
  )) as { warnings?: { kind?: string }[] }
  assert(
    ambiguousRewrite.warnings?.some(
      (warning) => warning.kind === 'company-ambiguity'
    ),
    'ambiguous rewrite returns a company maintenance warning'
  )
  const rewritten = await client.query<{ name: string }>(
    'SELECT name FROM public.patch WHERE id = $1',
    [rewriteFixtureId]
  )
  assert(
    rewritten.rows[0]?.name === rewrittenName,
    'ambiguous rewrite kept its core update'
  )

  console.log('\nsubmission ambiguity remains pending and publishes nothing')
  const payload = submissionPayload({
    name: `E2E Ambiguous Submission ${randomUniqueId()}`,
    vndbDevelopers: [fixtures.sharedAlias]
  })
  const created = (await callJson(
    baseUrl,
    submitterToken,
    'POST',
    '/api/patch-submission',
    { requestId: randomUUID().replace(/-/g, ''), payload }
  )) as { submissionId?: number }
  assert(
    typeof created.submissionId === 'number',
    'ambiguous draft was created'
  )
  const submissionId = created.submissionId
  await client.query(
    `
      UPDATE public.patch_submission
      SET banner_key = $2, updated = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [submissionId, `patch-submission/e2e-${submissionId}/banner/banner.avif`]
  )
  const preview = (await callJson(
    baseUrl,
    submitterToken,
    'GET',
    `/api/patch-submission/${submissionId}/preview`
  )) as { companyNeedsReview?: boolean }
  assert(
    preview.companyNeedsReview === true,
    'ambiguous preview requires review'
  )
  await callJson(
    baseUrl,
    submitterToken,
    'POST',
    `/api/patch-submission/${submissionId}/submit`
  )
  const approval = await callJson(
    baseUrl,
    reviewerToken,
    'POST',
    '/api/admin/patch-submission/approve',
    { submissionId }
  )
  assert(
    typeof approval === 'string' && approval.includes('会社身份存在歧义'),
    'ambiguous approval returns the maintenance blocker'
  )
  const state = await client.query<{ status: string; patch_id: number | null }>(
    'SELECT status, patch_id FROM public.patch_submission WHERE id = $1',
    [submissionId]
  )
  assert(
    state.rows[0]?.status === 'pending' && state.rows[0]?.patch_id === null,
    'ambiguous approval rolled back and left the submission pending'
  )
}

const assertParentCounts = async (
  client: PoolClient,
  table: 'patch_company' | 'patch_tag',
  relationTable: 'patch_company_relation' | 'patch_tag_relation',
  foreignKey: 'company_id' | 'tag_id',
  ids: number[],
  expected: number[]
) => {
  const result = await client.query<{
    id: number
    stored: number
    actual: number
  }>(
    `
      SELECT parent.id,
             parent.count::integer AS stored,
             COUNT(relation.id)::integer AS actual
      FROM public.${table} parent
      LEFT JOIN public.${relationTable} relation
        ON relation.${foreignKey} = parent.id
      WHERE parent.id = ANY($1::integer[])
      GROUP BY parent.id, parent.count
      ORDER BY parent.id
    `,
    [ids]
  )
  const byId = new Map(result.rows.map((row) => [row.id, row]))
  ids.forEach((id, index) => {
    const row = byId.get(id)
    assert(
      row?.stored === row?.actual && row?.stored === expected[index],
      `${table} #${id} count is ${expected[index]}`
    )
  })
}

const runTriggerScenario = async (
  client: PoolClient,
  fixtures: RunFixtures,
  suffix: string
) => {
  console.log(
    '\nstatement-level insert/update/delete triggers preserve both counters'
  )
  const patchId = await insertPatch(client, {
    uniqueId: randomUniqueId(),
    name: `E2E Trigger ${suffix}`,
    userId: fixtures.reviewer.id
  })
  const companyA = await insertCompany(client, {
    name: `E2E Trigger Company A ${suffix}`,
    userId: fixtures.reviewer.id
  })
  const companyB = await insertCompany(client, {
    name: `E2E Trigger Company B ${suffix}`,
    userId: fixtures.reviewer.id
  })
  const tags = await client.query<{ id: number }>(
    `
      INSERT INTO public.patch_tag
        (name, introduction, count, alias, source, user_id, updated)
      VALUES
        ($1, '', 0, ARRAY[]::varchar[], 'self', $3, CURRENT_TIMESTAMP),
        ($2, '', 0, ARRAY[]::varchar[], 'self', $3, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [
      `E2E Trigger Tag A ${suffix}`,
      `E2E Trigger Tag B ${suffix}`,
      fixtures.reviewer.id
    ]
  )
  const tagA = tags.rows[0].id
  const tagB = tags.rows[1].id

  const companyRelation = await client.query<{ id: number }>(
    `
      INSERT INTO public.patch_company_relation (patch_id, company_id, updated)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [patchId, companyA]
  )
  const tagRelation = await client.query<{ id: number }>(
    `
      INSERT INTO public.patch_tag_relation (patch_id, tag_id, updated)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [patchId, tagA]
  )
  await assertParentCounts(
    client,
    'patch_company',
    'patch_company_relation',
    'company_id',
    [companyA, companyB],
    [1, 0]
  )
  await assertParentCounts(
    client,
    'patch_tag',
    'patch_tag_relation',
    'tag_id',
    [tagA, tagB],
    [1, 0]
  )

  await client.query(
    'UPDATE public.patch_company_relation SET company_id = $2 WHERE id = $1',
    [companyRelation.rows[0].id, companyB]
  )
  await client.query(
    'UPDATE public.patch_tag_relation SET tag_id = $2 WHERE id = $1',
    [tagRelation.rows[0].id, tagB]
  )
  await assertParentCounts(
    client,
    'patch_company',
    'patch_company_relation',
    'company_id',
    [companyA, companyB],
    [0, 1]
  )
  await assertParentCounts(
    client,
    'patch_tag',
    'patch_tag_relation',
    'tag_id',
    [tagA, tagB],
    [0, 1]
  )

  await client.query(
    'DELETE FROM public.patch_company_relation WHERE id = $1',
    [companyRelation.rows[0].id]
  )
  await client.query('DELETE FROM public.patch_tag_relation WHERE id = $1', [
    tagRelation.rows[0].id
  ])
  await assertParentCounts(
    client,
    'patch_company',
    'patch_company_relation',
    'company_id',
    [companyA, companyB],
    [0, 0]
  )
  await assertParentCounts(
    client,
    'patch_tag',
    'patch_tag_relation',
    'tag_id',
    [tagA, tagB],
    [0, 0]
  )
}

const cleanup = async (input: {
  client: PoolClient
  redis: Redis
  fixtures?: RunFixtures
  sessions: SessionRecord[]
  createdPatchUniqueIds: string[]
}) => {
  const errors: unknown[] = []
  try {
    if (input.fixtures) {
      await input.client.query(
        'DELETE FROM public."user" WHERE id = ANY($1::integer[])',
        [[input.fixtures.submitter.id, input.fixtures.reviewer.id]]
      )
    }
  } catch (error) {
    errors.push(error)
  }
  try {
    const cacheKeys = [
      ...(input.fixtures
        ? [`${KUN_REDIS_PREFIX}:patch:${input.fixtures.sentinelPatch.uniqueId}`]
        : []),
      ...input.createdPatchUniqueIds.map(
        (uniqueId) => `${KUN_REDIS_PREFIX}:patch:${uniqueId}`
      ),
      ...input.sessions.map(
        (session) =>
          `${KUN_REDIS_PREFIX}:access:session:${session.uid}:${session.jti}`
      )
    ]
    if (cacheKeys.length) await input.redis.del(...cacheKeys)
    for (const session of input.sessions) {
      await input.redis.zrem(
        `${KUN_REDIS_PREFIX}:access:sessions:${session.uid}`,
        session.jti
      )
    }
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      'Company identity E2E cleanup was incomplete'
    )
  }
}

const main = async () => {
  const { url: databaseUrl, databaseName } = parseE2EDatabaseUrl()
  const baseUrl = parseE2EBaseUrl()
  const resolverMode = parseExpectedResolverMode()
  const pool = new pg.Pool({
    connectionString: databaseUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5000
  })
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined
  })
  const client = await pool.connect()
  const suffix = randomBytes(3).toString('hex')
  const sessions: SessionRecord[] = []
  const createdPatchUniqueIds: string[] = []
  let fixtures: RunFixtures | undefined
  let failure: unknown

  try {
    await assertPreparedDatabase(client, databaseName)
    fixtures = await seedRunFixtures(client, suffix)

    // This is the last step before any Redis or HTTP write. If 3100 points
    // elsewhere, the run stops after an anonymous read and cleans only the
    // intended disposable database.
    await assertServerUsesDatabase(baseUrl, fixtures.sentinelPatch)

    const submitterSession = await createSession(redis, fixtures.submitter)
    sessions.push(submitterSession)
    const reviewerSession = await createSession(redis, fixtures.reviewer)
    sessions.push(reviewerSession)

    await runCreateAndRewriteScenarios({
      client,
      databaseUrl,
      baseUrl,
      reviewerToken: reviewerSession.token,
      fixtures,
      resolverMode
    })
    await runSubmissionScenario({
      client,
      baseUrl,
      submitterToken: submitterSession.token,
      reviewerToken: reviewerSession.token,
      fixtures,
      createdPatchUniqueIds,
      resolverMode
    })
    if (resolverMode === 'on') {
      await runAmbiguityScenarios({
        client,
        databaseUrl,
        baseUrl,
        submitterToken: submitterSession.token,
        reviewerToken: reviewerSession.token,
        fixtures
      })
    }
    await runTriggerScenario(client, fixtures, suffix)
    console.log(`\nall company identity flag-${resolverMode} E2E checks passed`)
  } catch (error) {
    failure = error
  }

  try {
    await cleanup({
      client,
      redis,
      fixtures,
      sessions,
      createdPatchUniqueIds
    })
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError(
          [failure, cleanupError],
          'E2E run and cleanup failed'
        )
      : cleanupError
  } finally {
    client.release()
    await pool.end()
    redis.disconnect()
  }

  if (failure) throw failure
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : ''
if (import.meta.url === entryPath) {
  const operation =
    process.argv[2] === '--resolver-worker'
      ? runResolverWorkerProcess()
      : main()

  void operation.catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
