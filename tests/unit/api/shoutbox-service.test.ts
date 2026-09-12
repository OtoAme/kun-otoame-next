import { beforeEach, describe, expect, it, vi } from 'vitest'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  user_id: 7,
  request_id: '550e8400-e29b-41d4-a716-446655440000',
  content: '原始内容',
  link: '',
  official: false,
  level: 'normal',
  status: 0,
  cost: 50,
  patch_id: null,
  effective_from: null,
  effective_to: null,
  edited_at: null,
  hidden_at: null,
  refunded_at: null,
  created: new Date('2026-09-11T10:00:00.000Z'),
  updated: new Date('2026-09-11T10:00:00.000Z'),
  user: { id: 7, name: '作者', avatar: '', role: 1 },
  patch: null,
  ...overrides
})

const prismaMock = vi.hoisted(() => ({
  shoutbox: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn()
  },
  patch: { findUnique: vi.fn() },
  admin_log: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn()
}))

const cacheMock = vi.hoisted(() => ({
  invalidateShoutboxCaches: vi.fn(),
  getShoutboxCached: vi.fn(),
  getShoutboxCacheKey: vi.fn(),
  getShoutboxBannerCached: vi.fn(),
  getShoutboxBannerCacheKey: vi.fn(),
  SHOUTBOX_LIST_CACHE_DURATION: 60,
  SHOUTBOX_BANNER_CACHE_DURATION: 60,
  SHOUTBOX_PATCH_CACHE_DURATION: 300
}))

const moemoepointMock = vi.hoisted(() => ({
  MoemoepointInsufficientError: class extends Error {},
  getCurrentBalance: vi.fn(),
  refundMoemoepoint: vi.fn(),
  spendMoemoepoint: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/app/api/shoutbox/cache', () => cacheMock)
vi.mock('~/app/api/moemoepoint/service', () => moemoepointMock)
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))

import {
  createOfficialShoutbox,
  createShoutbox,
  deleteShoutbox,
  getShoutboxHome,
  getShoutboxBanner,
  getShoutboxList,
  getUserShoutboxes,
  updateOfficialShoutbox,
  updateShoutbox
} from '~/app/api/shoutbox/service'
import { ShoutboxReadError } from '~/app/api/shoutbox/errors'

const now = new Date('2026-09-11T12:00:00.000Z')
const requestId = '550e8400-e29b-41d4-a716-446655440000'

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
  prismaMock.shoutbox.create.mockResolvedValue(row())
  prismaMock.shoutbox.findUnique.mockResolvedValue(null)
  prismaMock.shoutbox.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.admin_log.create.mockResolvedValue({})
  prismaMock.patch.findUnique.mockResolvedValue(null)
  cacheMock.invalidateShoutboxCaches.mockResolvedValue(undefined)
  cacheMock.getShoutboxCached.mockImplementation(
    async (_key: string, fetcher: () => Promise<unknown>) => fetcher()
  )
  cacheMock.getShoutboxBannerCached.mockImplementation(
    async (_key: string, fetcher: () => Promise<unknown>) => fetcher()
  )
  moemoepointMock.spendMoemoepoint.mockResolvedValue({
    balance: { total: 40, reserved: 0, available: 40 }
  })
  moemoepointMock.getCurrentBalance.mockResolvedValue({
    total: 40,
    reserved: 0,
    available: 40
  })
  moemoepointMock.refundMoemoepoint.mockResolvedValue({})
})

