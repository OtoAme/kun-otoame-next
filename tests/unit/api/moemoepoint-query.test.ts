import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn()
  },
  user_moemoepoint_ledger: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))

import { getMoemoepointLedger } from '~/app/api/moemoepoint/query'

describe('moemoepoint queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns private ledger deltas and snapshots in stable order', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      name: 'Saya',
      avatar: '/avatar.webp',
      moemoepoint: 20,
      moemoepoint_reserved: 5
    })
    prismaMock.user_moemoepoint_ledger.findMany.mockResolvedValue([
      {
        id: 9,
        kind: 'reserve',
        balance_delta: 0,
        reserved_delta: 5,
        balance_after: 20,
        reserved_after: 5,
        reason_code: 'test.reserve',
        reason: '测试暂扣',
        reference_type: 'test',
        reference_id: '1',
        link: '',
        created: new Date('2026-08-17T03:00:00.000Z')
      }
    ])
    prismaMock.user_moemoepoint_ledger.count.mockResolvedValue(1)

    const result = await getMoemoepointLedger(
      7,
      { range: '30d', page: 1, limit: 30 },
      new Date('2026-08-17T04:00:00.000Z')
    )

    expect(result).toEqual(
      expect.objectContaining({
        balance: { total: 20, reserved: 5, available: 15 },
        records: [
          expect.objectContaining({
            kind: 'reserve',
            balanceDelta: 0,
            reservedDelta: 5,
            availableDelta: -5,
            balanceAfter: { total: 20, reserved: 5, available: 15 }
          })
        ]
      })
    )
    expect(prismaMock.user_moemoepoint_ledger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 30,
        where: expect.objectContaining({ user_id: 7 })
      })
    )
  })

  // 用户不存在时不应该白跑明细查询。
  it('checks the user before running any ledger query', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)

    const result = await getMoemoepointLedger(404, {
      range: '30d',
      page: 1,
      limit: 30
    })

    expect(result).toBe('未找到用户')
    expect(prismaMock.user_moemoepoint_ledger.findMany).not.toHaveBeenCalled()
    expect(prismaMock.user_moemoepoint_ledger.count).not.toHaveBeenCalled()
  })
})
