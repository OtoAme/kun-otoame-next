import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    ops_case: { findUnique: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    ops_case_message: { create: vi.fn(), findMany: vi.fn() },
    ops_case_subscriber: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn()
    },
    patch_resource_link: { findUnique: vi.fn() },
    patch_resource: { findUnique: vi.fn(), updateMany: vi.fn() },
    patch_resource_access: { updateMany: vi.fn() },
    patch: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    user_message: { createMany: vi.fn(), updateMany: vi.fn() },
    admin_log: { create: vi.fn() }
  }
  return { tx, updatePatchAttributes: vi.fn() }
})

vi.mock('~/prisma', () => ({ prisma: mocks.tx }))
vi.mock('~/prisma/index', () => ({ prisma: mocks.tx }))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  updatePatchAttributes: mocks.updatePatchAttributes
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))
vi.mock('~/app/api/case/rateLimit', () => ({
  checkCaseRateLimit: vi.fn().mockResolvedValue(null)
}))

import {
  closeLinkCases,
  openLinkCaseInternal,
  readLinkCaseContext
} from '~/app/api/case/linkHealth'
import {
  getCase,
  createCase,
  openCaseInternal,
  resolveCase,
  reopenCase,
  reviewCase,
  withdrawCase,
  confirmCase,
  proposeCaseClosure,
  handleCaseAsAdmin,
  handleCaseResource,
  upgradeCase,
  timeoutCloseCase,
  remindCase
} from '~/app/api/case/service'
import { createCaseSchema } from '~/validations/case'
import type {
  CloseLinkCasesInput,
  LinkCaseContext
} from '~/types/api/linkHealth'

const now = new Date('2026-10-09T00:00:00Z')
const context = (id = 12, version = 1): LinkCaseContext => ({
  patchId: 7,
  resourceId: 3,
  linkId: id,
  linkVersion: version,
  evidenceRound: 0,
  health: 'suspect',
  healthChangedAt: now.toISOString(),
  source: 'user_reports'
})
const caseRow = (id: number, linkId: number, version: number) => ({
  id,
  kind: 'link_suspect',
  target_type: 'link',
  target_id: linkId,
  patch_id: 7,
  owner_type: 'publisher',
  owner_id: 6,
  reporter_id: null,
  public: true,
  source: 'system',
  status: 'open',
  resolution: null,
  dedup_key: `link:${linkId}:v:${version}`,
  daily_key: null,
  revision: 0,
  status_changed_at: now,
  queue_entered_at: now,
  closed_at: null,
  escalated_at: null,
  first_owner_response_at: null,
  hidden_at: null,
  restored_at: null,
  reopened_count: 0,
  reminded_revision: null,
  created: now,
  updated: now,
  owner: null,
  reporter: null,
  _count: { subscribers: 2 },
  messages: []
})
const linkRow = (id = 12, version = 1) => ({
  id,
  version,
  resource_id: 3,
  patch_id: 7,
  storage: 'quark',
  health: 'suspect',
  evidence_round: 0,
  health_changed_at: now as Date | null,
  resource_user_id: 6,
  resource_name: 'Synthetic resource',
  section: 'galgame',
  resource_status: 0,
  patch_unique_id: 'SYN00001',
  patch_name: 'Synthetic game',
  patch_status: 0
})
let links: ReturnType<typeof linkRow>[]
let cases: ReturnType<typeof caseRow>[]
let contexts: Map<number, unknown[]>
let sqlCalls: { sql: string; values: unknown[] }[]
let messages: Record<string, any>[]
let subscribers: Map<number, Set<number>>
let resource: {
  id: number
  name: string
  section: string
  patch_id: number
  status: number
  user_id: number
  user: { role: number }
  patch: { id: number; unique_id: string; name: string }
}