describe('shoutbox user and official service boundaries', () => {
  it('does not query an author archive without a logged-in viewer', async () => {
    const response = await getUserShoutboxes(
      { uid: 7, page: 1, limit: 20 },
      null,
      { db: prismaMock as never }
    )

    expect(response).toEqual({ shoutboxes: [], page: 1, totalPages: 0 })
    expect(prismaMock.shoutbox.count).not.toHaveBeenCalled()
    expect(prismaMock.shoutbox.findMany).not.toHaveBeenCalled()
  })

  it('uses the injected clock for a logged-in visitor archive', async () => {
    const archiveNow = new Date('2026-09-11T12:00:00.000Z')
    prismaMock.shoutbox.count.mockResolvedValueOnce(0)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([])

    await getUserShoutboxes(
      { uid: 8, page: 1, limit: 20 },
      { uid: 7, role: 1 },
      { now: archiveNow, db: prismaMock as never }
    )

    expect(prismaMock.shoutbox.count).toHaveBeenCalledWith({
      where: {
        user_id: 8,
        status: 0,
        OR: [
          { official: false },
          { official: true, effective_from: { lte: archiveNow } }
        ]
      }
    })
  })

  it('creates a normal message and spends 50 points in the same transaction', async () => {
    const response = await createShoutbox(
      { requestId, content: '  新\n内容  ' },
      7,
      { now, db: prismaMock as never }
    )

    expect(prismaMock.shoutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 7,
          request_id: requestId,
          content: '新 内容',
          official: false,
          level: 'normal',
          cost: 50,
          link: ''
        })
      })
    )
    expect(moemoepointMock.spendMoemoepoint).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        userId: 7,
        amount: 50,
        requiredAvailable: 50,
        reasonCode: 'shoutbox.publish',
        referenceType: 'shoutbox',
        referenceId: 12,
        idempotencyKey: `shoutbox:publish:7:${requestId}`
      })
    )
    expect(response).toEqual(
      expect.objectContaining({
        moemoepointBalance: { total: 40, reserved: 0, available: 40 }
      })
    )
    expect(cacheMock.invalidateShoutboxCaches).toHaveBeenCalledOnce()
  })

  it('serializes reportability without exposing the author role', async () => {
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([
      row({
        user: { id: 7, name: '超级管理员', avatar: '', role: 4 }
      })
    ])

    const response = await getShoutboxList(
      { page: 1, limit: 20 },
      { now, db: prismaMock as never, useCache: false }
    )
    const item = response.shoutboxes[0]

    expect(item).toMatchObject({
      reportable: false,
      user: { id: 7, name: '超级管理员', avatar: '' }
    })
    expect(item?.user).not.toHaveProperty('role')
  })

  it('replays an existing normal message before validating a changed patch', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(row())
    prismaMock.patch.findUnique.mockRejectedValueOnce(
      new Error('replay must not revalidate the patch')
    )

    const response = await createShoutbox(
      { requestId, content: '重试正文', patchId: 99 },
      7,
      { now, db: prismaMock as never }
    )

    expect(response).toEqual(
      expect.objectContaining({
        id: 12,
        moemoepointBalance: { total: 40, reserved: 0, available: 40 }
      })
    )
    expect(prismaMock.patch.findUnique).not.toHaveBeenCalled()
    expect(moemoepointMock.spendMoemoepoint).not.toHaveBeenCalled()
  })

  it('returns the current real balance when a publish request is replayed', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(row())
    prismaMock.shoutbox.create.mockRejectedValueOnce({ code: 'P2002' })

    const response = await createShoutbox({ requestId, content: '重放' }, 7, {
      now,
      db: prismaMock as never
    })

    expect(response).toEqual(
      expect.objectContaining({
        id: 12,
        moemoepointBalance: { total: 40, reserved: 0, available: 40 }
      })
    )
    expect(moemoepointMock.getCurrentBalance).toHaveBeenCalledWith(
      prismaMock,
      7
    )
    expect(moemoepointMock.spendMoemoepoint).not.toHaveBeenCalled()
  })

  it('treats a concurrent PostgreSQL unique violation as a normal replay', async () => {
    prismaMock.shoutbox.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row())
    prismaMock.shoutbox.create.mockRejectedValueOnce({ code: '23505' })

    const response = await createShoutbox(
      { requestId, content: '并发重试' },
      7,
      { now, db: prismaMock as never }
    )

    expect(response).toEqual(
      expect.objectContaining({ id: 12, moemoepointBalance: expect.anything() })
    )
    expect(moemoepointMock.spendMoemoepoint).not.toHaveBeenCalled()
  })

  it('does not report success or purge cache when the point spend fails', async () => {
    moemoepointMock.spendMoemoepoint.mockRejectedValueOnce(
      new moemoepointMock.MoemoepointInsufficientError()
    )

    await expect(
      createShoutbox({ requestId, content: '内容' }, 7, {
        now,
        db: prismaMock as never
      })
    ).rejects.toBeInstanceOf(Error)
    expect(cacheMock.invalidateShoutboxCaches).not.toHaveBeenCalled()
  })

  it('limits a user edit to one conditional five-minute update', async () => {
    await updateShoutbox({ shoutboxId: 12, content: '编辑\r\n后' }, 7, {
      now,
      db: prismaMock as never
    })

    expect(prismaMock.shoutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        user_id: 7,
        official: false,
        status: 0,
        edited_at: null,
        created: { gt: new Date('2026-09-11T11:55:00.000Z') }
      },
      data: { content: '编辑 后', edited_at: now }
    })
  })

  it('lets the author self-delete a hidden message without a refund', async () => {
    await deleteShoutbox({ shoutboxId: 12 }, 7, { db: prismaMock as never })

    expect(prismaMock.shoutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        user_id: 7,
        official: false,
        status: { in: [0, 2] }
      },
      data: { status: 1 }
    })
    expect(moemoepointMock.refundMoemoepoint).not.toHaveBeenCalled()
  })

  it('allows cancel for an unstarted official message, including from=now', async () => {
    const official = row({
      official: true,
      cost: 0,
      effective_from: now,
      effective_to: new Date('2026-09-14T12:00:00.000Z')
    })
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(official)

    await updateOfficialShoutbox({ shoutboxId: 12, action: 'cancel' }, 99, {
      now,
      db: prismaMock as never
    })

    expect(prismaMock.shoutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        official: true,
        status: 0,
        effective_to: { gt: now }
      },
      data: { status: 3 }
    })
  })

  it('allows cancel for an active official message and keeps end strictly active', async () => {
    const active = row({
      official: true,
      cost: 0,
      effective_from: new Date('2026-09-11T11:59:59.000Z'),
      effective_to: new Date('2026-09-14T12:00:00.000Z')
    })
    prismaMock.shoutbox.findUnique.mockResolvedValue(active)

    await updateOfficialShoutbox({ shoutboxId: 12, action: 'cancel' }, 99, {
      now,
      db: prismaMock as never
    })
    expect(prismaMock.shoutbox.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 12,
        official: true,
        status: 0,
        effective_to: { gt: now }
      },
      data: { status: 3 }
    })

    prismaMock.shoutbox.updateMany.mockClear()
    await updateOfficialShoutbox({ shoutboxId: 12, action: 'end' }, 99, {
      now,
      db: prismaMock as never
    })
    expect(prismaMock.shoutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        official: true,
        status: 0,
        effective_from: { lt: now },
        effective_to: { gt: now }
      },
      data: { effective_to: now }
    })
  })

  it('rejects cancel after an official message has expired', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(
      row({
        official: true,
        cost: 0,
        effective_from: new Date('2026-09-11T11:00:00.000Z'),
        effective_to: now
      })
    )

    await expect(
      updateOfficialShoutbox({ shoutboxId: 12, action: 'cancel' }, 99, {
        now,
        db: prismaMock as never
      })
    ).resolves.toBe('已过期的官方小喇叭不能撤回')
    expect(prismaMock.shoutbox.updateMany).not.toHaveBeenCalled()
  })

  it('publishes official messages for free with the normal default level', async () => {
    await createOfficialShoutbox(
      {
        requestId,
        content: '维护\u2028通知',
        level: 'normal',
        link: ''
      },
      99,
      { now, db: prismaMock as never }
    )

    expect(prismaMock.shoutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 99,
          content: '维护 通知',
          official: true,
          level: 'normal',
          cost: 0,
          effective_from: now,
          effective_to: new Date('2026-09-14T12:00:00.000Z')
        })
      })
    )
    expect(moemoepointMock.spendMoemoepoint).not.toHaveBeenCalled()
  })

  it('normalizes newlines in an official edit before writing', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(
      row({
        official: true,
        cost: 0,
        effective_from: now,
        effective_to: new Date('2026-09-14T12:00:00.000Z')
      })
    )

    await updateOfficialShoutbox(
      { shoutboxId: 12, content: '官方\n更新' },
      99,
      { now, db: prismaMock as never }
    )

    expect(prismaMock.shoutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { content: '官方 更新' } })
    )
  })

  it('replays an existing official message before validating changed times', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(
      row({
        official: true,
        cost: 0,
        effective_from: now,
        effective_to: new Date('2026-09-14T12:00:00.000Z')
      })
    )

    const response = await createOfficialShoutbox(
      {
        requestId,
        content: '重试官方消息',
        level: 'normal',
        link: '',
        effectiveFrom: new Date('2026-09-12T12:00:00.000Z'),
        effectiveTo: new Date('2026-09-11T12:00:00.000Z')
      },
      99,
      { now, db: prismaMock as never }
    )

    expect(response).toEqual(expect.objectContaining({ id: 12 }))
    expect(prismaMock.shoutbox.create).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('treats a concurrent official unique violation as an official replay', async () => {
    prismaMock.shoutbox.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        row({
          official: true,
          cost: 0,
          effective_from: now,
          effective_to: new Date('2026-09-14T12:00:00.000Z')
        })
      )
    prismaMock.shoutbox.create.mockRejectedValueOnce({ code: '23505' })

    const response = await createOfficialShoutbox(
      {
        requestId,
        content: '并发官方重试',
        level: 'normal',
        link: ''
      },
      99,
      { now, db: prismaMock as never }
    )

    expect(response).toEqual(expect.objectContaining({ id: 12 }))
    expect(prismaMock.admin_log.create).not.toHaveBeenCalled()
  })

  it('keeps an official status write and its admin log in one transaction', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(
      row({
        official: true,
        cost: 0,
        effective_from: now,
        effective_to: new Date('2026-09-14T12:00:00.000Z')
      })
    )

    await updateOfficialShoutbox({ shoutboxId: 12, action: 'cancel' }, 99, {
      now,
      db: prismaMock as never
    })

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(prismaMock.admin_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 99 })
      })
    )
  })

  it('does not write an official admin log when the CAS update loses', async () => {
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(
      row({
        official: true,
        cost: 0,
        effective_from: now,
        effective_to: new Date('2026-09-14T12:00:00.000Z')
      })
    )
    prismaMock.shoutbox.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      updateOfficialShoutbox({ shoutboxId: 12, action: 'cancel' }, 99, {
        now,
        db: prismaMock as never
      })
    ).resolves.toBe('官方小喇叭当前不能撤回')
    expect(prismaMock.admin_log.create).not.toHaveBeenCalled()
  })

  it('rechecks a shared in-flight payload when the second caller crosses its boundary', async () => {
    let release!: (value: {
      pinned: null
      shoutboxes: never[]
      page: number
      totalPages: number
      validUntil: string
    }) => void
    const pending = new Promise<{
      pinned: null
      shoutboxes: never[]
      page: number
      totalPages: number
      validUntil: string
    }>((resolve) => {
      release = resolve
    })
    cacheMock.getShoutboxCached
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(pending)
      .mockImplementation(async (_key, fetcher) => fetcher())
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValue(0)
    prismaMock.shoutbox.findMany.mockResolvedValue([])

    const first = getShoutboxList(
      { page: 1, limit: 20 },
      { now, db: prismaMock as never }
    )
    await Promise.resolve()
    const afterBoundary = new Date(now.getTime() + 61_000)
    const second = getShoutboxList(
      { page: 1, limit: 20 },
      { now: afterBoundary, db: prismaMock as never }
    )

    release({
      pinned: null,
      shoutboxes: [],
      page: 1,
      totalPages: 0,
      validUntil: new Date(now.getTime() + 60_000).toISOString()
    })
    await first
    await second

    expect(prismaMock.shoutbox.count).toHaveBeenCalled()
    expect(prismaMock.shoutbox.findFirst).toHaveBeenCalled()
  })

  it('normalizes JSON round-tripped dates from a cache hit before serializing', async () => {
    cacheMock.getShoutboxCached.mockResolvedValueOnce(
      JSON.parse(
        JSON.stringify({
          pinned: null,
          shoutboxes: [row({ content: '缓存\r\n内容' })],
          page: 1,
          totalPages: 1,
          validUntil: new Date(now.getTime() + 60_000).toISOString(),
          visibilityUntil: new Date(now.getTime() + 120_000).toISOString()
        })
      )
    )

    const response = await getShoutboxList(
      { page: 1, limit: 20 },
      { now, db: prismaMock as never }
    )

    expect(response.shoutboxes[0]).toMatchObject({
      content: '缓存 内容',
      created: '2026-09-11T10:00:00.000Z',
      updated: '2026-09-11T10:00:00.000Z'
    })
    expect(response.visibilityUntil).toBe(
      new Date(now.getTime() + 120_000).toISOString()
    )
  })

  it('reuses a raw list payload across visibility preferences', async () => {
    const cachedRow = row({
      patch_id: 8,
      patch: {
        id: 8,
        unique_id: 'Abc12345',
        name: '游戏',
        content_limit: 'nsfw',
        tag: []
      }
    })
    const payload = {
      pinned: null,
      shoutboxes: [cachedRow],
      page: 1,
      totalPages: 1,
      validUntil: new Date(now.getTime() + 60_000).toISOString()
    }
    cacheMock.getShoutboxCached.mockResolvedValue(payload)

    const restricted = await getShoutboxList(
      { page: 1, limit: 20 },
      {
        now,
        visibilityWhere: { content_limit: 'sfw' },
        db: prismaMock as never
      }
    )
    const unrestricted = await getShoutboxList(
      { page: 1, limit: 20 },
      { now, visibilityWhere: {}, db: prismaMock as never }
    )

    expect(restricted.shoutboxes[0].patch).toBeNull()
    expect(unrestricted.shoutboxes[0].patch).toEqual({
      id: 8,
      uniqueId: 'Abc12345',
      name: '游戏',
      contentLimit: 'nsfw'
    })
    expect(prismaMock.shoutbox.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.shoutbox.count).not.toHaveBeenCalled()
    expect(prismaMock.shoutbox.findMany).not.toHaveBeenCalled()
  })

  it('reuses a raw banner payload across visibility preferences', async () => {
    const cachedRow = row({
      official: true,
      level: 'important',
      effective_from: new Date(now.getTime() - 1_000),
      effective_to: new Date(now.getTime() + 60_000),
      patch_id: 8,
      patch: {
        id: 8,
        unique_id: 'Abc12345',
        name: '游戏',
        content_limit: 'nsfw',
        tag: []
      }
    })
    cacheMock.getShoutboxBannerCached.mockResolvedValue({
      banner: JSON.parse(JSON.stringify(cachedRow)),
      validUntil: new Date(now.getTime() + 60_000).toISOString(),
      visibilityUntil: new Date(now.getTime() + 60_000).toISOString()
    })

    const restricted = await getShoutboxBanner({
      now,
      visibilityWhere: { content_limit: 'sfw' },
      db: prismaMock as never
    })
    const unrestricted = await getShoutboxBanner({
      now,
      visibilityWhere: {},
      db: prismaMock as never
    })

    expect(restricted.banner?.patch).toBeNull()
    expect(unrestricted.banner?.patch).toEqual({
      id: 8,
      uniqueId: 'Abc12345',
      name: '游戏',
      contentLimit: 'nsfw'
    })
    expect(prismaMock.shoutbox.findFirst).not.toHaveBeenCalled()
  })

  it('captures the list build time after a cache wait crosses a boundary', async () => {
    vi.useFakeTimers()
    try {
      const start = new Date('2026-09-11T12:00:00.000Z')
      const completion = new Date(start.getTime() + 61_000)
      vi.setSystemTime(start)
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      cacheMock.getShoutboxCached.mockImplementationOnce(
        async (_key, fetcher) => {
          await wait
          return fetcher()
        }
      )
      prismaMock.shoutbox.findFirst.mockResolvedValue(null)
      prismaMock.shoutbox.count.mockResolvedValue(0)
      prismaMock.shoutbox.findMany.mockResolvedValue([])

      const request = getShoutboxList(
        { page: 1, limit: 20 },
        { db: prismaMock as never }
      )
      await Promise.resolve()
      vi.setSystemTime(completion)
      release()

      const response = await request

      expect(response.validUntil).toBe(
        new Date(completion.getTime() + 60_000).toISOString()
      )
      const current = prismaMock.shoutbox.findFirst.mock.calls.find(
        ([args]) => args?.where?.effective_from?.lte instanceof Date
      )?.[0].where.effective_from.lte
      expect(current).toEqual(completion)
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures the banner build time after a cache wait crosses a boundary', async () => {
    vi.useFakeTimers()
    try {
      const start = new Date('2026-09-11T12:00:00.000Z')
      const completion = new Date(start.getTime() + 61_000)
      vi.setSystemTime(start)
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      cacheMock.getShoutboxBannerCached.mockImplementationOnce(
        async (_key, fetcher) => {
          await wait
          return fetcher()
        }
      )
      prismaMock.shoutbox.findFirst.mockResolvedValue(null)

      const request = getShoutboxBanner({ db: prismaMock as never })
      await Promise.resolve()
      vi.setSystemTime(completion)
      release()

      const response = await request

      expect(response.validUntil).toBe(
        new Date(completion.getTime() + 60_000).toISOString()
      )
      expect(prismaMock.shoutbox.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effective_from: { lte: completion }
          })
        })
      )
      expect(prismaMock.shoutbox.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effective_from: { gt: completion }
          })
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the completion-time clock for an in-flight boundary refetch', async () => {
    vi.useFakeTimers()
    try {
      const start = new Date('2026-09-11T12:00:00.000Z')
      vi.setSystemTime(start)
      let release!: (value: unknown) => void
      const pending = new Promise((resolve) => {
        release = resolve
      })
      cacheMock.getShoutboxCached
        .mockReturnValueOnce(pending)
        .mockReturnValueOnce(pending)
        .mockImplementation(async (_key, fetcher) => fetcher())
      prismaMock.shoutbox.findFirst.mockResolvedValue(null)
      prismaMock.shoutbox.count.mockResolvedValue(1)
      prismaMock.shoutbox.findMany.mockResolvedValue([
        row({ content: '完成时重取内容' })
      ])

      const first = getShoutboxList(
        { page: 1, limit: 20 },
        { now: start, db: prismaMock as never }
      )
      await Promise.resolve()
      vi.setSystemTime(new Date(start.getTime() + 61_000))
      const second = getShoutboxList(
        { page: 1, limit: 20 },
        { db: prismaMock as never }
      )
      await Promise.resolve()
      const completionNow = new Date(start.getTime() + 62_000)
      vi.setSystemTime(completionNow)
      release({
        pinned: null,
        shoutboxes: [row({ content: '共享旧内容' })],
        page: 1,
        totalPages: 1,
        validUntil: new Date(start.getTime() + 60_000).toISOString()
      })

      await expect(first).resolves.toMatchObject({
        shoutboxes: [{ content: '共享旧内容' }]
      })
      await expect(second).resolves.toMatchObject({
        shoutboxes: [{ content: '完成时重取内容' }]
      })
      const boundaryWhere = prismaMock.shoutbox.findFirst.mock.calls.find(
        ([args]) =>
          args?.where?.official === true &&
          args?.where?.effective_from?.lte instanceof Date
      )?.[0].where
      expect(boundaryWhere.effective_from.lte).toEqual(completionNow)
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes the full next official boundary separately from list TTL', async () => {
    const future = new Date(now.getTime() + 120_000)
    prismaMock.shoutbox.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ effective_from: future })
    prismaMock.shoutbox.count.mockResolvedValueOnce(0)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([])

    const response = await getShoutboxList(
      { page: 1, limit: 20 },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.validUntil).toBe(
      new Date(now.getTime() + 60_000).toISOString()
    )
    expect(response.visibilityUntil).toBe(future.toISOString())
  })

  it('carries the full next official boundary through the home payload', async () => {
    const future = new Date(now.getTime() + 120_000)
    prismaMock.shoutbox.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ effective_from: future })
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([])

    const response = await getShoutboxHome({
      now,
      db: prismaMock as never,
      useCache: false
    })

    expect(response.validUntil).toBe(
      new Date(now.getTime() + 60_000).toISOString()
    )
    expect(response.visibilityUntil).toBe(future.toISOString())
  })

  it('uses the next future important message as the banner cache boundary', async () => {
    const future = new Date(now.getTime() + 120_000)
    prismaMock.shoutbox.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ effective_from: future })

    const response = await getShoutboxBanner({
      now,
      db: prismaMock as never,
      useCache: false
    })

    expect(response.banner).toBeNull()
    expect(response.validUntil).toBe(
      new Date(now.getTime() + 60_000).toISOString()
    )
    expect(response.visibilityUntil).toBe(future.toISOString())
  })

  it('uses only the next future official message for a game boundary', async () => {
    const future = new Date(now.getTime() + 120_000)
    prismaMock.patch.findUnique.mockResolvedValueOnce({ id: 8, status: 0 })
    prismaMock.shoutbox.findFirst.mockResolvedValueOnce({
      effective_from: future
    })
    prismaMock.shoutbox.count.mockResolvedValueOnce(0)

    const response = await getShoutboxList(
      { page: 1, limit: 20, patch: 'Abc12345' },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.validUntil).toBe(future.toISOString())
    expect(response.visibilityUntil).toBe(future.toISOString())
    expect(prismaMock.shoutbox.findFirst).toHaveBeenCalledOnce()
    expect(prismaMock.shoutbox.findFirst).toHaveBeenCalledWith({
      where: {
        official: true,
        status: 0,
        patch_id: 8,
        effective_from: { gt: now }
      },
      orderBy: { effective_from: 'asc' },
      select: { effective_from: true }
    })
  })

  it('raises a read error after a failed boundary reload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      cacheMock.getShoutboxCached.mockResolvedValueOnce({
        pinned: null,
        shoutboxes: [],
        page: 1,
        totalPages: 0,
        validUntil: new Date(now.getTime() - 1).toISOString()
      })
      prismaMock.shoutbox.findFirst.mockRejectedValueOnce(
        new Error('database unavailable')
      )

      await expect(
        getShoutboxList(
          { page: 1, limit: 20 },
          { now, db: prismaMock as never }
        )
      ).rejects.toBeInstanceOf(ShoutboxReadError)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('raises a banner read error after a failed boundary reload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      cacheMock.getShoutboxBannerCached.mockResolvedValueOnce({
        banner: null,
        validUntil: new Date(now.getTime() - 1).toISOString()
      })
      prismaMock.shoutbox.findFirst.mockRejectedValueOnce(
        new Error('database unavailable')
      )

      await expect(
        getShoutboxBanner({
          now,
          db: prismaMock as never
        })
      ).rejects.toBeInstanceOf(ShoutboxReadError)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('raises a read error when the cache helper rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      cacheMock.getShoutboxCached.mockRejectedValueOnce(
        new Error('cache refresh unavailable')
      )

      await expect(
        getShoutboxList(
          { page: 1, limit: 20 },
          { now, db: prismaMock as never }
        )
      ).rejects.toBeInstanceOf(ShoutboxReadError)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('raises a banner read error when the cache helper rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      cacheMock.getShoutboxBannerCached.mockRejectedValueOnce(
        new Error('cache refresh unavailable')
      )

      await expect(
        getShoutboxBanner({
          now,
          db: prismaMock as never
        })
      ).rejects.toBeInstanceOf(ShoutboxReadError)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('rechecks the completion clock for a direct banner query', async () => {
    vi.useFakeTimers()
    try {
      const start = new Date('2026-09-11T12:00:00.000Z')
      const completionNow = new Date(start.getTime() + 61_000)
      vi.setSystemTime(start)
      let release!: (value: null) => void
      const pending = new Promise<null>((resolve) => {
        release = resolve
      })
      prismaMock.shoutbox.findFirst
        .mockImplementationOnce(() => pending)
        .mockImplementationOnce(() => pending)
        .mockResolvedValue(null)

      const request = getShoutboxBanner({
        db: prismaMock as never,
        useCache: false
      })
      await Promise.resolve()
      vi.setSystemTime(completionNow)
      release(null)

      const response = await request

      expect(response.banner).toBeNull()
      expect(response.validUntil).toBe(
        new Date(completionNow.getTime() + 60_000).toISOString()
      )
      expect(
        prismaMock.shoutbox.findFirst.mock.calls[2][0].where.effective_from.lte
      ).toEqual(completionNow)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses twenty-row pages for an unbounded game history', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'sfw',
      tag: []
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(21)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([row()])

    const response = await getShoutboxList(
      { page: 2, limit: 20, patch: 'Abc12345' },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.totalPages).toBe(2)
    expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patch_id: 8,
          status: 0,
          OR: expect.any(Array)
        }),
        skip: 20,
        take: 20
      })
    )
  })

  it('includes public historical game rows without a retention horizon', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'sfw',
      tag: []
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([
      row({ patch_id: 8, created: new Date('2020-01-01T10:00:00.000Z') })
    ])

    const response = await getShoutboxList(
      { page: 1, limit: 20, patch: 'Abc12345' },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.shoutboxes).toHaveLength(1)
    expect(response.totalPages).toBe(1)
    expect(response.validUntil).toBe(
      new Date(now.getTime() + 300_000).toISOString()
    )
    expect(response.visibilityUntil).toBeNull()
    expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patch_id: 8 }),
        skip: 0,
        take: 20
      })
    )
  })

  it('does not hydrate message rows when an unbounded game page is beyond totalPages', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'sfw',
      tag: []
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)

    const response = await getShoutboxList(
      { page: 2, limit: 20, patch: 'Abc12345' },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.totalPages).toBe(1)
    expect(response.shoutboxes).toEqual([])
    expect(prismaMock.shoutbox.findMany).not.toHaveBeenCalled()
  })

  it('revalidates public state and patch association during game hydration', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'sfw',
      tag: []
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([])

    const response = await getShoutboxList(
      { page: 1, limit: 20, patch: 'Abc12345' },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.shoutboxes).toEqual([])
    expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patch_id: 8,
          status: 0,
          OR: expect.any(Array)
        })
      })
    )
  })

  it('reserves one home slot for a pinned message and probes one more row', async () => {
    const pinned = row({
      id: 99,
      official: true,
      cost: 0,
      effective_from: new Date('2026-09-11T11:00:00.000Z'),
      effective_to: new Date('2026-09-14T12:00:00.000Z')
    })
    prismaMock.shoutbox.findFirst
      .mockResolvedValueOnce({
        id: 99,
        effective_to: pinned.effective_to
      })
      .mockResolvedValue(null)
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(pinned)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce(
      Array.from({ length: 15 }, (_, index) => row({ id: 98 - index }))
    )

    const response = await getShoutboxHome({
      now,
      db: prismaMock as never,
      useCache: false
    })

    expect(response.pinned?.id).toBe(99)
    expect(response.page).toBe(1)
    expect(response.totalPages).toBe(1)
    expect(response.shoutboxes).toHaveLength(14)
    expect(response.hasMore).toBe(true)
    expect(prismaMock.shoutbox.count).not.toHaveBeenCalled()
    expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 15,
        where: expect.objectContaining({
          status: 0,
          id: { not: 99 }
        })
      })
    )
  })

  it.each([14, 15, 16])(
    'sets hasMore from the home probe for %i ordinary rows',
    async (rowCount) => {
      prismaMock.shoutbox.findFirst.mockResolvedValue(null)
      prismaMock.shoutbox.findMany.mockResolvedValueOnce(
        Array.from({ length: rowCount }, (_, index) => row({ id: 12 + index }))
      )

      const response = await getShoutboxHome({
        now,
        db: prismaMock as never,
        useCache: false
      })

      expect(response.pinned).toBeNull()
      expect(response.totalPages).toBe(1)
      expect(response.shoutboxes).toHaveLength(Math.min(rowCount, 15))
      expect(response.hasMore).toBe(rowCount > 15)
      expect(prismaMock.shoutbox.count).not.toHaveBeenCalled()
      expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 16 })
      )
    }
  )

  it('allows the global list to page beyond the former sixty-row horizon', async () => {
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(101)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([row({ id: 1 })])

    const response = await getShoutboxList(
      { page: 6, limit: 20 },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.totalPages).toBe(6)
    expect(prismaMock.shoutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 20 })
    )
  })

  it('does not hydrate a pinned message after its effective state changes', async () => {
    prismaMock.shoutbox.findFirst.mockResolvedValueOnce({
      id: 12,
      effective_to: new Date('2026-09-14T12:00:00.000Z')
    })
    prismaMock.shoutbox.findUnique.mockResolvedValueOnce(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(0)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([])

    const response = await getShoutboxList(
      { page: 1, limit: 20 },
      { now, db: prismaMock as never, useCache: false }
    )

    expect(response.pinned).toBeNull()
    expect(prismaMock.shoutbox.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 12,
          official: true,
          status: 0,
          effective_from: { lte: now },
          effective_to: { gt: now }
        })
      })
    )
  })

  it('does not use visibility preferences to reject a game cache payload', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'nsfw',
      tag: []
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([
      row({
        patch_id: 8,
        patch: {
          id: 8,
          unique_id: 'Abc12345',
          name: '成人作品',
          content_limit: 'nsfw',
          tag: []
        }
      })
    ])

    const response = await getShoutboxList(
      { page: 1, limit: 20, patch: 'Abc12345' },
      {
        now,
        db: prismaMock as never,
        visibilityWhere: { content_limit: 'sfw' } as never,
        useCache: false
      }
    )

    expect(response.shoutboxes).toHaveLength(1)
    expect(response.shoutboxes[0].patch).toBeNull()
  })

  it('masks a patch with a blocked tag without dropping the message', async () => {
    prismaMock.patch.findUnique.mockResolvedValueOnce({
      id: 8,
      status: 0,
      content_limit: 'sfw',
      tag: [{ tag_id: 42 }]
    })
    prismaMock.shoutbox.findFirst.mockResolvedValue(null)
    prismaMock.shoutbox.count.mockResolvedValueOnce(1)
    prismaMock.shoutbox.findMany.mockResolvedValueOnce([
      row({
        patch_id: 8,
        patch: {
          id: 8,
          unique_id: 'Abc12345',
          name: '被屏蔽作品',
          content_limit: 'sfw',
          tag: [{ tag_id: 42 }]
        }
      })
    ])

    const response = await getShoutboxList(
      { page: 1, limit: 20, patch: 'Abc12345' },
      {
        now,
        db: prismaMock as never,
        visibilityWhere: {
          NOT: { tag: { some: { tag_id: { in: [42] } } } }
        } as never,
        useCache: false
      }
    )

    expect(response.shoutboxes).toHaveLength(1)
    expect(response.shoutboxes[0].patch).toBeNull()
  })
})
