import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    patch_resource_link: { findFirst: vi.fn() }
  },
  close: vi.fn(),
  open: vi.fn(),
  invalidate: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/case/linkHealth', () => ({
  closeLinkCases: mocks.close,
  openLinkCaseInternal: mocks.open,
  readLinkCaseContext: vi.fn()
}))
vi.mock('~/app/api/case/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('~/app/api/case/service')>(),
  lockCaseUsers: vi.fn()
}))
vi.mock('~/app/api/case/imageUpload', () => ({
  caseImageUrl: vi.fn(), consumeCaseImageUploads: vi.fn(), restoreCaseImageUploads: vi.fn()
}))
vi.mock('~/app/api/case/rateLimit', () => ({ checkCaseRateLimit: vi.fn() }))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(), invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  deletePatchResourceCache: mocks.invalidate
}))

import { checkManagedLink, checkRelinkedResource } from '~/app/api/patch/resource/link-check/service'
import { projectLinkHealth } from '~/app/api/patch/resource/linkHealthProjection'
import type { PatchResourceStableUpdateResponse } from '~/types/api/patch'
import {
  acceptLinkCheck,
  healthBasis,
  mutateLinkHealth,
  requireLinkManagement,
  type HealthTargetRow
} from '~/app/api/patch/resource/link/service'
import { CASE_ACTOR_TYPES } from '~/constants/case'

const now = new Date('2026-10-17T02:00:00Z')
const checkedAt = '2026-10-17T01:59:00.000Z'
const actor = { uid: 9, role: 3 }
const config = {
  endpoint: 'https://checker.example.test',
  apiKey: 'synthetic-key'
}
const makeRow = () => ({
  id: 21,
  version: 2,
  resource_id: 7,
  storage: 'user',
  content: 'https://pan.quark.cn/s/SYN',
  code: '',
  password: '',
  size: '',
  hash: '',
  sort_order: 0,
  download: 0,
  health: 'ok',
  evidence_round: 1,
  health_changed_at: null,
  verified_at: null,
  content_changed_at: null,
  reports: [],
  check: null,
  resource: {
    user_id: 4,
    patch_id: 3,
    status: 0,
    patch: { status: 0, unique_id: 'synthetic-patch' }
  }
})
let row: HealthTargetRow
let tx: any
let weight = 0
let currentActor = actor
let mode: 'manual' | 'automatic' = 'manual'
const visibility = { content_limit: 'sfw' }
const fetchCheck = vi.fn()
const run = (
  overrides: Record<string, unknown> = {},
  mutate?: () => void,
  requested = now
) => {
  fetchCheck.mockImplementation(async () => {
    mutate?.()
    return new Response(
      JSON.stringify({
        provider: 'quark',
        status: 'dead',
        reason: 'share_blocked',
        providerCode: '41010',
        cached: true,
        checkedAt,
        ...overrides
      })
    )
  })
  return checkManagedLink(
    healthBasis(row),
    currentActor,
    visibility,
    { config, now: () => requested, fetch: fetchCheck },
    mode
  )
}
const savedResource = (): PatchResourceStableUpdateResponse => ({
  id: 7, patchId: 3, userId: 4, uniqueId: 'synthetic-patch', name: 'Saved fixture',
  section: 'galgame', type: [], language: [], platform: [], note: '',
  likeCount: 0, download: 0, isLike: false, status: 0, created: now.toISOString(),
  user: { id: 4, name: 'Publisher', avatar: '', patchCount: 0, role: 2 },
  links: [{
    ...projectLinkHealth(row, 4, { uid: 4, role: 2 }, null, now),
    id: row.id, storage: row.storage, size: '', hash: '', sortOrder: 0, download: 0
  }],
  linkChecks: []
})
beforeEach(() => {
  vi.clearAllMocks()
  row = makeRow() as HealthTargetRow
  weight = 0
  currentActor = actor
  mode = 'manual'
  tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    patch_resource_link: {
      findFirst: vi.fn().mockImplementation(async () =>
        row.resource.status === 0 && row.resource.patch.status === 0
          ? structuredClone(row) : null),
      findUnique: vi.fn().mockImplementation(async () => structuredClone(row)),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(async () => structuredClone(row)),
      updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
        expect(where).toMatchObject({
          id: 21,
          version: 2,
          evidence_round: 1,
          health: row.health,
          health_changed_at: row.health_changed_at
        })
        Object.assign(row, data)
        return { count: 1 }
      })
    },
    patch_resource_link_check: {
      upsert: vi.fn().mockImplementation(async ({ create }) => {
        row.check = create
        return create
      })
    },
    patch_resource_link_history: { create: vi.fn() },
    patch_resource_link_report: {
      aggregate: vi.fn().mockImplementation(async () => ({ _sum: { weight } })),
      findMany: vi
        .fn()
        .mockResolvedValue([{ user_id: 5 }, { user_id: 6 }, { user_id: 7 }])
    },
    patch_resource_access: { findFirst: vi.fn() },
    ops_case: { findUnique: vi.fn(), updateMany: vi.fn() },
    ops_case_message: { create: vi.fn() },
    ops_case_subscriber: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    admin_log: { create: vi.fn() },
    user: { findMany: vi.fn().mockImplementation(async ({ where }) =>
      where.id?.in ? where.id.in.map((id: number) => ({ id })) : [{ id: 20 }]) },
    user_message: { createMany: vi.fn() }
  }
  mocks.prisma.patch_resource_link.findFirst.mockImplementation(async () =>
    row.resource.status === 0 && row.resource.patch.status === 0
      ? structuredClone(row) : null)
  mocks.prisma.$transaction.mockImplementation(async (work) => work(tx))
  mocks.close.mockResolvedValue({ closedCaseIds: [88] })
})