beforeEach(() => {
  vi.resetAllMocks()
  links = [linkRow(), linkRow(13, 2)]
  cases = [caseRow(40, 12, 1), caseRow(10, 13, 2)]
  contexts = new Map([
    [40, [context()]],
    [10, [context(13, 2)]]
  ])
  sqlCalls = []
  messages = []
  subscribers = new Map([
    [40, new Set([22, 6])],
    [10, new Set([22, 6])]
  ])
  resource = {
    id: 3,
    name: 'Synthetic resource',
    section: 'galgame',
    patch_id: 7,
    status: 0,
    user_id: 6,
    user: { role: 1 },
    patch: { id: 7, unique_id: 'SYN00001', name: 'Synthetic game' }
  }
  mocks.updatePatchAttributes.mockResolvedValue('SYN00001')
  mocks.tx.$transaction.mockImplementation((operation) => operation(mocks.tx))
  mocks.tx.$queryRaw.mockImplementation(
    async (query: { strings: string[]; values: unknown[] }) => {
      const sql = query.strings.join(' ')
      const values = query.values
      sqlCalls.push({ sql, values })
      if (sql.includes('FOR KEY SHARE'))
        return values
          .filter((value) => typeof value === 'number')
          .map((id) => ({ id }))
      if (sql.includes('FROM patch_resource_link l')) {
        const ids = values.filter((value) => typeof value === 'number')
        return links
          .filter((link) =>
            ids.includes(
              /WHERE\s+l\.resource_id/.test(sql) ? link.resource_id : link.id
            )
          )
          .sort((a, b) => a.id - b.id)
      }
      if (sql.includes('FROM patch_resource') && sql.includes('FOR UPDATE'))
        return [resource]
      if (sql.includes("target_type='resource' AND target_id")) {
        return cases
          .filter(
            (row) =>
              (row.target_type === 'resource' &&
                row.target_id === resource.id) ||
              (row.target_type === 'link' && values.includes(row.target_id))
          )
          .sort((a, b) => a.id - b.id)
      }
      if (sql.includes("payload->'link_health'"))
        return (contexts.get(values[0] as number) ?? []).map((value) => ({
          context: value
        }))
      if (sql.includes('CROSS JOIN LATERAL')) {
        return cases
          .filter((row) => values.includes(row.id))
          .flatMap((row) => {
            const event = [...messages]
              .reverse()
              .find(
                (message) =>
                  message.case_id === row.id &&
                  message.kind === 'system' &&
                  (message.event === 'escalated' || message.event === null)
              )
            return event ? [{ case_id: row.id, payload: event.payload }] : []
          })
      }
      if (sql.includes('dedup_key IN')) {
        const keys = values.filter(
          (value) => typeof value === 'string' && value.startsWith('link:')
        )
        return cases
          .filter(
            (row) =>
              row.target_type === 'link' &&
              ['link_suspect', 'link_disputed'].includes(row.kind) &&
              row.source === 'system' &&
              row.reporter_id === null &&
              ['open', 'waiting_owner', 'waiting_reporter'].includes(
                row.status
              ) &&
              keys.includes(row.dedup_key)
          )
          .sort((a, b) => a.id - b.id)
      }
      if (sql.includes('FROM ops_case'))
        return cases.filter((row) => row.id === values[0])
      throw new Error('Unexpected query in isolated case test')
    }
  )
  mocks.tx.ops_case.findUnique.mockImplementation(
    async ({ where }: { where: { id?: number; dedup_key?: string } }) =>
      cases.find((row) =>
        where.id === undefined
          ? row.dedup_key === where.dedup_key
          : row.id === where.id
      ) ?? null
  )
  mocks.tx.ops_case.updateMany.mockImplementation(async ({ where, data }) => {
    const matched = cases.filter(
      (item) =>
        (where.id === undefined || item.id === where.id) &&
        (where.target_type === undefined ||
          item.target_type === where.target_type) &&
        (where.target_id === undefined || typeof where.target_id === 'number'
          ? where.target_id === undefined || item.target_id === where.target_id
          : where.target_id.in.includes(item.target_id)) &&
        (Array.isArray(where.status?.in)
          ? where.status.in.includes(item.status)
          : where.status === undefined || item.status === where.status) &&
        (where.revision === undefined || item.revision === where.revision) &&
        (where.kind === undefined || item.kind === where.kind) &&
        (where.dedup_key === undefined || item.dedup_key === where.dedup_key)
    )
    for (const row of matched)
      Object.assign(row, data, {
        revision: data.revision?.increment
          ? row.revision + data.revision.increment
          : row.revision
      })
    return { count: matched.length }
  })
  mocks.tx.ops_case.createMany.mockImplementation(async ({ data }) => {
    const input = data[0]
    if (cases.some((row) => row.dedup_key === input.dedup_key))
      return { count: 0 }
    const id = cases.length ? Math.max(...cases.map((row) => row.id)) + 1 : 50
    cases.push({
      ...caseRow(id, input.target_id, 1),
      ...input,
      _count: { subscribers: 0 }
    })
    return { count: 1 }
  })
  mocks.tx.ops_case_message.create.mockImplementation(async ({ data }) => {
    const message = {
      id: messages.length + 100,
      event: null,
      created: now,
      payload: null,
      author: null,
      ...data
    }
    messages.push(message)
    if (data.payload?.link_health)
      contexts.set(data.case_id, [
        data.payload.link_health,
        ...(contexts.get(data.case_id) ?? [])
      ])
    return message
  })
  mocks.tx.ops_case_message.findMany.mockImplementation(async ({ where }) =>
    messages.filter(
      (message) =>
        message.case_id === where.case_id &&
        (where.kind === undefined || message.kind === where.kind) &&
        (where.author_id === undefined || message.author_id === where.author_id)
    )
  )
  mocks.tx.ops_case_subscriber.findMany.mockImplementation(async ({ where }) =>
    [...(subscribers.get(where.case_id) ?? [])].map((user_id) => ({ user_id }))
  )
  mocks.tx.ops_case_subscriber.findUnique.mockImplementation(
    async ({ where }) =>
      subscribers
        .get(where.case_id_user_id.case_id)
        ?.has(where.case_id_user_id.user_id)
        ? { user_id: where.case_id_user_id.user_id }
        : null
  )
  mocks.tx.ops_case_subscriber.createMany.mockImplementation(
    async ({ data }) => {
      let count = 0
      for (const row of data) {
        const set = subscribers.get(row.case_id) ?? new Set<number>()
        if (!set.has(row.user_id)) {
          set.add(row.user_id)
          count += 1
        }
        subscribers.set(row.case_id, set)
      }
      return { count }
    }
  )
  mocks.tx.user.findMany.mockImplementation(async ({ where }) =>
    where?.id?.in ? where.id.in.map((id: number) => ({ id })) : [{ id: 9 }]
  )
  mocks.tx.patch_resource_link.findUnique.mockImplementation(
    async ({ where }) => {
      const link = links.find((row) => row.id === where.id)
      return link
        ? {
            ...link,
            content: 'SYN_PRIVATE_URL',
            code: 'SYN_PRIVATE_CODE',
            password: 'SYN_PRIVATE_PASSWORD',
            size: '1GB',
            hash: '',
            sort_order: 0,
            download: 0,
            verified_at: null,
            content_changed_at: null,
            check: null,
            reports: [{ user_id: 22, link_version: link.version }],
            resource: {
              id: 3,
              name: link.resource_name,
              section: 'galgame',
              patch_id: link.patch_id,
              user_id: 6,
              status: 0,
              patch: { id: 7, unique_id: 'SYN00001', name: 'Synthetic game' }
            }
          }
        : null
    }
  )
  mocks.tx.patch_resource.findUnique.mockResolvedValue(resource)
  mocks.tx.patch_resource.updateMany.mockImplementation(async ({ data }) => {
    Object.assign(resource, data)
    if (data.patch_id !== undefined) {
      for (const link of links) link.patch_id = data.patch_id
      resource.patch = {
        id: data.patch_id,
        unique_id: 'SYN00002',
        name: 'Moved synthetic game'
      }
    }
    return { count: 1 }
  })
  mocks.tx.patch_resource_access.updateMany.mockResolvedValue({ count: 2 })
  mocks.tx.patch.findUnique.mockResolvedValue({
    id: 11,
    unique_id: 'SYN00002',
    name: 'Moved synthetic game',
    status: 0
  })
  mocks.tx.patch.findMany.mockResolvedValue([
    { id: 7, unique_id: 'SYN00001' },
    { id: 11, unique_id: 'SYN00002' }
  ])
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 2 })
})

