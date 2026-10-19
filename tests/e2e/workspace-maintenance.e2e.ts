/**
 * Real HTTP acceptance against a disposable database and a local checker.
 * Run with the same synthetic environment as the isolated application server.
 * Never loads .env and never contacts a real share or remote object storage.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'
import { chromium } from 'playwright-core'
import type {
  LinkHealthBasis,
  LinkReportResponse
} from '../../types/api/linkHealth'
import type {
  LinkMaintenanceActionResponse,
  LinkMaintenanceItem,
  LinkMaintenanceListResponse
} from '../../types/api/linkMaintenance'
import type {
  WorkspaceResourceDetail,
  WorkspaceResourceUpdateInput,
  WorkspaceResourcesResponse
} from '../../types/api/workspace'
import type { KunUploadFileResponse } from '../../types/api/upload'
import type { CaseListResponse } from '../../types/api/case'

const required = (key: string) => {
  const value = process.env[key]
  assert(value, `${key} must explicitly target the disposable environment`)
  return value
}
const database = new URL(required('KUN_E2E_DATABASE_URL'))
assert(
  new URL(required('KUN_DATABASE_URL')).href === database.href,
  'Application service imports must use the same explicit disposable database'
)
const origin = new URL(required('KUN_E2E_BASE_URL'))
const checkerUrl = new URL(required('KUN_LINK_CHECKER_ENDPOINT'))
const objectUrl = new URL(required('KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT'))
const redisPort = Number(required('REDIS_PORT'))
assert.equal(database.hostname, '127.0.0.1')
assert(database.pathname.endsWith('_e2e'))
assert(database.port && database.port !== '5432')
assert.equal(origin.hostname, '127.0.0.1')
assert.equal(origin.port, '3100')
assert.equal(checkerUrl.hostname, '127.0.0.1')
assert(checkerUrl.port && checkerUrl.port !== origin.port)
assert.equal(objectUrl.hostname, '127.0.0.1')
assert(
  objectUrl.port && ![origin.port, checkerUrl.port].includes(objectUrl.port)
)
assert.equal(required('REDIS_HOST'), '127.0.0.1')
assert(Number.isInteger(redisPort) && redisPort > 1024 && redisPort !== 6379)

const pool = new Pool({ connectionString: database.href, max: 6 })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const redis = new Redis({ host: '127.0.0.1', port: redisPort })
const run = `w${Date.now().toString(36)}`
const artifactDir = resolve(required('KUN_E2E_ARTIFACT_DIR'))
const checks: string[] = []
const testActorIds: number[] = []
const passed = async (name: string) => {
  // Independent scenarios use fresh windows, scoped to this run's synthetic users.
  await redis.del(
    ...testActorIds.map((id) => `kun:touchgal:link-health:user:${id}`)
  )
  checks.push(name)
  console.log(`PASS ${name}`)
}

let checkerMode: 'unknown' | 'alive' | 'dead' = 'unknown'
let checkerCalls = 0
let holdNextCheck = false
let heldResponse: ServerResponse | null = null
let serviceRuntimeLoaded = false
const sendCheck = (response: ServerResponse) => {
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({
      provider: 'quark',
      status: checkerMode,
      reason:
        checkerMode === 'alive'
          ? 'share_ok'
          : checkerMode === 'dead'
            ? 'share_not_found'
            : 'passcode_required',
      providerCode: checkerMode === 'dead' ? '41004' : '0',
      checkedAt: new Date().toISOString(),
      cached: false
    })
  )
}
const releaseHeldCheck = () => {
  if (heldResponse) {
    heldResponse.writeHead(503).end()
    heldResponse = null
  }
}
const checker = createServer(async (request, response) => {
  if (request.url !== '/v1/check' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  assert.equal(
    request.headers.authorization,
    `Bearer ${required('KUN_LINK_CHECKER_API_KEY')}`
  )
  let body = ''
  for await (const chunk of request) body += String(chunk)
  const input = JSON.parse(body) as { url: string }
  assert.equal(new URL(input.url).hostname, 'pan.quark.cn')
  checkerCalls += 1
  if (holdNextCheck) {
    holdNextCheck = false
    heldResponse = response
  } else sendCheck(response)
})
let objectPuts = 0
const objects = createServer(async (request, response) => {
  if (request.method === 'PUT') {
    let bytes = 0
    for await (const chunk of request) bytes += Buffer.byteLength(chunk)
    assert(bytes > 0)
    objectPuts += 1
    response.writeHead(200, { ETag: '"synthetic-object"' }).end()
  } else if (request.method === 'DELETE') {
    response.writeHead(204).end()
  } else response.writeHead(404).end()
})

type Actor = { id: number; name: string; role: number; token: string }
const actor = async (suffix: string, role: number): Promise<Actor> => {
  const user = await prisma.user.create({
    data: {
      name: `${run}_${suffix}`.slice(0, 17),
      email: `${run}-${suffix}@example.invalid`,
      password: 'disposable-test-account',
      avatar: '/favicon.webp',
      role,
      moemoepoint: 500,
      register_time: new Date(Date.now() - 60 * 86400000),
      enable_email_notice: false
    }
  })
  const jti = randomUUID()
  const session = {
    uid: user.id,
    name: user.name,
    role,
    jti,
    createdAt: Date.now()
  }
  const token = jwt.sign(
    { ...session, iss: required('JWT_ISS'), aud: required('JWT_AUD') },
    required('JWT_SECRET'),
    { expiresIn: '2h' }
  )
  await redis.setex(
    `kun:touchgal:access:session:${user.id}:${jti}`,
    7200,
    JSON.stringify(session)
  )
  await redis.zadd(
    `kun:touchgal:access:sessions:${user.id}`,
    session.createdAt,
    jti
  )
  testActorIds.push(user.id)
  return { id: user.id, name: user.name, role, token }
}
const request = async <T>(
  viewer: Actor | null,
  method: string,
  path: string,
  body?: unknown
) => {
  const response = await fetch(`${origin.origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin: origin.origin,
      'x-requested-with': 'kun-fetch',
      ...(viewer
        ? { cookie: `kun-galgame-patch-moe-token=${viewer.token}` }
        : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let data: T | string
  try {
    data = JSON.parse(text) as T | string
  } catch {
    data = text
  }
  return { status: response.status, headers: response.headers, data }
}
const data = <T>(response: { status: number; data: T | string }): T => {
  assert.equal(
    response.status,
    200,
    `HTTP status ${response.status}: ${typeof response.data === 'string' ? response.data.slice(0, 200) : 'unexpected response'}`
  )
  assert.notEqual(
    typeof response.data,
    'string',
    'Expected structured response'
  )
  return response.data as T
}
const eventually = async (
  predicate: () => boolean | Promise<boolean>,
  label: string
) => {
  const deadline = Date.now() + 15000
  while (!(await predicate())) {
    assert(Date.now() < deadline, label)
    await new Promise((resolveWait) => setTimeout(resolveWait, 30))
  }
}

const main = async () => {
  assert.equal(
    (
      await pool.query<{ database: string }>(
        'SELECT current_database() AS database'
      )
    ).rows[0].database,
    database.pathname.slice(1)
  )
  await mkdir(artifactDir, { recursive: true })
  await new Promise<void>((resolveListen, reject) => {
    checker.once('error', reject)
    checker.listen(Number(checkerUrl.port), '127.0.0.1', resolveListen)
  })
  await new Promise<void>((resolveListen, reject) => {
    objects.once('error', reject)
    objects.listen(Number(objectUrl.port), '127.0.0.1', resolveListen)
  })
  const owner = await actor('owner', 2)
  const other = await actor('other', 1)
  const empty = await actor('empty', 1)
  const staff = await actor('staff', 3)
  const reporters: Actor[] = []
  for (let index = 0; index < 8; index += 1)
    reporters.push(await actor(`r${index}`, 1))
  const patch = await prisma.patch.create({
    data: {
      unique_id: run.slice(-8),
      name: `${run} 验收游戏`,
      user_id: owner.id,
      content_limit: 'sfw',
      type: [],
      language: ['ja'],
      platform: ['windows'],
      engine: [],
      introduction: '独立环境的工作台验收条目。',
      banner: '/favicon.webp',
      rating_stat: { create: {} }
    }
  })
  const fixture = async (
    label: string,
    options: {
      status?: number
      protected?: boolean
      health?: string
      ownerId?: number
    } = {}
  ) => {
    const resource = await prisma.patch_resource.create({
      data: {
        patch_id: patch.id,
        user_id: options.ownerId ?? owner.id,
        section: 'galgame',
        name: `${run} ${label}`,
        note: '工作台验收说明',
        status: options.status ?? 0,
        type: ['pc', 'row'],
        language: ['ja'],
        platform: ['windows'],
        links: {
          create: [
            {
              storage: 'user',
              size: '1GB',
              content: `https://pan.quark.cn/s/${randomUUID().replaceAll('-', '').slice(0, 12)}`,
              code: 'synthetic-code',
              password: 'synthetic-password',
              hash: 'synthetic-hash',
              health: options.health ?? 'ok',
              sort_order: 0,
              health_changed_at: options.health ? new Date() : null
            },
            ...(options.protected
              ? [
                  {
                    storage: 'touchgal',
                    size: '1GB',
                    content: 'https://example.invalid/protected',
                    code: 'protected-code',
                    password: 'protected-password',
                    hash: 'protected-hash',
                    sort_order: 1
                  }
                ]
              : [])
          ]
        }
      },
      include: { links: { orderBy: { sort_order: 'asc' } } }
    })
    return resource
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  const target = (resource: Fixture) => ({
    patchId: patch.id,
    resourceId: resource.id,
    linkId: resource.links[0].id,
    linkVersion: resource.links[0].version
  })
  const detail = async (resource: Fixture) =>
    data(
      await request<WorkspaceResourceDetail>(
        owner,
        'GET',
        `/api/workspace/resources/${resource.id}`
      )
    )
  const current = async (resource: Fixture) => {
    const result = await detail(resource)
    const item = result.maintenance.find(
      (entry) => entry.linkId === resource.links[0].id
    )
    assert(item, 'Owner detail must expose the maintenance target')
    return item
  }
  const maintenance = async (
    resource: Fixture,
    action: Record<string, unknown>
  ) => {
    const item = await current(resource)
    return request<LinkMaintenanceActionResponse>(
      owner,
      'POST',
      '/api/workspace/maintenance',
      {
        ...target(resource),
        maintenanceRevision: item.maintenanceRevision,
        ...action
      }
    )
  }
  const acquire = async (resource: Fixture, reporter: Actor) => {
    data(
      await request(reporter, 'POST', '/api/patch/resource/download/access', {
        patchId: patch.id,
        resourceId: resource.id,
        linkId: resource.links[0].id
      })
    )
  }
  const report = (resource: Fixture, reporter: Actor) =>
    request<LinkReportResponse>(
      reporter,
      'POST',
      '/api/patch/resource/link/report',
      { ...target(resource), reason: 'deleted' }
    )
  const input = (
    value: WorkspaceResourceDetail
  ): WorkspaceResourceUpdateInput => ({
    name: value.name,
    section: value.section as 'galgame' | 'patch',
    note: value.note,
    type: value.type,
    language: value.language,
    platform: value.platform,
    baseLinks: value.baseLinks,
    links: value.links.map((link) =>
      link.protected
        ? { id: link.id, version: link.version }
        : {
            id: link.id,
            storage: link.storage,
            size: link.size,
            content: link.content,
            code: link.code,
            password: link.password,
            hash: link.hash
          }
    )
  })
  const publisherMessages = () =>
    prisma.user_message.count({ where: { recipient_id: owner.id } })
  const pendingCount = async () =>
    data(
      await request<{ owned: number; waitingReporter: number }>(
        owner,
        'GET',
        '/api/case/pending-count'
      )
    )

  const protectedResource = await fixture('保护槽位', { protected: true })
  const ownDetail = await detail(protectedResource)
  assert.equal(
    ownDetail.name,
    protectedResource.name,
    'The running server must use the exact disposable fixture'
  )
  assert.equal(ownDetail.patchId, patch.id)
  assert.equal(
    (await request(null, 'GET', '/api/workspace/resources')).status,
    401
  )
  assert.equal(
    (
      await request(
        other,
        'GET',
        `/api/workspace/resources/${protectedResource.id}`
      )
    ).status,
    404
  )
  assert.equal(
    (
      await request(
        other,
        'PUT',
        `/api/workspace/resources/${protectedResource.id}`,
        input(ownDetail)
      )
    ).status,
    403
  )
  assert.equal(
    (
      await request(
        other,
        'DELETE',
        `/api/workspace/resources/${protectedResource.id}`
      )
    ).status,
    404
  )
  assert.equal(
    (await request(owner, 'GET', `/api/workspace/resources?userId=${other.id}`))
      .status,
    400
  )
  const emptyList = data(
    await request<WorkspaceResourcesResponse>(
      empty,
      'GET',
      '/api/workspace/resources'
    )
  )
  assert.equal(emptyList.total, 0)
  assert.equal((await request(empty, 'GET', '/workspace/issues')).status, 200)
  assert.equal((await request(empty, 'GET', '/dashboard')).status, 307)
  await passed(
    'session ownership, query whitelist, empty-user workspace and administrator gate'
  )

  assert.equal(
    await prisma.patch_resource_access.count({ where: { patch_id: patch.id } }),
    0
  )
  assert.equal(
    await prisma.patch_resource_access_grant.count({
      where: { resource: { patch_id: patch.id } }
    }),
    0
  )
  const protectedSlot = ownDetail.links.find(
    (link) => link.storage === 'touchgal'
  )
  assert(protectedSlot)
  assert.deepEqual(Object.keys(protectedSlot).sort(), [
    'id',
    'protected',
    'storage',
    'version'
  ])
  for (const field of [
    'content',
    'code',
    'password',
    'hash',
    'storage',
    'sortOrder'
  ]) {
    const submitted = input(ownDetail)
    submitted.links[1] = {
      ...submitted.links[1],
      [field]: field === 'sortOrder' ? 1 : 'forged'
    }
    assert.equal(
      (
        await request(
          owner,
          'PUT',
          `/api/workspace/resources/${protectedResource.id}`,
          submitted
        )
      ).status,
      400,
      field
    )
  }
  const incomplete = input(ownDetail)
  incomplete.links.pop()
  assert.equal(
    (
      await request(
        owner,
        'PUT',
        `/api/workspace/resources/${protectedResource.id}`,
        incomplete
      )
    ).status,
    403
  )
  const reordered = input(ownDetail)
  reordered.links.reverse()
  assert.equal(
    (
      await request(
        owner,
        'PUT',
        `/api/workspace/resources/${protectedResource.id}`,
        reordered
      )
    ).status,
    403
  )
  assert.equal(
    (
      await request(
        owner,
        'DELETE',
        `/api/workspace/resources/${protectedResource.id}`
      )
    ).status,
    403
  )
  const renamed = input(ownDetail)
  renamed.name += ' 已编辑'
  data(
    await request(
      owner,
      'PUT',
      `/api/workspace/resources/${protectedResource.id}`,
      renamed
    )
  )
  const retained = await prisma.patch_resource_link.findUniqueOrThrow({
    where: { id: protectedSlot.id }
  })
  assert.equal(retained.content, 'https://example.invalid/protected')
  assert.equal(retained.code, 'protected-code')
  assert.equal(retained.hash, 'protected-hash')
  await passed(
    'management read creates no grants; protected references reject unknown fields, deletion and reordering'
  )

  for (const status of [1, 2]) {
    const locked = await fixture(`只读 ${status}`, { status })
    const readonly = await detail(locked)
    assert.equal(readonly.capabilities.canEdit, false)
    for (const link of readonly.links)
      assert.deepEqual(Object.keys(link).sort(), [
        'id',
        'protected',
        'storage',
        'version'
      ])
    assert.equal(
      (
        await request(owner, 'PUT', `/api/workspace/resources/${locked.id}`, {
          ...renamed,
          baseLinks: readonly.baseLinks,
          links: readonly.links.map(({ id, version }) => ({ id, version }))
        })
      ).status,
      403
    )
    const legacy = {
      ...renamed,
      patchId: patch.id,
      resourceId: locked.id,
      baseLinks: readonly.baseLinks,
      links: locked.links.map((link) => ({
        id: link.id,
        storage: link.storage,
        size: link.size,
        content: link.content,
        code: link.code,
        password: link.password,
        hash: link.hash
      }))
    }
    const legacyResult = await request(
      owner,
      'PUT',
      '/api/patch/resource',
      legacy
    )
    assert.equal(typeof legacyResult.data, 'string')
    assert.equal(
      (
        await prisma.patch_resource.findUniqueOrThrow({
          where: { id: locked.id }
        })
      ).name,
      locked.name
    )
  }
  await passed(
    'pending and banned author resources remain read-only through both write entrances'
  )

  const concurrent = await fixture('并发反馈')
  await Promise.all(
    reporters.slice(0, 3).map((reporter) => acquire(concurrent, reporter))
  )
  const noticesBefore = await publisherMessages()
  const firstReports = await Promise.all(
    reporters.slice(0, 2).map((reporter) => report(concurrent, reporter))
  )
  assert.equal(
    firstReports
      .map(data)
      .filter((result) => result.maintenance?.publisherNotified).length,
    1
  )
  assert.equal(
    firstReports
      .map(data)
      .filter((result) => result.maintenance?.event === 'opened').length,
    1
  )
  assert.equal((await publisherMessages()) - noticesBefore, 1)
  let item = await current(concurrent)
  assert.equal(item.state, 'pending')
  assert.equal(item.health.health, 'ok')
  const eventId = item.eventId
  const round = item.round
  assert.equal(data(await report(concurrent, reporters[0])).report, 'duplicate')
  data(await report(concurrent, reporters[2]))
  item = await current(concurrent)
  assert.equal(item.health.health, 'suspect')
  assert(item.caseId)
  assert.equal(item.eventId, eventId)
  assert.equal((await publisherMessages()) - noticesBefore, 1)
  assert.equal((await pendingCount()).owned, 1)
  const ownedCases = data(
    await request<CaseListResponse>(
      owner,
      'GET',
      '/api/case?tab=owned&page=1&limit=20'
    )
  )
  assert.equal(ownedCases.total, 0)
  await passed(
    'concurrent positive reports open one event and one notification; health cases do not duplicate publisher todo'
  )

  const caseBefore = await prisma.ops_case.findUniqueOrThrow({
    where: { id: item.caseId }
  })
  const contextBefore = await prisma.ops_case_message.findMany({
    where: { case_id: item.caseId },
    orderBy: { id: 'asc' }
  })
  const snooze = data(
    await maintenance(concurrent, { action: 'snooze', days: 1 })
  )
  assert.equal(snooze.item.state, 'snoozed')
  assert(Date.parse(snooze.item.snoozedUntil!) > Date.now() + 23 * 3600000)
  assert.equal((await pendingCount()).owned, 0)
  const callsBefore = checkerCalls
  await acquire(concurrent, reporters[3])
  assert.equal((await report(concurrent, reporters[3])).status, 409)
  assert.equal(checkerCalls, callsBefore)
  const spoofDeadline = await maintenance(concurrent, {
    action: 'snooze',
    days: 3,
    snoozedUntil: '2099-01-01T00:00:00Z'
  })
  assert.equal(spoofDeadline.status, 400)
  assert.deepEqual(
    await prisma.ops_case.findUniqueOrThrow({ where: { id: item.caseId } }),
    caseBefore
  )
  assert.deepEqual(
    await prisma.ops_case_message.findMany({
      where: { case_id: item.caseId },
      orderBy: { id: 'asc' }
    }),
    contextBefore
  )
  await passed(
    'snooze uses server time, freezes before outbound checks, and preserves health case clocks/context'
  )

  await pool.query(
    'UPDATE patch_resource_link_maintenance_event SET snoozed_until=$1 WHERE id=$2',
    [new Date(Date.now() - 1000).toISOString(), eventId]
  )
  const resumedByTime = await current(concurrent)
  assert.equal(resumedByTime.state, 'pending')
  assert.equal(resumedByTime.eventId, eventId)
  assert.equal(resumedByTime.health.maintenance?.restriction, null)
  assert.equal((await pendingCount()).owned, 1)
  await acquire(concurrent, reporters[4])
  const mergedAfterExpiry = data(await report(concurrent, reporters[4]))
  assert.equal(mergedAfterExpiry.maintenance?.event, 'merged')
  assert.equal(mergedAfterExpiry.maintenance?.publisherNotified, false)
  assert.equal((await publisherMessages()) - noticesBefore, 1)
  const threeDay = data(
    await maintenance(concurrent, { action: 'snooze', days: 3 })
  )
  assert(Date.parse(threeDay.item.snoozedUntil!) > Date.now() + 71 * 3600000)
  assert.equal(threeDay.item.eventId, eventId)
  await passed(
    'expired snooze resumes the same round and accepts merged reports without sending another first-report notification'
  )

  const stop = data(
    await maintenance(concurrent, { action: 'stop', note: '此版本停止维护。' })
  )
  assert.equal(stop.item.state, 'stopped')
  assert.equal((await pendingCount()).owned, 0)
  assert.equal((await report(concurrent, reporters[3])).status, 409)
  const resume = data(await maintenance(concurrent, { action: 'resume' }))
  assert.equal(resume.link.maintenance?.restriction, null)
  assert.equal((await pendingCount()).owned, 0)
  const messagesAfterResume = await publisherMessages()
  const oldDuplicate = data(await report(concurrent, reporters[0]))
  assert.equal(oldDuplicate.report, 'duplicate')
  assert.equal(oldDuplicate.maintenance?.event, 'none')
  assert.equal((await pendingCount()).owned, 0)
  const newRound = data(await report(concurrent, reporters[3]))
  assert.equal(newRound.maintenance?.publisherNotified, true)
  const newItem = await current(concurrent)
  assert.notEqual(newItem.eventId, eventId)
  assert(newItem.round! > round!)
  assert.equal((await publisherMessages()) - messagesAfterResume, 1)
  await passed(
    'stop and resume preserve health and only a fresh effective report starts the next maintenance round'
  )

  const inFlight = await fixture('在途反馈', { health: 'broken' })
  await acquire(inFlight, reporters[4])
  holdNextCheck = true
  const inflightReport = report(inFlight, reporters[4])
  await eventually(
    () => heldResponse !== null,
    'controlled checker did not receive the in-flight report'
  )
  data(
    await maintenance(inFlight, {
      action: 'stop',
      note: '停止维护，测试在途检查。'
    })
  )
  const response = heldResponse
  assert(response)
  heldResponse = null
  sendCheck(response)
  assert.equal((await inflightReport).status, 409)
  assert.equal(
    await prisma.patch_resource_link_report.count({
      where: { link_id: inFlight.links[0].id }
    }),
    0
  )
  await passed(
    'an in-flight report cannot bypass a maintenance freeze committed during checker I/O'
  )

  const verifyFixture = await fixture('核实与通知')
  for (const reporter of reporters.slice(0, 3)) {
    await acquire(verifyFixture, reporter)
    data(await report(verifyFixture, reporter))
  }
  const verifyItem = await current(verifyFixture)
  assert.equal(verifyItem.health.health, 'suspect')
  const recipientIds = reporters.slice(0, 3).map((reporter) => reporter.id)
  const resultCountsBefore = await Promise.all(
    recipientIds.map((recipient_id) =>
      prisma.user_message.count({ where: { recipient_id } })
    )
  )
  const basis: LinkHealthBasis = {
    ...target(verifyFixture),
    health: verifyItem.health.health,
    evidenceRound: verifyItem.health.evidenceRound,
    healthChangedAt: verifyItem.health.healthChangedAt
  }
  const verified = data(
    await maintenance(verifyFixture, {
      action: 'verify',
      note: '已核实当前链接可用。',
      basis
    })
  )
  assert.equal(verified.link.health, 'ok')
  assert.equal(verified.item.state, 'handled')
  for (const [index, recipient_id] of recipientIds.entries()) {
    assert.equal(
      (await prisma.user_message.count({ where: { recipient_id } })) -
        resultCountsBefore[index],
      1
    )
    const notification = await prisma.user_message.findFirstOrThrow({
      where: { recipient_id },
      orderBy: { id: 'desc' }
    })
    assert(!notification.link.startsWith('/workspace/resources/'))
  }
  await passed(
    'verification and maintenance completion share one transaction and one result notification per reporter'
  )
  const zeroWeight = data(await report(verifyFixture, reporters[0]))
  assert.equal(zeroWeight.weight, 0)
  assert.equal(zeroWeight.maintenance?.event, 'none')
  assert.equal((await current(verifyFixture)).state, 'handled')
  await passed(
    'a zero-weight report after verification cannot independently open another maintenance event'
  )

  const relink = await fixture('补链编辑')
  await acquire(relink, reporters[5])
  data(await report(relink, reporters[5]))
  data(await maintenance(relink, { action: 'stop', note: '等待替换地址。' }))
  const relinkDetail = await detail(relink)
  const codeOnly = input(relinkDetail)
  const codeSlot = codeOnly.links[0]
  assert('code' in codeSlot)
  codeSlot.code = 'new-code'
  data(
    await request(
      owner,
      'PUT',
      `/api/workspace/resources/${relink.id}`,
      codeOnly
    )
  )
  assert.equal(
    (await current(relink)).health.maintenance?.restriction,
    'stopped'
  )
  const replacement = input(await detail(relink))
  const addressSlot = replacement.links[0]
  assert('content' in addressSlot)
  addressSlot.content = 'https://pan.quark.cn/s/ffffffffffff'
  data(
    await request(
      owner,
      'PUT',
      `/api/workspace/resources/${relink.id}`,
      replacement
    )
  )
  const updatedLink = await prisma.patch_resource_link.findUniqueOrThrow({
    where: { id: relink.links[0].id }
  })
  assert.equal(updatedLink.version, relink.links[0].version + 1)
  const publicAfterRelink = data(
    await request<
      {
        id: number
        links: { id: number; maintenance: { restriction: string | null } }[]
      }[]
    >(owner, 'GET', `/api/patch/resource?patchId=${patch.id}`)
  )
  assert.equal(
    publicAfterRelink
      .find((row) => row.id === relink.id)
      ?.links.find((link) => link.id === updatedLink.id)?.maintenance
      .restriction,
    null
  )
  assert.equal(
    (
      await request(
        owner,
        'PUT',
        `/api/workspace/resources/${relink.id}`,
        codeOnly
      )
    ).status,
    409
  )
  await passed(
    'code changes retain freeze; address changes advance version and release it; stale edit baselines fail'
  )

  const machine = await fixture('纯机器异常')
  checkerMode = 'dead'
  const machineRow = await prisma.patch_resource_link.findUniqueOrThrow({
    where: { id: machine.links[0].id }
  })
  const machineNotices = await publisherMessages()
  data(
    await request(other, 'POST', '/api/patch/resource/link-check', {
      ...target(machine),
      evidenceRound: machineRow.evidence_round,
      health: machineRow.health,
      healthChangedAt: null
    })
  )
  checkerMode = 'unknown'
  assert.equal(await publisherMessages(), machineNotices)
  assert.equal((await current(machine)).state, 'optional')
  data(await maintenance(machine, { action: 'stop', note: '此地址不再维护。' }))
  assert.equal(await publisherMessages(), machineNotices)
  await passed(
    'machine failures remain optional and stopping them creates no artificial report or notification'
  )

  const oldAndNew = await prisma.ops_case.create({
    data: {
      kind: 'resource_other',
      target_type: 'resource',
      target_id: protectedResource.id,
      patch_id: patch.id,
      reporter_id: reporters[0].id,
      owner_type: 'publisher',
      owner_id: owner.id,
      status: 'open',
      public: true
    }
  })
  await prisma.ops_case_message.create({
    data: {
      case_id: oldAndNew.id,
      author_id: reporters[0].id,
      kind: 'report',
      body: '用于验证历史通知地址。'
    }
  })
  const notificationRows = await Promise.all(
    [
      { recipient_id: owner.id, link: `/issue/${oldAndNew.id}` },
      { recipient_id: owner.id, link: `/workspace/issues/${oldAndNew.id}` },
      {
        recipient_id: owner.id,
        link: `/workspace/issues/${oldAndNew.id}?extra=1`
      },
      { recipient_id: other.id, link: `/issue/${oldAndNew.id}` }
    ].map((row) =>
      prisma.user_message.create({
        data: { ...row, type: 'system', content: '验收通知' }
      })
    )
  )
  data(await request(owner, 'GET', `/api/case/${oldAndNew.id}`))
  const notificationStates = await prisma.user_message.findMany({
    where: { id: { in: notificationRows.map((row) => row.id) } },
    orderBy: { id: 'asc' }
  })
  assert.deepEqual(
    notificationRows.map(
      (created) =>
        notificationStates.find((row) => row.id === created.id)?.status
    ),
    [1, 1, 0, 0]
  )
  const redirect = await request(
    owner,
    'GET',
    `/issue?tab=owned&status=processing&page=2&id=${oldAndNew.id}&unsafe=1`
  )
  assert.equal(redirect.status, 307)
  const location = redirect.headers.get('location')!
  assert(location.includes('/workspace/issues?'))
  assert(location.includes('tab=owned') && location.includes('page=2'))
  assert(!location.includes('unsafe'))
  await passed(
    'exact old/new notification reads preserve other recipients and compatibility redirects preserve valid filters'
  )

  const allResourcesBefore = data(
    await request<{ id: number }[]>(
      owner,
      'GET',
      `/api/patch/resource?patchId=${patch.id}`
    )
  ).map((row) => row.id)
  const healthTarget = await prisma.patch_resource_link.findUniqueOrThrow({
    where: { id: machine.links[0].id }
  })
  data(
    await request(owner, 'POST', '/api/patch/resource/link/health', {
      ...target(machine),
      action: 'verify',
      evidenceRound: healthTarget.evidence_round,
      health: healthTarget.health,
      healthChangedAt: healthTarget.health_changed_at?.toISOString() ?? null
    })
  )
  const allResourcesAfter = data(
    await request<{ id: number }[]>(
      owner,
      'GET',
      `/api/patch/resource?patchId=${patch.id}`
    )
  ).map((row) => row.id)
  assert.deepEqual(allResourcesAfter, allResourcesBefore)
  await passed('public resource order remains stable after health changes')

  const feedback = data(
    await request<LinkMaintenanceListResponse>(
      owner,
      'GET',
      '/api/workspace/maintenance?view=feedback&page=1&limit=50'
    )
  )
  assert(
    feedback.items.every((row) => ['pending', 'snoozed'].includes(row.state))
  )
  const optional = data(
    await request<LinkMaintenanceListResponse>(
      owner,
      'GET',
      '/api/workspace/maintenance?view=optional&page=1&limit=50'
    )
  )
  assert(optional.items.every((row) => row.state === 'optional'))
  const handled = data(
    await request<LinkMaintenanceListResponse>(
      owner,
      'GET',
      '/api/workspace/maintenance?view=handled&page=1&limit=50'
    )
  )
  assert(
    handled.items.some(
      (row) => row.state === 'handled' || row.state === 'stopped'
    )
  )
  await passed(
    'maintenance filters return one private author list with explicit state boundaries'
  )

  const timed = await fixture('健康时钟独立')
  for (const reporter of reporters.slice(5, 8)) {
    await acquire(timed, reporter)
    data(await report(timed, reporter))
  }
  const timedItem = await current(timed)
  assert(timedItem.caseId)
  data(await maintenance(timed, { action: 'snooze', days: 3 }))
  const dueAt = new Date(Date.now() - 7 * 86400000 - 1000).toISOString()
  await pool.query(
    'UPDATE patch_resource_link SET health_changed_at=$1 WHERE id=$2',
    [dueAt, timed.links[0].id]
  )
  await pool.query(
    `UPDATE ops_case_message SET payload=jsonb_set(payload,'{link_health,healthChangedAt}',to_jsonb($1::text))
    WHERE id=(SELECT id FROM ops_case_message WHERE case_id=$2 AND kind='system' AND payload ? 'link_health' ORDER BY created DESC,id DESC LIMIT 1)`,
    [dueAt, timedItem.caseId]
  )
  const beforeTimerNotices = await publisherMessages()
  const { runDueLinkHealth } = await import(
    '../../app/api/patch/resource/link/service'
  )
  serviceRuntimeLoaded = true
  const timedResult = await runDueLinkHealth({
    ...target(timed),
    evidenceRound: timedItem.health.evidenceRound,
    health: 'suspect',
    healthChangedAt: dueAt
  })
  assert.equal(timedResult.changed, true)
  assert.equal((await current(timed)).health.health, 'broken')
  assert.equal((await current(timed)).state, 'snoozed')
  assert.equal((await current(timed)).eventId, timedItem.eventId)
  assert.equal(
    (
      await prisma.ops_case.findUniqueOrThrow({
        where: { id: timedItem.caseId }
      })
    ).status,
    'resolved'
  )
  assert.equal(await publisherMessages(), beforeTimerNotices)
  const healthBeforeResponse =
    await prisma.patch_resource_link.findUniqueOrThrow({
      where: { id: timed.links[0].id }
    })
  const pendingBeforeResponse = (await pendingCount()).owned
  const privateNote = `${run} 仅参与者可见的维护说明`
  data(await maintenance(timed, { action: 'respond', note: privateNote }))
  assert.equal((await current(timed)).state, 'handled')
  assert.deepEqual(
    await prisma.patch_resource_link.findUniqueOrThrow({
      where: { id: timed.links[0].id }
    }),
    healthBeforeResponse
  )
  assert.equal((await pendingCount()).owned, pendingBeforeResponse)
  const publicResponse = await request(
    owner,
    'GET',
    `/api/patch/resource?patchId=${patch.id}`
  )
  assert(!JSON.stringify(publicResponse.data).includes(privateNote))
  await passed(
    'seven-day health timeout continues during snooze; health closure and private maintenance response remain independent'
  )

  const removable = await fixture('删除维护资源')
  for (const reporter of reporters.slice(0, 3)) {
    await acquire(removable, reporter)
    data(await report(removable, reporter))
  }
  const removalItem = await current(removable)
  const balanceBeforeDelete = (
    await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })
  ).moemoepoint
  const removalNotices = await Promise.all(
    reporters
      .slice(0, 3)
      .map((reporter) =>
        prisma.user_message.count({ where: { recipient_id: reporter.id } })
      )
  )
  data(
    await request(owner, 'DELETE', `/api/workspace/resources/${removable.id}`)
  )
  assert.equal(
    await prisma.patch_resource.count({ where: { id: removable.id } }),
    0
  )
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
      .moemoepoint,
    balanceBeforeDelete - 3
  )
  const removalControl = (
    await pool.query<{ link_id: number | null }>(
      'SELECT link_id FROM patch_resource_link_maintenance WHERE original_link_id=$1',
      [removable.links[0].id]
    )
  ).rows[0]
  assert(removalControl)
  assert.equal(removalControl.link_id, null)
  assert.equal(
    (
      await pool.query<{ state: string; outcome: string }>(
        'SELECT state,outcome FROM patch_resource_link_maintenance_event WHERE id=$1',
        [removalItem.eventId]
      )
    ).rows[0].outcome,
    'removed'
  )
  for (const [index, reporter] of reporters.slice(0, 3).entries()) {
    assert.equal(
      (await prisma.user_message.count({
        where: { recipient_id: reporter.id }
      })) - removalNotices[index],
      1
    )
  }
  assert(
    !data(
      await request<LinkMaintenanceListResponse>(
        owner,
        'GET',
        '/api/workspace/maintenance?view=feedback&limit=50'
      )
    ).items.some((entry) => entry.resourceId === removable.id)
  )
  await passed(
    'whole-resource deletion retires maintenance, retains its history, reverses points once and merges reporter results'
  )

  const movable = await fixture('移动维护资源')
  await acquire(movable, reporters[6])
  data(await report(movable, reporters[6]))
  const moveBefore = await current(movable)
  const destination = await prisma.patch.create({
    data: {
      unique_id: randomUUID().replaceAll('-', '').slice(0, 8),
      name: `${run} 目标条目`,
      user_id: owner.id,
      content_limit: 'sfw',
      type: [],
      language: ['ja'],
      platform: ['windows'],
      engine: []
    }
  })
  const moveCase = await prisma.ops_case.create({
    data: {
      kind: 'resource_wrong_patch',
      target_type: 'resource',
      target_id: movable.id,
      patch_id: patch.id,
      reporter_id: reporters[6].id,
      owner_type: 'staff',
      status: 'open',
      public: true
    }
  })
  const eventBeforeMove = (
    await pool.query(
      'SELECT round,state,publisher_notified_at,result_notified_at FROM patch_resource_link_maintenance_event WHERE id=$1',
      [moveBefore.eventId]
    )
  ).rows[0]
  data(
    await request(staff, 'POST', `/api/admin/case/${moveCase.id}/resource`, {
      action: 'move',
      targetPatchId: destination.id,
      content: '移动到正确的测试条目。'
    })
  )
  const movedDetail = await detail(movable)
  const moveAfter = movedDetail.maintenance.find(
    (entry) => entry.linkId === movable.links[0].id
  )
  assert(moveAfter)
  assert.equal(moveAfter.patchId, destination.id)
  assert.equal(moveAfter.eventId, moveBefore.eventId)
  assert.equal(moveAfter.round, moveBefore.round)
  assert.equal(moveAfter.linkVersion, moveBefore.linkVersion)
  assert.deepEqual(
    (
      await pool.query(
        'SELECT round,state,publisher_notified_at,result_notified_at FROM patch_resource_link_maintenance_event WHERE id=$1',
        [moveBefore.eventId]
      )
    ).rows[0],
    eventBeforeMove
  )
  await passed(
    'resource moves retarget maintenance without resetting its round, address version or notification markers'
  )

  const uploadOther = await actor('u2', 3)
  const uploadedResource = await fixture('上传衔接', { ownerId: staff.id })
  const wrongUploadResource = await fixture('素材归属', {
    ownerId: uploadOther.id
  })
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(2048).fill(1)], { type: 'application/zip' }),
    'controlled.zip'
  )
  form.append('captcha', '')
  const uploadHttp = await fetch(`${origin.origin}/api/upload/resource`, {
    method: 'POST',
    body: form,
    headers: {
      origin: origin.origin,
      'x-requested-with': 'kun-fetch',
      cookie: `kun-galgame-patch-moe-token=${staff.token}`
    }
  })
  assert.equal(uploadHttp.status, 200)
  const uploaded = (await uploadHttp.json()) as KunUploadFileResponse | string
  assert(
    typeof uploaded !== 'string',
    'Controlled resource upload must return registered metadata'
  )
  const uploadInput = (value: WorkspaceResourceDetail) => ({
    ...input(value),
    links: [
      {
        id: value.links[0].id,
        storage: 's3',
        uploadId: uploaded.uploadId,
        content: 'https://example.invalid/forged-client-address',
        hash: 'forged-client-hash',
        size: '99GB',
        code: '',
        password: ''
      }
    ]
  })
  const wrongUploadDetail = data(
    await request<WorkspaceResourceDetail>(
      uploadOther,
      'GET',
      `/api/workspace/resources/${wrongUploadResource.id}`
    )
  )
  const wrongUpload = await request(
    uploadOther,
    'PUT',
    `/api/workspace/resources/${wrongUploadResource.id}`,
    uploadInput(wrongUploadDetail)
  )
  assert(wrongUpload.status >= 400)
  assert.equal(objectPuts, 0)
  assert.equal(
    (
      await prisma.patch_resource_link.findUniqueOrThrow({
        where: { id: wrongUploadResource.links[0].id }
      })
    ).storage,
    'user'
  )
  const uploadDetail = data(
    await request<WorkspaceResourceDetail>(
      staff,
      'GET',
      `/api/workspace/resources/${uploadedResource.id}`
    )
  )
  data(
    await request(
      staff,
      'PUT',
      `/api/workspace/resources/${uploadedResource.id}`,
      uploadInput(uploadDetail)
    )
  )
  const savedUpload = await prisma.patch_resource_link.findUniqueOrThrow({
    where: { id: uploadedResource.links[0].id }
  })
  assert.equal(savedUpload.hash, uploaded.fileHash)
  assert.equal(savedUpload.size, uploaded.fileSize)
  assert(
    savedUpload.content.startsWith(
      required('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL')
    )
  )
  assert.equal(objectPuts, 1)
  assert.equal(
    await redis.get(`kun:touchgal:upload:${uploaded.uploadId}`),
    null
  )
  const afterUpload = data(
    await request<WorkspaceResourceDetail>(
      staff,
      'GET',
      `/api/workspace/resources/${uploadedResource.id}`
    )
  )
  data(
    await request(
      staff,
      'PUT',
      `/api/workspace/resources/${uploadedResource.id}`,
      { ...input(afterUpload), note: '再次保存已经登记完成的资源。' }
    )
  )
  assert.equal(objectPuts, 1)
  await passed(
    'real upload metadata enforces ownership, replaces forged client fields, finalizes once and supports later edits'
  )

  const dispute = await fixture('争议通知边界')
  const disputeOwnerNotices = await publisherMessages()
  const staffNotices = await prisma.user_message.count({
    where: { recipient_id: staff.id }
  })
  checkerMode = 'alive'
  for (const reporter of reporters.slice(2, 5)) {
    await acquire(dispute, reporter)
    data(await report(dispute, reporter))
  }
  checkerMode = 'unknown'
  assert.equal((await current(dispute)).health.health, 'disputed')
  assert.equal(
    (await publisherMessages()) - disputeOwnerNotices,
    1,
    'Opening a staff dispute must not add a second publisher reminder'
  )
  assert(
    (await prisma.user_message.count({ where: { recipient_id: staff.id } })) >
      staffNotices
  )
  await passed(
    'machine/report dispute notifies the staff queue while the publisher receives only the maintenance first report'
  )

  if (process.env.KUN_E2E_SKIP_BROWSER !== 'true') {
    const browserEdit = await fixture('浏览器草稿')
    const browserCheck = await fixture('浏览器健康投影')
    const longPassword = `synthetic-password-${'x'.repeat(500)}`
    await prisma.patch_resource_link.update({
      where: { id: browserEdit.links[0].id },
      data: {
        content: `https://example.invalid/${'long-address-'.repeat(40)}`,
        password: longPassword,
        code: `synthetic-code-${'y'.repeat(300)}`
      }
    })
    await prisma.patch_resource_link.update({
      where: { id: browserCheck.links[0].id },
      data: { password: longPassword }
    })
    const browser = await chromium.launch({
      executablePath: required('KUN_E2E_BROWSER_PATH'),
      headless: true
    })
    try {
      if (process.env.KUN_E2E_BROWSER_PHASE !== 'public') {
        for (const width of [360, 390, 1280]) {
          await redis.del(`kun:touchgal:link-health:user:${owner.id}`)
          const context = await browser.newContext({
            viewport: { width, height: 900 }
          })
          await context.addCookies([
            {
              name: 'kun-galgame-patch-moe-token',
              value: owner.token,
              url: origin.origin
            }
          ])
          const page = await context.newPage()
          const adminRequests: string[] = []
          page.on('request', (outgoing) => {
            if (new URL(outgoing.url()).pathname.startsWith('/api/admin/'))
              adminRequests.push(outgoing.url())
          })
          for (const path of [
            '/workspace/resources',
            '/workspace/entries',
            '/workspace/issues',
            `/workspace/resources/${protectedResource.id}`
          ]) {
            await page.goto(`${origin.origin}${path}`, {
              waitUntil: 'networkidle'
            })
            await page.waitForTimeout(150)
            assert.equal(
              await page.evaluate(
                () =>
                  document.documentElement.scrollWidth <= window.innerWidth + 1
              ),
              true,
              `${width}px overflow at ${path}`
            )
            assert(
              !(await page
                .getByText('Internal Server Error', { exact: true })
                .count())
            )
          }
          assert.equal(
            adminRequests.length,
            0,
            'User shell must not load administrator menus or counts'
          )
          await page.goto(
            `${origin.origin}/workspace/resources/${browserEdit.id}`,
            { waitUntil: 'networkidle' }
          )
          const nameInput = page.getByRole('textbox', {
            name: '资源名称',
            exact: true
          })
          await nameInput.waitFor({ state: 'visible' })
          let writes = 0
          const submittedBases: unknown[] = []
          page.on('request', (outgoing) => {
            if (
              new URL(outgoing.url()).pathname ===
                `/api/workspace/resources/${browserEdit.id}` &&
              ['PUT', 'DELETE'].includes(outgoing.method())
            )
              writes += 1
          })
          await page
            .getByRole('button', { name: '删除资源', exact: true })
            .click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: '取消', exact: true })
            .click()
          assert.equal(writes, 0)
          const draftName = `${run} ${width}px 保留草稿`
          await nameInput.fill(draftName)
          await page.route(
            `**/api/workspace/resources/${browserEdit.id}`,
            async (route) => {
              if (route.request().method() !== 'PUT') return route.continue()
              submittedBases.push(
                (route.request().postDataJSON() as WorkspaceResourceUpdateInput)
                  .baseLinks
              )
              await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify('该资源已被他人修改，请刷新后重试')
              })
            }
          )
          await page.getByRole('button', { name: '保存', exact: true }).click()
          await page
            .getByText('该资源已被他人修改，请刷新后重试', { exact: true })
            .waitFor()
          assert.equal(await nameInput.inputValue(), draftName)
          await prisma.patch_resource_link.update({
            where: { id: browserEdit.links[0].id },
            data: {
              version: { increment: 1 },
              content: `https://example.invalid/new-${randomUUID()}`
            }
          })
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/api/workspace/resources/${browserEdit.id}` &&
              response.request().method() === 'GET'
          )
          await page
            .getByRole('button', { name: '重新读取', exact: true })
            .first()
            .click()
          await refreshed
          assert.equal(await nameInput.inputValue(), draftName)
          await page.getByRole('button', { name: '保存', exact: true }).click()
          await eventually(
            () => submittedBases.length === 2,
            'Second editor submission did not arrive'
          )
          assert.deepEqual(
            submittedBases[1],
            submittedBases[0],
            'Background refresh must not advance the captured edit baseline'
          )
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            true
          )
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(100)
          await page.screenshot({
            path: resolve(artifactDir, `workspace-${width}.png`),
            fullPage: true
          })

          const readonlyRows = await prisma.patch_resource.findMany({
            where: {
              patch_id: patch.id,
              user_id: owner.id,
              status: { in: [1, 2] }
            },
            select: { id: true },
            orderBy: { id: 'asc' }
          })
          for (const readonlyRow of readonlyRows) {
            await page.goto(
              `${origin.origin}/workspace/resources/${readonlyRow.id}`,
              { waitUntil: 'networkidle' }
            )
            assert.equal(
              await page
                .getByRole('textbox', { name: '资源名称', exact: true })
                .isDisabled(),
              true
            )
            assert.equal(
              await page
                .getByRole('textbox', { name: '链接地址', exact: true })
                .count(),
              0
            )
            let readonlyDeletes = 0
            const watchDelete = (
              outgoing: import('playwright-core').Request
            ) => {
              if (
                new URL(outgoing.url()).pathname ===
                  `/api/workspace/resources/${readonlyRow.id}` &&
                outgoing.method() === 'DELETE'
              )
                readonlyDeletes += 1
            }
            page.on('request', watchDelete)
            await page
              .getByRole('button', { name: '删除资源', exact: true })
              .click()
            await page
              .getByRole('alertdialog')
              .getByRole('button', { name: '取消', exact: true })
              .click()
            assert.equal(readonlyDeletes, 0)
            page.off('request', watchDelete)
          }

          await page.goto(
            `${origin.origin}/workspace/resources/${concurrent.id}?linkId=${concurrent.links[0].id}`,
            { waitUntil: 'networkidle' }
          )
          const maintenanceNote = page
            .getByRole('textbox', { name: '维护说明', exact: true })
            .first()
          await maintenanceNote.waitFor({ state: 'visible' })
          await maintenanceNote.fill(`${width}px 保留维护回应`)
          let maintenanceWrites = 0
          page.on('request', (outgoing) => {
            if (
              new URL(outgoing.url()).pathname ===
                '/api/workspace/maintenance' &&
              outgoing.method() === 'POST'
            )
              maintenanceWrites += 1
          })
          await page
            .getByRole('button', { name: '回应', exact: true })
            .first()
            .click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: '取消', exact: true })
            .click()
          assert.equal(maintenanceWrites, 0)
          await page.route('**/api/workspace/maintenance', (route) =>
            route.request().method() === 'POST'
              ? route.fulfill({
                  status: 409,
                  contentType: 'application/json',
                  body: JSON.stringify('该链接的维护状态已变化，请刷新后重试')
                })
              : route.continue()
          )
          await page
            .getByRole('button', { name: '回应', exact: true })
            .first()
            .click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: '确认', exact: true })
            .click()
          const failedConfirmation = page.getByRole('alertdialog')
          await failedConfirmation
            .getByRole('alert')
            .getByText('该链接的维护状态已变化，请刷新后重试', { exact: true })
            .waitFor()
          await failedConfirmation
            .getByRole('button', { name: '取消', exact: true })
            .click()
          assert.equal(
            await maintenanceNote.inputValue(),
            `${width}px 保留维护回应`
          )
          assert.equal(maintenanceWrites, 1)
          assert(
            !(await page.evaluate(
              (secret) => JSON.stringify(localStorage).includes(secret),
              longPassword
            ))
          )
          await context.close()
        }
        await passed(
          '360px, 390px and 1280px browser: cancellation makes zero writes; failed edits and maintenance preserve input and the original baseline'
        )

        await redis.del(`kun:touchgal:link-health:user:${staff.id}`)
        const uploadContext = await browser.newContext({
          viewport: { width: 390, height: 900 }
        })
        await uploadContext.addCookies([
          {
            name: 'kun-galgame-patch-moe-token',
            value: staff.token,
            url: origin.origin
          }
        ])
        const uploadPage = await uploadContext.newPage()
        await uploadPage.goto(
          `${origin.origin}/workspace/resources/${uploadedResource.id}`,
          { waitUntil: 'networkidle' }
        )
        const fileInput = uploadPage.getByLabel('上传资源文件')
        await fileInput.waitFor({ state: 'visible' })
        assert.equal(
          await fileInput.isEnabled(),
          true,
          'Fresh cookie-only administrator session must have upload capability'
        )
        for (const label of ['链接地址', '资源大小', '校验值'])
          assert.equal(
            await uploadPage.getByLabel(label, { exact: true }).isEditable(),
            false
          )
        let uploadAttempts = 0
        await uploadPage.route('**/api/upload/resource', (route) => {
          uploadAttempts += 1
          return uploadAttempts === 1
            ? route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify('受控上传失败，请重试')
              })
            : route.continue()
        })
        await fileInput.setInputFiles({
          name: 'browser-retry.zip',
          mimeType: 'application/zip',
          buffer: Buffer.alloc(1024, 2)
        })
        await uploadPage
          .getByText('browser-retry.zip', { exact: true })
          .waitFor()
        const uploadedAgain = uploadPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/upload/resource' &&
            response.status() === 200
        )
        await uploadPage
          .getByRole('button', { name: /重试上传|重新上传/ })
          .click()
        await uploadedAgain
        const firstBrowserSave = uploadPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/workspace/resources/${uploadedResource.id}` &&
            response.request().method() === 'PUT'
        )
        await uploadPage
          .getByRole('button', { name: '保存', exact: true })
          .click()
        assert.equal((await firstBrowserSave).status(), 200)
        await eventually(
          () =>
            uploadPage
              .getByRole('button', { name: '保存', exact: true })
              .isEnabled(),
          'Editor did not settle after uploaded save'
        )
        const browserName = uploadPage.getByRole('textbox', {
          name: '资源名称',
          exact: true
        })
        await browserName.fill(`${run} 上传后再编辑`)
        const secondBrowserSave = uploadPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/workspace/resources/${uploadedResource.id}` &&
            response.request().method() === 'PUT'
        )
        await uploadPage
          .getByRole('button', { name: '保存', exact: true })
          .click()
        const savedAgain = await secondBrowserSave
        assert.equal(savedAgain.status(), 200)
        assert(
          (
            savedAgain.request().postDataJSON() as WorkspaceResourceUpdateInput
          ).links.every((link) => !('uploadId' in link))
        )
        assert.equal(uploadAttempts, 2)
        await uploadContext.close()
        await passed(
          'fresh cookie-only browser identity, upload retry, readonly object metadata and repeated saves use the real API correctly'
        )
      }

      await redis.del(`kun:touchgal:link-health:user:${owner.id}`)
      const publicContext = await browser.newContext({
        viewport: { width: 390, height: 900 }
      })
      await publicContext.addCookies([
        {
          name: 'kun-galgame-patch-moe-token',
          value: owner.token,
          url: origin.origin
        }
      ])
      const publicPage = await publicContext.newPage()
      let grants = 0
      publicPage.on('request', (outgoing) => {
        if (
          new URL(outgoing.url()).pathname ===
          '/api/patch/resource/download/access'
        )
          grants += 1
      })
      await publicPage.goto(
        `${origin.origin}/${patch.unique_id}?tab=resources`,
        { waitUntil: 'domcontentloaded', timeout: 60000 }
      )
      let card = publicPage.locator(`#resource-${browserCheck.id}`)
      await card.waitFor({ state: 'visible' })
      await card
        .getByRole('button', { name: '下载 OtomeGame 资源', exact: true })
        .click()
      await card
        .getByRole('button', { name: '获取下载链接', exact: true })
        .click()
      await card.getByText(longPassword, { exact: false }).waitFor()
      await publicPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      card = publicPage.locator(`#resource-${browserCheck.id}`)
      await card.getByText(longPassword, { exact: false }).waitFor()
      const resourceOrder = await publicPage
        .locator('[id^="resource-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.id))
      checkerMode = 'dead'
      await card.getByRole('button', { name: '检测链接', exact: true }).click()
      await publicPage
        .getByRole('dialog')
        .getByRole('button', { name: '确认', exact: true })
        .click()
      const fold = card.getByRole('button', { name: /1 条链接已失效/ })
      await fold.waitFor({ state: 'visible' })
      assert.equal(await fold.getAttribute('aria-expanded'), 'false')
      assert.equal(
        await card.getByText(longPassword, { exact: false }).isVisible(),
        false
      )
      assert.deepEqual(
        await publicPage
          .locator('[id^="resource-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.id)),
        resourceOrder
      )
      await fold.click()
      await card.getByText(longPassword, { exact: false }).waitFor()
      assert.equal(
        grants,
        1,
        'Health transitions must preserve valid revealed credentials'
      )
      checkerMode = 'unknown'
      await card
        .getByRole('button', { name: '我已核实可用', exact: true })
        .click()
      await publicPage
        .getByRole('dialog')
        .getByRole('button', { name: '确认', exact: true })
        .click()
      await fold.waitFor({ state: 'detached' })
      await card.getByText(longPassword, { exact: false }).waitFor()
      assert.equal(grants, 1)
      assert.equal(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        true
      )
      await publicPage.screenshot({
        path: resolve(artifactDir, 'public-health-390.png'),
        fullPage: true
      })
      await publicContext.close()
      await passed(
        'real browser health actions collapse already revealed broken links, restore them in place and retain credentials'
      )
    } finally {
      await browser.close()
    }
  }
}

