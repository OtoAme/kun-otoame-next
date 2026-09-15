import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    ops_case: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    ops_case_message: { create: vi.fn() },
    ops_case_subscriber: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    user_message: { createMany: vi.fn() }
  }
  return { prisma: tx, tx }
})

vi.mock('~/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  updatePatchAttributes: vi.fn()
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/utils/message', () => ({ createMessage: vi.fn() }))

import {
  buildCaseDailyKey,
  buildCaseDedupKey,
  closeCaseInternal
} from '~/app/api/case/service'

const now = new Date('2026-09-13T15:59:59.999Z')

const row = () => ({
  id: 42,
  kind: 'content_violation',
  target_type: 'comment',
  target_id: 100,
  patch_id: 7,
  owner_type: 'staff',
  owner_id: null,
  status: 'open',
  resolution: null,
  public: false,
  source: 'user',
  dedup_key: 'comment:100:content_violation',
  daily_key: null,
  revision: 3,
  status_changed_at: now,
  queue_entered_at: now,
  closed_at: null,
  escalated_at: null,
  first_owner_response_at: null,
  hidden_at: null,
  restored_at: null,
  reopened_count: 0,
  reporter_id: 2,
  owner: null,
  reporter: null,
  _count: { subscribers: 3 },
  created: now,
  updated: now
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tx.$queryRaw.mockResolvedValue([{}])
  mocks.tx.ops_case.findUnique.mockResolvedValue(row())
  mocks.tx.ops_case.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.ops_case_message.create.mockResolvedValue({ id: 50 })
  mocks.tx.ops_case_subscriber.findMany.mockResolvedValue([
    { user_id: 3 },
    { user_id: 9 }
  ])
  mocks.tx.user.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }, { id: 9 }])
  mocks.tx.user_message.createMany.mockResolvedValue({ count: 4 })
})

describe('case service contracts', () => {
  it('keeps dedup and Shanghai daily keys stable at the day boundary', () => {
    expect(buildCaseDedupKey('resource', 8, 'resource_mismatch')).toBe(
      'resource:8:resource_mismatch'
    )
    expect(buildCaseDailyKey(2, 'resource', 8, now)).toBe(
      '2:resource:8:2026-09-13'
    )
    expect(
      buildCaseDailyKey(2, 'resource', 8, new Date('2026-09-13T16:00:00.000Z'))
    ).toBe('2:resource:8:2026-09-14')
  })

  it('deduplicates close notices and prefers the staff link for staff users', async () => {
    await expect(
      closeCaseInternal(mocks.tx as never, {
        caseId: 42,
        expectedStatuses: ['open'],
        resolution: 'handled',
        actorType: 'staff',
        actorId: 99,
        now
      })
    ).resolves.toMatchObject({ changed: true })

    expect(mocks.tx.user_message.createMany).toHaveBeenCalledOnce()
    const data = mocks.tx.user_message.createMany.mock.calls[0][0].data as {
      recipient_id: number
      sender_id: number | null
      link: string
    }[]
    expect(data).toHaveLength(4)
    expect(data.map((message) => message.recipient_id).sort()).toEqual([
      2, 3, 4, 9
    ])
    expect(data.find((message) => message.recipient_id === 2)).toMatchObject({
      sender_id: null,
      link: '/issue/42'
    })
    for (const recipientId of [3, 4, 9]) {
      expect(
        data.filter((message) => message.recipient_id === recipientId)
      ).toHaveLength(1)
      expect(
        data.find((message) => message.recipient_id === recipientId)
      ).toMatchObject({
        sender_id: 99,
        link: '/dashboard/case/42'
      })
    }
  })
})