const close = (
  selection: Pick<CloseLinkCasesInput, 'linkIds' | 'resourceIds' | 'targets'>,
  resolution: CloseLinkCasesInput['resolution'] = 'link_removed'
) =>
  closeLinkCases(
    mocks.tx as never,
    {
      ...selection,
      resolution,
      actorType: 'system',
      now
    } as CloseLinkCasesInput
  )

describe('closeLinkCases caller transaction boundary', () => {
  it('empty selections perform no queries or side effects', async () => {
    for (const selector of [
      { linkIds: [] },
      { resourceIds: [] },
      { targets: [] }
    ])
      expect(await close(selector)).toEqual({ closedCaseIds: [] })
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
    expect(mocks.tx.$transaction).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
  })

  it('rejects multiple selectors and invalid IDs before locking', async () => {
    await expect(close({ linkIds: [12], resourceIds: [3] })).rejects.toThrow(
      'selector'
    )
    await expect(close({ linkIds: [0] })).rejects.toThrow('selector')
    await expect(
      close({ targets: [{ linkId: 12, linkVersion: 0 }] })
    ).rejects.toThrow('version')
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
  })

  it('resource selection locks actual links and cases in ascending order and notifies once per winner', async () => {
    expect(await close({ resourceIds: [3, 3] })).toEqual({
      closedCaseIds: [10, 40]
    })
    expect(sqlCalls[0].sql).toContain('ORDER BY l.id ASC')
    expect(sqlCalls[0].sql).toContain('FOR UPDATE OF l')
    expect(sqlCalls[0].sql).not.toContain('FOR UPDATE OF r')
    expect(sqlCalls[1].sql).toContain('ORDER BY id ASC')
    expect(
      mocks.tx.ops_case.updateMany.mock.calls.map(([args]) => args.where.id)
    ).toEqual([10, 40])
    expect(mocks.tx.ops_case_message.create).toHaveBeenCalledTimes(2)
    expect(mocks.tx.user_message.createMany).toHaveBeenCalledTimes(2)
    for (const [args] of mocks.tx.user_message.createMany.mock.calls)
      expect(
        args.data
          .map((message: { recipient_id: number }) => message.recipient_id)
          .sort((left: number, right: number) => left - right)
      ).toEqual([6, 22])
    expect(mocks.tx.$transaction).not.toHaveBeenCalled()
  })

  it('precise version targets close the old relinked case without touching the new version', async () => {
    links[0].version = 2
    cases.push(caseRow(41, 12, 2))
    contexts.set(41, [context(12, 2)])
    expect(
      await close({ targets: [{ linkId: 12, linkVersion: 1 }] }, 'relinked')
    ).toEqual({ closedCaseIds: [40] })
    expect(cases.find((row) => row.id === 41)?.status).toBe('open')
  })

  it('deletion only selects the currently existing link version and preserves D37 resource and legacy cases', async () => {
    const resource = {
      ...caseRow(99, 12, 1),
      target_type: 'resource',
      kind: 'resource_mismatch',
      dedup_key: 'resource:12:resource_mismatch'
    }
    const legacy = {
      ...caseRow(100, 12, 1),
      target_type: 'resource',
      kind: 'resource_link_failure',
      dedup_key: 'resource:12:resource_link_failure'
    }
    cases.push(resource, legacy, caseRow(101, 12, 2))
    contexts.set(101, [context(12, 2)])
    expect(await close({ linkIds: [12] })).toEqual({ closedCaseIds: [40] })
    expect([
      resource.status,
      legacy.status,
      cases.find((row) => row.id === 101)?.status
    ]).toEqual(['open', 'open', 'open'])
  })

  it('uses only the latest present context; corrupt/null data never falls back', async () => {
    contexts.set(40, [{ source: 'invalid' }, context()])
    expect(await readLinkCaseContext(mocks.tx as never, 40)).toBeNull()
    expect(await close({ linkIds: [12] })).toEqual({ closedCaseIds: [] })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
    expect(
      sqlCalls.find((call) => call.sql.includes("payload->'link_health'"))?.sql
    ).toContain("payload ? 'link_health'")
    contexts.set(40, [null, context()])
    expect(await close({ linkIds: [12] })).toEqual({ closedCaseIds: [] })
  })

  it('foreign target/context IDs and missing links are no-op', async () => {
    contexts.set(40, [{ ...context(), resourceId: 99 }])
    expect(await close({ linkIds: [12, 500] })).toEqual({ closedCaseIds: [] })
    expect(await close({ targets: [{ linkId: 500, linkVersion: 1 }] })).toEqual(
      { closedCaseIds: [] }
    )
    expect(mocks.tx.ops_case_message.create).not.toHaveBeenCalled()
  })

  it('repeated or losing closure writes no second event or notice', async () => {
    expect(await close({ linkIds: [12] })).toEqual({ closedCaseIds: [40] })
    expect(await close({ linkIds: [12] })).toEqual({ closedCaseIds: [] })
    expect(mocks.tx.user_message.createMany).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    cases[1].status = 'open'
    mocks.tx.ops_case.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await close({ linkIds: [13] })).toEqual({ closedCaseIds: [] })
    expect(mocks.tx.ops_case_message.create).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
  })

  it('preserves actual actor type, excludes its notice and records staff closure once', async () => {
    expect(
      await closeLinkCases(mocks.tx as never, {
        linkIds: [12],
        resolution: 'staff_broken',
        actorType: 'staff',
        actorId: 6,
        now
      })
    ).toEqual({ closedCaseIds: [40] })
    expect(
      mocks.tx.ops_case_message.create.mock.calls[0][0].data.payload.actor_type
    ).toBe('staff')
    expect(mocks.tx.admin_log.create).toHaveBeenCalledTimes(1)
    expect(
      mocks.tx.user_message.createMany.mock.calls[0][0].data.map(
        (message: { recipient_id: number }) => message.recipient_id
      )
    ).toEqual([22])
  })
})