try {
  await main()
  await writeFile(
    resolve(artifactDir, 'http-results.json'),
    JSON.stringify(
      {
        run,
        checks,
        checkerCalls,
        passed: true,
        browser:
          process.env.KUN_E2E_SKIP_BROWSER === 'true'
            ? 'skipped'
            : (process.env.KUN_E2E_BROWSER_PHASE ?? 'all')
      },
      null,
      2
    )
  )
} catch (error) {
  await mkdir(artifactDir, { recursive: true })
  await writeFile(
    resolve(artifactDir, 'http-results.json'),
    JSON.stringify(
      {
        run,
        checks,
        checkerCalls,
        browser:
          process.env.KUN_E2E_SKIP_BROWSER === 'true'
            ? 'skipped'
            : (process.env.KUN_E2E_BROWSER_PHASE ?? 'all'),
        passed: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  )
  throw error
} finally {
  releaseHeldCheck()
  await new Promise<void>((resolveClose) => checker.close(() => resolveClose()))
  await new Promise<void>((resolveClose) => objects.close(() => resolveClose()))
  if (serviceRuntimeLoaded) {
    const { disconnectPrismaAdapter } = await import('../../prisma/index')
    const { redis: serviceRedis } = await import('../../lib/redis')
    await disconnectPrismaAdapter()
    await serviceRedis.quit()
  }
  await redis.quit()
  await prisma.$disconnect()
  await pool.end()
}