describe('trusted checker observation through managed health transaction', () => {
  it.each([
    'https://pan.otoame.top/s/SYN',
    'https://fixture.s3.example.test/SYN.zip',
    'https://1drv.ms/f/SYN',
    'https://example.test/s/SYN',
    'magnet:?xt=urn:btih:SYN',
    'magnet:?xt=urn:btih:SYN&tr=https://pan.quark.cn/s/SYN',
    'https://pan.quark.cn.evil.test/s/SYN',
    'https://pan.quark.cn/'
  ])('refuses unsupported manual content before fetching or writing: %s', async (content) => {
    row.content = content
    for (const candidate of [{ uid: 9, role: 1 }, { uid: 4, role: 2 }, { uid: 9, role: 3 }]) {
      currentActor = candidate
      await expect(run()).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect(fetchCheck).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
    expect(tx.patch_resource_link.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    'https://pan.otoame.top/s/SYN', 'https://fixture.s3.example.test/SYN.zip',
    'https://example.test/s/SYN'
  ])('skips unsupported automatic checks without superseding a committed save: %s', async (content) => {
    row.content = content
    const saved = savedResource()
    const before = structuredClone(saved)
    expect(await checkRelinkedResource(saved, [{ id: 21, version: 1 }], { uid: 4, role: 2 }, {
      config, now: () => now, fetch: fetchCheck
    })).toBe(saved)
    expect(saved).toEqual(before)
    expect(saved.linkChecks).toEqual([])
    expect(fetchCheck).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
  })

  it.each(['https://pan.quark.cn/s/SYN', 'https://pan.otoame.top/s/SYN'])(
    'retains superseded for a genuinely outdated automatic basis: %s', async (content) => {
      row.content = content
      const saved = savedResource()
      row.evidence_round += 1
      await checkRelinkedResource(saved, [{ id: 21, version: 1 }], { uid: 4, role: 2 }, {
        config, now: () => now, fetch: fetchCheck
      })
      expect(saved.linkChecks).toEqual([{ linkId: 21, linkVersion: 2, outcome: 'superseded', check: null }])
      expect(fetchCheck).not.toHaveBeenCalled()
    }
  )

  it('still checks a supported changed link automatically as system', async () => {
    const saved = savedResource()
    fetchCheck.mockResolvedValue(new Response(JSON.stringify({
      provider: 'quark', status: 'dead', reason: 'share_blocked', providerCode: '41010',
      cached: true, checkedAt
    })))
    await checkRelinkedResource(saved, [{ id: 21, version: 1 }], { uid: 4, role: 2 }, {
      config, now: () => now, fetch: fetchCheck
    })
    expect(saved.linkChecks).toMatchObject([{
      linkId: 21, linkVersion: 2, outcome: 'observed', check: { verdict: 'broken', reason: 'share_blocked' }
    }])
    expect(fetchCheck).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledWith(tx, expect.objectContaining({ actorType: 'system', actorId: null }))
    expect(saved.links[0].health).toBe('broken')
  })

  it('does not automatically check unchanged links', async () => {
    const saved = savedResource()
    await checkRelinkedResource(saved, [{ id: 21, version: 2 }], { uid: 4, role: 2 }, {
      config, now: () => now, fetch: fetchCheck
    })
    expect(saved.linkChecks).toEqual([])
    expect(mocks.prisma.patch_resource_link.findFirst).not.toHaveBeenCalled()
    expect(fetchCheck).not.toHaveBeenCalled()
  })

  it.each([
    ['user', 9, 1, 'user', 'manual'],
    ['user', 9, 2, 'user', 'manual'],
    ['touchgal', 9, 1, 'user', 'manual'],
    ['touchgal', 9, 2, 'user', 'manual'],
    ['user', 4, 2, 'publisher', 'manual'],
    ['touchgal', 4, 2, 'user', 'manual'],
    ['touchgal', 9, 3, 'staff', 'manual'],
    ['user', 4, 2, 'system', 'automatic']
  ] as const)('checks %s as uid %s role %s with %s audit in %s mode and closes the machine case', async (storage, uid, role, actorType, requestedMode) => {
    currentActor = { uid, role }
    mode = requestedMode
    row.storage = storage
    row.health = 'suspect'
    row.health_changed_at = new Date(now.getTime() - 3600000)
    const context = { ...healthBasis(row), source: 'user_reports' }
    const activeCase = {
      id: 88, target_type: 'link', target_id: 21, kind: 'link_suspect',
      source: 'system', reporter_id: null,
      owner_type: storage === 'touchgal' ? 'staff' : 'publisher',
      owner_id: storage === 'touchgal' ? null : 4,
      public: true, status: 'open', revision: 0, dedup_key: 'link:21:v:2',
      status_changed_at: row.health_changed_at, queue_entered_at: row.health_changed_at,
      first_owner_response_at: null
    }
    const ownerBefore = { owner_type: activeCase.owner_type, owner_id: activeCase.owner_id, reporter_id: activeCase.reporter_id }
    tx.$queryRaw.mockImplementation(async (query: { strings: string[]; values: unknown[] }) => {
      const sql = query.strings.join(' ')
      if (sql.includes('FOR KEY SHARE'))
        return query.values.filter((id) => typeof id === 'number').map((id) => ({ id }))
      if (sql.includes('FROM patch_resource_link l'))
        return [{ id: 21, version: 2, resource_id: 7, patch_id: 3 }]
      if (sql.includes("payload->'link_health'")) return [{ context }]
      if (sql.includes('FROM ops_case') && activeCase.status === 'open') return [activeCase]
      return []
    })
    tx.ops_case.findUnique.mockImplementation(async () => structuredClone(activeCase))
    tx.ops_case.updateMany.mockImplementation(async ({ where, data }: Prisma.ops_caseUpdateManyArgs) => {
      expect(where).toMatchObject({ id: 88, revision: 0, status: { in: expect.arrayContaining(['open']) } })
      Object.assign(activeCase, data)
      return { count: 1 }
    })
    const { closeLinkCases } = await vi.importActual<typeof import('~/app/api/case/linkHealth')>('~/app/api/case/linkHealth')
    mocks.close.mockImplementation(closeLinkCases)
    const { response } = await run()
    expect(response).toMatchObject({ changed: true, check: 'observed', link: { health: 'broken' } })
    expect(fetchCheck).toHaveBeenCalledTimes(1)
    expect(tx.patch_resource_access.findFirst).not.toHaveBeenCalled()
    expect(activeCase).toMatchObject({ ...ownerBefore, status: 'resolved', resolution: 'machine_broken', dedup_key: null })
    expect(CASE_ACTOR_TYPES).toContain(actorType)
    const actorId = requestedMode === 'automatic' ? null : uid
    expect(mocks.close).toHaveBeenCalledWith(tx, expect.objectContaining({ actorType, actorId }))
    expect(tx.patch_resource_link_history.create).toHaveBeenCalledWith({ data: expect.objectContaining({ operator_user_id: actorId }) })
    expect(tx.ops_case_message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      payload: expect.objectContaining({ actor_type: actorType, resolution: 'machine_broken' })
    }) }))
    expect(tx.admin_log.create).toHaveBeenCalledTimes(actorType === 'staff' ? 1 : 0)
    expect(tx.ops_case_subscriber.createMany).not.toHaveBeenCalled()
    for (const [args] of tx.user_message.createMany.mock.calls)
      expect(args.data.map((message: { recipient_id: number }) => message.recipient_id)).not.toContain(actorId)
    for (const secret of [row.content, 'inputSignature', 'requestId'])
      expect(JSON.stringify(response)).not.toContain(secret)
  })

  it.each([
    ['user', 1], ['user', 2], ['touchgal', 1], ['touchgal', 2]
  ] as const)('does not give an ordinary %s checker role %s manual health or arbitration rights', async (storage, role) => {
    currentActor = { uid: 9, role }
    row.storage = storage
    row.health = 'suspect'
    expect(() => requireLinkManagement(row, currentActor)).toThrow()
    for (const action of ['verify', 'confirm_broken', 'available', 'broken'] as const) {
      if (action === 'available' || action === 'broken') {
        row.health = 'disputed'
        await expect(mutateLinkHealth({ ...healthBasis(row), health: 'disputed', action }, currentActor, visibility, now)).rejects.toMatchObject({ code: 'forbidden' })
      } else {
        row.health = 'suspect'
        await expect(mutateLinkHealth({ ...healthBasis(row), action }, currentActor, visibility, now)).rejects.toMatchObject({ code: 'forbidden' })
      }
    }
    expect(fetchCheck).not.toHaveBeenCalled()
    expect(tx.patch_resource_link.updateMany).not.toHaveBeenCalled()
  })

  it.each([0, -1])('rejects guest uid %s before contacting the checker', async (uid) => {
    currentActor = { uid, role: 1 }
    await expect(run()).rejects.toMatchObject({ code: 'login_required' })
    expect(fetchCheck).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rechecks signed-in eligibility inside acceptLinkCheck before storing observations', async () => {
    const { snapshot } = await run({ status: 'unknown', reason: 'network_error', providerCode: '0' })
    tx.patch_resource_link_check.upsert.mockClear()
    await expect(acceptLinkCheck(healthBasis(row), { uid: 0, role: 1 }, visibility, {
      snapshot, basis: healthBasis(row), signature: snapshot.inputSignature,
      signatureFor: () => snapshot.inputSignature
    }, now)).rejects.toMatchObject({ code: 'login_required' })
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
  })

  it('rejects a disabled role before contacting the checker', async () => {
    currentActor = { uid: 9, role: 0 }
    await expect(run()).rejects.toMatchObject({ code: 'forbidden' })
    expect(fetchCheck).not.toHaveBeenCalled()
  })

  it.each(['hidden resource', 'hidden patch', 'visibility filter', 'changed basis'])('rejects %s before an external check', async (reason) => {
    currentActor = { uid: 9, role: 1 }
    if (reason === 'hidden resource') row.resource.status = 1
    if (reason === 'hidden patch') row.resource.patch.status = 1
    if (reason === 'visibility filter') mocks.prisma.patch_resource_link.findFirst.mockResolvedValue(null)
    if (reason === 'changed basis') {
      mocks.prisma.patch_resource_link.findFirst.mockResolvedValue({ ...row, evidence_round: 2 })
    }
    await expect(run()).rejects.toMatchObject({ code: reason === 'changed basis' ? 'state_conflict' : 'not_found' })
    expect(fetchCheck).not.toHaveBeenCalled()
    expect(mocks.prisma.patch_resource_link.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      resource: { patch_id: 3, status: 0, patch: { status: 0, ...visibility } }
    }) }))
  })

  it.each(['resource', 'patch', 'visibility'])('rejects a target whose %s becomes invisible during the check', async (target) => {
    currentActor = { uid: 9, role: 1 }
    await expect(run({}, () => {
      if (target === 'resource') row.resource.status = 1
      if (target === 'patch') row.resource.patch.status = 1
      if (target === 'visibility') tx.patch_resource_link.findFirst.mockResolvedValue(null)
    })).rejects.toMatchObject({ code: 'not_found' })
    expect(fetchCheck).toHaveBeenCalledTimes(1)
    expect(tx.patch_resource_link.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      resource: { patch_id: 3, status: 0, patch: { status: 0, ...visibility } }
    }) }))
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it.each([
    [
      'quark',
      'https://pan.quark.cn/s/SYN',
      'share_blocked',
      '41010',
      'share_blocked'
    ],
    [
      'uc',
      'https://drive.uc.cn/s/SYN',
      'share_blocked',
      '41031',
      'share_blocked'
    ],
    [
      'baidu',
      'https://pan.baidu.com/s/1SYN',
      'share_not_found',
      '-21',
      'share_deleted'
    ],
    [
      'caiyun',
      'https://caiyun.139.com/m/i?SYN',
      'share_not_found',
      '200000727',
      'share_deleted'
    ],
    [
      'pan123',
      'https://www.123pan.com/s/SYN',
      'share_not_found',
      '5103',
      'share_deleted'
    ]
  ])(
    'persists %s cached broken evidence and closes the case as the manual actor',
    async (provider, content, reason, providerCode, safeReason) => {
      row.content = content
      const { response } = await run({ provider, reason, providerCode })
      expect(response).toMatchObject({
        changed: true,
        check: 'observed',
        link: { health: 'broken' },
        result: { checkedAt, reason: safeReason }
      })
      expect(row).toMatchObject({
        health: 'broken',
        evidence_round: 2,
        health_changed_at: now,
        check: {
          checked_at: new Date(checkedAt),
          cached: true,
          reason: safeReason
        }
      })
      expect(tx.patch_resource_link_history.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          operator_user_id: 9,
          health_transition: expect.objectContaining({
            machine: { provider, reason: safeReason, checkedAt }
          })
        })
      })
      expect(mocks.close).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: 'staff',
          actorId: 9,
          targets: [{ linkId: 21, linkVersion: 2 }]
        })
      )
      expect(mocks.invalidate).toHaveBeenCalledWith('synthetic-patch')
      expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    }
  )
  it('reuses a cached available observation when later reports reach weight three', async () => {
    const available = { status: 'alive', reason: 'share_ok', providerCode: '0' }
    await run(available)
    expect(row.health).toBe('ok')
    weight = 3
    const { response } = await run(
      available,
      undefined,
      new Date(now.getTime() + 1000)
    )
    expect(response.changed).toBe(true)
    expect(row.health).toBe('disputed')
    expect(mocks.open).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        context: expect.objectContaining({
          source: 'machine_user_conflict',
          machine: { provider: 'quark', reason: 'share_available', checkedAt }
        })
      })
    )
  })
  it('uses identical cached evidence at the same request instant when reports reach three without replacing the stored attempt', async () => {
    const available = { status: 'alive', reason: 'share_ok', providerCode: '0' }
    await run(available)
    const requestId = row.check!.request_id
    tx.patch_resource_link_check.upsert.mockClear()
    weight = 3
    const { response } = await run(available)
    expect(response.changed).toBe(true)
    expect(row.health).toBe('disputed')
    expect(row.check!.request_id).toBe(requestId)
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        context: expect.objectContaining({ source: 'machine_user_conflict' })
      })
    )
  })
  it('does not overwrite a newer stored observation', async () => {
    await run({
      status: 'alive',
      reason: 'share_ok',
      providerCode: '0',
      checkedAt: now.toISOString()
    })
    tx.patch_resource_link_check.upsert.mockClear()
    const { response } = await run()
    expect(response.changed).toBe(false)
    expect(row.health).toBe('ok')
    expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
  })
  it.each(['code', 'version', 'evidence_round', 'health_changed_at'])(
    'rejects a changed %s after detection without state writes',
    async (field) => {
      currentActor = { uid: 9, role: 1 }
      await expect(
        run({}, () => {
          Object.assign(row, {
            [field]:
              field === 'code'
                ? 'NEW'
                : field === 'health_changed_at'
                  ? now
                  : 99
          })
        })
      ).rejects.toThrow()
      expect(tx.patch_resource_link_check.upsert).not.toHaveBeenCalled()
      expect(tx.patch_resource_link.updateMany).not.toHaveBeenCalled()
      expect(mocks.close).not.toHaveBeenCalled()
      expect(mocks.invalidate).not.toHaveBeenCalled()
    }
  )
})