describe('system link case creation, context and permissions', () => {
  const open = (value: LinkCaseContext = context(), reporterIds = [22, 33]) =>
    openLinkCaseInternal(mocks.tx as never, {
      context: value,
      reporterIds,
      now
    })

  it('creates one system case per link/version, subscribes actual reporters and does not invent an opener', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    const first = await open(context(), [22, 33, 22])
    expect(first).toEqual({ caseId: 50, created: true, changed: true })
    expect(cases[0]).toMatchObject({
      source: 'system',
      reporter_id: null,
      owner_id: 6,
      owner_type: 'publisher',
      dedup_key: 'link:12:v:1',
      kind: 'link_suspect'
    })
    expect([...subscribers.get(50)!]).toEqual([22, 33])
    expect(messages[0]).toMatchObject({
      kind: 'system',
      event: null,
      author_id: null,
      payload: { link_health: context() }
    })
    expect(mocks.tx.user_message.createMany).toHaveBeenCalledTimes(1)
    const repeats = await open(context(), [33, 44])
    expect(repeats).toEqual({ caseId: 50, created: false, changed: false })
    expect([...subscribers.get(50)!]).toEqual([22, 33, 44])
    expect(cases).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(mocks.tx.user_message.createMany).toHaveBeenCalledTimes(1)
    expect(mocks.tx.$transaction).not.toHaveBeenCalled()
  })

  it('touchgal suspect belongs to staff, independent of the resource author role', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    links[0].storage = 'touchgal'
    await open()
    expect(cases[0]).toMatchObject({ owner_type: 'staff', owner_id: null })
    expect(
      mocks.tx.user_message.createMany.mock.calls[0][0].data.map(
        (row: { recipient_id: number }) => row.recipient_id
      )
    ).toEqual([9])
  })

  it('promotes suspect to disputed on the same case and preserves machine conflict on later reports', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    await open()
    const changedAt = new Date(now.getTime() + 1000)
    Object.assign(links[0], {
      health: 'disputed',
      evidence_round: 1,
      health_changed_at: changedAt
    })
    const disputed: LinkCaseContext = {
      ...context(),
      health: 'disputed',
      source: 'machine_user_conflict',
      evidenceRound: 1,
      healthChangedAt: changedAt.toISOString(),
      machine: {
        provider: 'quark',
        reason: 'share_available',
        checkedAt: now.toISOString()
      }
    }
    const result = await open(disputed)
    expect(result).toEqual({ caseId: 50, created: false, changed: true })
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({
      kind: 'link_disputed',
      owner_type: 'staff',
      owner_id: null,
      dedup_key: 'link:12:v:1'
    })
    expect(messages[1]).toMatchObject({
      event: 'escalated',
      payload: { actor_type: 'system', link_health: disputed }
    })
    const notices = mocks.tx.user_message.createMany.mock.calls
      .at(-1)![0]
      .data.map((row: { recipient_id: number }) => row.recipient_id)
    expect(new Set(notices).size).toBe(notices.length)
    expect(notices).toEqual(expect.arrayContaining([6, 9, 22, 33]))
    const before = messages.length
    const ownerContext: LinkCaseContext = {
      ...context(),
      health: 'disputed',
      source: 'owner_verification',
      evidenceRound: 1,
      healthChangedAt: changedAt.toISOString()
    }
    expect(await open(ownerContext, [44])).toEqual({
      caseId: 50,
      created: false,
      changed: false
    })
    expect(messages).toHaveLength(before)
    expect(await readLinkCaseContext(mocks.tx as never, 50)).toEqual(disputed)
  })

  it('promotion uses the supplied clock so latest-context ordering does not select the older initial row', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    const future = new Date(now.getTime() + 3600000)
    links[0].health_changed_at = future
    const initial: LinkCaseContext = {
      ...context(),
      healthChangedAt: future.toISOString()
    }
    await openLinkCaseInternal(mocks.tx as never, {
      context: initial,
      reporterIds: [22],
      now: future
    })
    const later = new Date(future.getTime() + 1000)
    Object.assign(links[0], {
      health: 'disputed',
      evidence_round: 1,
      health_changed_at: later
    })
    const promoted: LinkCaseContext = {
      ...initial,
      health: 'disputed',
      source: 'owner_verification',
      evidenceRound: 1,
      healthChangedAt: later.toISOString()
    }
    await openLinkCaseInternal(mocks.tx as never, {
      context: promoted,
      reporterIds: [22],
      now: later
    })
    const latest = [...messages]
      .filter((message) => message.payload?.link_health)
      .sort(
        (left, right) =>
          right.created.getTime() - left.created.getTime() || right.id - left.id
      )[0]
    expect(latest.payload.link_health).toEqual(promoted)
    expect(latest.created).toEqual(later)
  })

  it('upgrades owner-verification dispute to machine conflict once without resetting clocks, rounds or publisher identity', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    Object.assign(links[0], { health: 'disputed', evidence_round: 1 })
    const owned: LinkCaseContext = {
      ...context(),
      health: 'disputed',
      source: 'owner_verification',
      evidenceRound: 1
    }
    await open(owned)
    const before = {
      status: cases[0].status,
      statusChanged: cases[0].status_changed_at,
      queue: cases[0].queue_entered_at,
      escalated: cases[0].escalated_at
    }
    const observed: LinkCaseContext = {
      ...owned,
      source: 'machine_user_conflict',
      machine: {
        provider: 'quark',
        reason: 'share_available',
        checkedAt: now.toISOString()
      }
    }
    const later = new Date(now.getTime() + 1000)
    expect(
      await openLinkCaseInternal(mocks.tx as never, {
        context: observed,
        reporterIds: [22],
        now: later
      })
    ).toEqual({ caseId: 50, created: false, changed: true })
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({
      kind: 'link_disputed',
      status: before.status,
      status_changed_at: before.statusChanged,
      queue_entered_at: before.queue,
      escalated_at: before.escalated
    })
    expect(await readLinkCaseContext(mocks.tx as never, 50)).toEqual(observed)
    expect(messages.at(-1)).toMatchObject({
      event: 'escalated',
      created: later,
      payload: { from_owner_type: 'publisher', from_owner_id: 6 }
    })
    const publisher = await getCase(50, 6, 1, { db: mocks.tx as never })
    expect(typeof publisher).not.toBe('string')
    const count = messages.length
    expect(
      await openLinkCaseInternal(mocks.tx as never, {
        context: observed,
        reporterIds: [22],
        now: new Date(later.getTime() + 1000)
      })
    ).toEqual({ caseId: 50, created: false, changed: false })
    expect(messages).toHaveLength(count)
    expect(links[0]).toMatchObject({
      health: 'disputed',
      evidence_round: 1,
      health_changed_at: now
    })
  })

  it('rejects stale/foreign basis and malformed latest context without falling back or opening a replacement', async () => {
    await expect(open({ ...context(), linkVersion: 2 })).rejects.toThrow(
      'changed'
    )
    await expect(open({ ...context(), resourceId: 500 })).rejects.toThrow(
      'changed'
    )
    contexts.set(40, [null, context()])
    await expect(open()).rejects.toThrow('changed')
    expect(mocks.tx.ops_case.createMany).not.toHaveBeenCalled()
    expect(mocks.tx.ops_case_subscriber.createMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
  })

  it('does not grant link dialogue identity from a foreign/corrupt handoff context', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    links[0].health = 'disputed'
    links[0].evidence_round = 1
    const disputed: LinkCaseContext = {
      ...context(),
      health: 'disputed',
      evidenceRound: 1,
      source: 'owner_verification'
    }
    await open(disputed)
    const publisher = await getCase(50, 6, 1, { db: mocks.tx as never })
    expect(typeof publisher).not.toBe('string')
    messages[0].payload = {
      ...messages[0].payload,
      from_owner_id: 66,
      link_health: { ...disputed, linkId: 999 }
    }
    expect(await getCase(50, 66, 1, { db: mocks.tx as never })).toBe(
      '无权查看该问题'
    )
  })

  it('cannot open link cases from a user or reporter through the general internal/public boundary', async () => {
    expect(
      await openCaseInternal(mocks.tx as never, {
        targetType: 'link',
        targetId: 12,
        kind: 'link_suspect',
        source: 'user',
        reporterId: 22,
        allowFrozen: true,
        linkContext: context(),
        now
      })
    ).toBe('链接事项只能由链接健康服务创建')
    expect(
      createCaseSchema.safeParse({
        targetType: 'link',
        targetId: 12,
        kind: 'link_suspect',
        content: 'synthetic report text'
      }).success
    ).toBe(false)
    expect(mocks.tx.ops_case.createMany).not.toHaveBeenCalled()
  })

  it('detail uses the common safe projection and stale/corrupt context does not expose health actions', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    await open()
    const owner = await getCase(50, 6, 1, { db: mocks.tx as never })
    if (typeof owner === 'string') throw new Error(owner)
    expect(owner.case.linkHealth).toMatchObject({
      linkId: 12,
      resourceId: 3,
      patchId: 7,
      version: 1,
      capabilities: {
        ownerActions: ['verify', 'confirm_broken'],
        canCheck: true
      }
    })
    const follower = await getCase(50, 22, 1, { db: mocks.tx as never })
    if (typeof follower === 'string') throw new Error(follower)
    expect(follower.case.linkHealth?.capabilities).toEqual({
      ownerActions: [],
      resolveActions: [],
      canCheck: false,
      canEdit: false
    })
    const safe = JSON.stringify(owner)
    for (const secret of [
      'SYN_PRIVATE_URL',
      'SYN_PRIVATE_CODE',
      'SYN_PRIVATE_PASSWORD'
    ])
      expect(safe).not.toContain(secret)
    expect(owner.case.capabilities).toMatchObject({
      canResolve: false,
      canReopen: false,
      canWithdraw: false,
      canPropose: false
    })
    contexts.set(50, [null, context()])
    const invalid = await getCase(50, 6, 1, { db: mocks.tx as never })
    if (typeof invalid === 'string') throw new Error(invalid)
    expect(invalid.case.linkHealth).toBeNull()
  })

  it('generic resolve/propose/reopen/review/withdraw/confirm/admin closure never bypasses link health', async () => {
    cases[0].reporter_id = 22 as never
    const options = { db: mocks.tx as never, now }
    const results = await Promise.all([
      resolveCase(
        { caseId: 40, resolution: 'verified_available', content: '' },
        6,
        options
      ),
      reopenCase(40, 22, 'synthetic reason', options),
      reviewCase(40, 22, 'synthetic reason', options),
      withdrawCase(40, 22, options),
      confirmCase(40, 22, true, options),
      proposeCaseClosure(
        {
          caseId: 40,
          resolution: 'verified_available',
          content: 'synthetic reason'
        },
        6,
        1,
        options
      ),
      handleCaseAsAdmin(
        {
          caseId: 40,
          action: 'resolve',
          resolution: 'staff_available',
          content: 'synthetic reason'
        },
        9,
        3,
        options
      )
    ])
    expect(
      results.every((result) => result === '链接事项请通过链接健康操作处理')
    ).toBe(true)
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
  })

  it('module 03 direct timeout/reminder operations skip link targets', async () => {
    const options = {
      db: mocks.tx as never,
      now: new Date(now.getTime() + 60 * 86400000)
    }
    expect(await upgradeCase(40, options)).toEqual({ changed: false })
    expect(await timeoutCloseCase(40, options)).toEqual({ changed: false })
    expect(await remindCase(40, options)).toEqual({ changed: false })
    expect(mocks.tx.ops_case.updateMany).not.toHaveBeenCalled()
  })

  it('activates private resource violations and rejects new temporary resource link failures', () => {
    expect(
      createCaseSchema.safeParse({
        kind: 'content_violation',
        targetType: 'resource',
        targetId: 3,
        content: 'synthetic violation'
      }).success
    ).toBe(true)
    expect(
      createCaseSchema.safeParse({
        kind: 'resource_link_failure',
        targetType: 'resource',
        targetId: 3,
        content: 'synthetic old report'
      }).success
    ).toBe(false)
  })

  it('creates a resource violation in the existing private staff path, without reporter counts or author access', async () => {
    cases = []
    contexts.clear()
    subscribers.clear()
    const created = await createCase(
      {
        kind: 'content_violation',
        targetType: 'resource',
        targetId: 3,
        content: 'synthetic violation'
      },
      22,
      { now, db: mocks.tx as never }
    )
    expect(typeof created).not.toBe('string')
    expect(cases[0]).toMatchObject({
      kind: 'content_violation',
      target_type: 'resource',
      owner_type: 'staff',
      owner_id: null,
      public: false,
      source: 'user',
      reporter_id: 22
    })
    expect(
      mocks.tx.user_message.createMany.mock.calls[0][0].data.map(
        (message: { recipient_id: number }) => message.recipient_id
      )
    ).toEqual([9])
    const author = await getCase(50, 6, 1, { db: mocks.tx as never })
    expect(author).toBe('无权查看该问题')
    const reporter = await getCase(50, 22, 1, { db: mocks.tx as never })
    if (typeof reporter === 'string') throw new Error(reporter)
    expect(reporter.case.subscriberCount).toBeNull()
    expect(
      mocks.tx.ops_case_message.findMany.mock.calls.at(-1)![0].where
    ).toMatchObject({
      case_id: 50,
      OR: expect.arrayContaining([{ author_id: 22 }])
    })
  })

  it('resource move preserves link versions, nulls acquisition link references and rebinds only valid current contexts', async () => {
    const parent = {
      ...caseRow(99, 3, 1),
      target_type: 'resource',
      target_id: 3,
      kind: 'resource_wrong_patch',
      public: false,
      owner_type: 'staff',
      owner_id: null,
      reporter_id: 22
    }
    cases.push(parent as never)
    contexts.set(10, [null, context(13, 2)])
    const versions = links.map((link) => [link.id, link.version])
    const result = await handleCaseResource(
      { caseId: 99, action: 'move', targetPatchId: 11, content: '' },
      9,
      3,
      { db: mocks.tx as never, now }
    )
    expect(result).toMatchObject({
      changed: true,
      fromPatchId: 7,
      toPatchId: 11
    })
    expect(links.map((link) => [link.id, link.version])).toEqual(versions)
    expect(mocks.tx.patch_resource_access.updateMany).toHaveBeenCalledWith({
      where: { resource_id: 3 },
      data: { patch_id: 11, link_id: null, updated: now }
    })
    expect(cases.find((row) => row.id === 40)).toMatchObject({
      patch_id: 11,
      status: 'open',
      kind: 'link_suspect'
    })
    expect(await readLinkCaseContext(mocks.tx as never, 40)).toMatchObject({
      patchId: 11,
      linkVersion: 1,
      healthChangedAt: now.toISOString()
    })
    expect(await readLinkCaseContext(mocks.tx as never, 10)).toBeNull()
    expect(parent.status).toBe('resolved')
    const linkLock = sqlCalls.findIndex((call) =>
      call.sql.includes('FROM patch_resource_link l')
    )
    const caseLocks = sqlCalls.findIndex((call) =>
      call.sql.includes("target_type='resource' AND target_id")
    )
    expect(linkLock).toBeGreaterThanOrEqual(0)
    expect(caseLocks).toBeGreaterThan(linkLock)
  })
})

