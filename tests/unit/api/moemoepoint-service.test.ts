import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MoemoepointInsufficientError,
  applyMoemoepointChange,
  forfeitMoemoepoint,
  releaseMoemoepoint,
  reserveMoemoepoint,
  reverseMoemoepoint,
  spendMoemoepoint
} from '~/app/api/moemoepoint/service'

const createTx = () => ({
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  user_moemoepoint_ledger: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn()
  },
  user_moemoepoint_reservation: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn()
  }
})

describe('moemoepoint ledger service', () => {
  let tx: ReturnType<typeof createTx>

  beforeEach(() => {
    tx = createTx()
    tx.user_moemoepoint_ledger.findUnique.mockResolvedValue(null)
    tx.user_moemoepoint_ledger.create.mockResolvedValue({ id: 7 })
  })

  it('writes balance and reserved snapshots with every change', async () => {
    tx.$queryRaw.mockResolvedValue([
      { moemoepoint: 13, moemoepoint_reserved: 2 }
    ])

    const result = await applyMoemoepointChange(tx as never, {
      userId: 1,
      kind: 'earn',
      balanceDelta: 3,
      reasonCode: 'test.earn',
      reason: '测试奖励'
    })

    expect(result).toEqual({
      balance: { total: 13, reserved: 2, available: 11 },
      ledgerId: 7,
      applied: true
    })
    expect(tx.user_moemoepoint_ledger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 1,
        kind: 'earn',
        balance_delta: 3,
        reserved_delta: 0,
        balance_after: 13,
        reserved_after: 2,
        reason_code: 'test.earn',
        reason: '测试奖励'
      }),
      select: { id: true }
    })
  })

  it('truncates an over-long reason instead of failing the caller transaction', async () => {
    tx.$queryRaw.mockResolvedValue([
      { moemoepoint: 3, moemoepoint_reserved: 0 }
    ])

    // 游戏名是 VarChar(1007) 且没有 zod 上限, 拼进 reason 会超过 VarChar(500)。
    // 早期实现在这里抛错, 导致发布游戏的整个事务回滚, 而 banner 已经上传 S3。
    const reason = `发布 OtomeGame 奖励：${'あ'.repeat(600)}`
    expect(reason.length).toBeGreaterThan(500)

    await expect(
      applyMoemoepointChange(tx as never, {
        userId: 1,
        kind: 'earn',
        balanceDelta: 3,
        reasonCode: 'patch.create_reward',
        reason
      })
    ).resolves.toMatchObject({ applied: true })

    const written = tx.user_moemoepoint_ledger.create.mock.calls[0][0].data
      .reason as string
    expect(written).toHaveLength(500)
    expect(reason.startsWith(written)).toBe(true)
  })

  it('still rejects an empty reason', async () => {
    tx.$queryRaw.mockResolvedValue([
      { moemoepoint: 3, moemoepoint_reserved: 0 }
    ])

    await expect(
      applyMoemoepointChange(tx as never, {
        userId: 1,
        kind: 'earn',
        balanceDelta: 3,
        reasonCode: 'test.earn',
        reason: '   '
      })
    ).rejects.toThrow('萌萌点变更原因不合法')
  })

  it('rejects spending when the conditional available-balance update loses', async () => {
    tx.$queryRaw.mockResolvedValue([])
    tx.user.findUnique.mockResolvedValue({
      moemoepoint: 10,
      moemoepoint_reserved: 5
    })

    await expect(
      spendMoemoepoint(tx as never, {
        userId: 1,
        amount: 6,
        reasonCode: 'test.spend',
        reason: '测试消费'
      })
    ).rejects.toBeInstanceOf(MoemoepointInsufficientError)
    expect(tx.user_moemoepoint_ledger.create).not.toHaveBeenCalled()
  })

  it('allows a reversal to form a negative balance for complete audit', async () => {
    tx.$queryRaw.mockResolvedValue([
      { moemoepoint: -2, moemoepoint_reserved: 0 }
    ])

    const result = await reverseMoemoepoint(tx as never, {
      userId: 1,
      amount: 3,
      reasonCode: 'test.reversal',
      reason: '测试回退'
    })

    expect(result.balance).toEqual({ total: -2, reserved: 0, available: -2 })
    expect(tx.user_moemoepoint_ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'reversal', balance_delta: -3 })
      })
    )
  })

  it('returns the current balance without applying an existing idempotent entry', async () => {
    tx.user_moemoepoint_ledger.findUnique.mockResolvedValue({
      id: 9,
      user_id: 1
    })
    tx.user.findUnique.mockResolvedValue({
      moemoepoint: 20,
      moemoepoint_reserved: 4
    })

    const result = await applyMoemoepointChange(tx as never, {
      userId: 1,
      kind: 'earn',
      balanceDelta: 3,
      reasonCode: 'test.earn',
      reason: '测试奖励',
      idempotencyKey: 'same-event'
    })

    expect(result).toEqual({
      balance: { total: 20, reserved: 4, available: 16 },
      ledgerId: 9,
      applied: false
    })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })

  it('reserves points without changing total balance', async () => {
    tx.user_moemoepoint_reservation.findUnique.mockResolvedValue(null)
    tx.user_moemoepoint_reservation.create.mockResolvedValue({
      id: 11,
      user_id: 1,
      amount: 5,
      status: 'pending'
    })
    tx.$queryRaw.mockResolvedValue([
      { moemoepoint: 20, moemoepoint_reserved: 5 }
    ])

    const result = await reserveMoemoepoint(tx as never, {
      userId: 1,
      amount: 5,
      reasonCode: 'test.reserve',
      reason: '测试暂扣',
      idempotencyKey: 'reserve-1'
    })

    expect(result.balance).toEqual({ total: 20, reserved: 5, available: 15 })
    expect(tx.user_moemoepoint_ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'reserve',
          balance_delta: 0,
          reserved_delta: 5,
          reservation_id: 11
        })
      })
    )
  })

  it.each([
    ['released', releaseMoemoepoint, 20, 0, 20, 'release', 0],
    ['forfeited', forfeitMoemoepoint, 15, 0, 15, 'forfeit', -5]
  ] as const)(
    'settles a reservation as %s exactly once',
    async (status, settle, total, reserved, available, kind, balanceDelta) => {
      const reservation = {
        id: 11,
        user_id: 1,
        amount: 5,
        status: 'pending',
        reference_type: 'test',
        reference_id: '1',
        link: ''
      }
      tx.user_moemoepoint_reservation.findUnique.mockResolvedValue(reservation)
      tx.user_moemoepoint_reservation.updateMany.mockResolvedValue({ count: 1 })
      tx.user_moemoepoint_reservation.findUniqueOrThrow.mockResolvedValue({
        ...reservation,
        status
      })
      tx.$queryRaw.mockResolvedValue([
        { moemoepoint: total, moemoepoint_reserved: reserved }
      ])

      const result = await settle(tx as never, {
        reservationId: 11,
        reasonCode: `test.${status}`,
        reason: '测试结算',
        idempotencyKey: `settle-${status}`
      })

      expect(result.balance).toEqual({ total, reserved, available })
      expect(tx.user_moemoepoint_ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind,
            balance_delta: balanceDelta,
            reserved_delta: -5
          })
        })
      )
    }
  )
})