describe('case bounded transaction retry for actual Prisma 7 raw-query conflict shape', () => {
  const nested = (originalCode: string) => ({
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode } } }
  })
  it.each(['40P01', '40001'])(
    'retries only exact nested SQLSTATE %s as a whole transaction',
    async (code) => {
      mocks.tx.$transaction.mockRejectedValueOnce(nested(code))
      expect(await withdrawCase(40, 22, { db: mocks.tx as never, now })).toBe(
        '链接事项请通过链接健康操作处理'
      )
      expect(mocks.tx.$transaction).toHaveBeenCalledTimes(2)
      expect(mocks.tx.user_message.createMany).not.toHaveBeenCalled()
    }
  )
  it.each(['23503', '23505', 'XX000'])(
    'does not retry other raw-query SQLSTATE %s',
    async (code) => {
      const error = nested(code)
      mocks.tx.$transaction.mockRejectedValue(error)
      await expect(
        withdrawCase(40, 22, { db: mocks.tx as never, now })
      ).rejects.toBe(error)
      expect(mocks.tx.$transaction).toHaveBeenCalledTimes(1)
    }
  )
  it('does not retry arbitrary P2010 or an unrelated originalCode property', async () => {
    const error = { code: 'P2010', meta: { originalCode: '40P01' } }
    mocks.tx.$transaction.mockRejectedValue(error)
    await expect(
      withdrawCase(40, 22, { db: mocks.tx as never, now })
    ).rejects.toBe(error)
    expect(mocks.tx.$transaction).toHaveBeenCalledTimes(1)
  })
  it('bounds a persistent exact nested conflict to three attempts', async () => {
    const error = nested('40P01')
    mocks.tx.$transaction.mockRejectedValue(error)
    await expect(
      withdrawCase(40, 22, { db: mocks.tx as never, now })
    ).rejects.toBe(error)
    expect(mocks.tx.$transaction).toHaveBeenCalledTimes(3)
  })
})
