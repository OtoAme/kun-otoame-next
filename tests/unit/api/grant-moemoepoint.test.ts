import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

// Mock Prisma
const prismaMocks = vi.hoisted(() => {
  const tx = {
    admin_log: { create: vi.fn() },
    user_moemoepoint_ledger: { findUnique: vi.fn() },
    $queryRaw: vi.fn()
  }
  return {
    tx,
    user: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

// Mock createMessage
const createMessageMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock
}))

const earnMoemoepointMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/moemoepoint/service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/app/api/moemoepoint/service')>()
  return { ...actual, earnMoemoepoint: earnMoemoepointMock }
})

import { grantMoemoepoint } from '~/app/api/admin/user/grant-moemoepoint'
import { adminGrantMoemoepointSchema } from '~/validations/admin'

const REQUEST_ID = '4f1c9a2e-6d5b-4a7c-9e31-0b8f2c7d4a55'
const REUSED_REQUEST_ID_ERROR =
  '该请求标识已用于另一笔发放, 请关闭弹窗并核对账单后重新发起'

const grantInput = (
  overrides: Partial<{ uid: number; amount: number; reason: string }> = {}
) => ({ uid: 1, amount: 50, requestId: REQUEST_ID, ...overrides })

const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: 1,
  balance_delta: 50,
  reason_code: 'admin.grant',
  reason: '管理员发放',
  operator_id: 2,
  reference_type: 'admin_grant',
  ...overrides
})

const p2002 = (target: string[] | string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target }
  })

const replayWith = (row: Record<string, unknown> | null) => {
  earnMoemoepointMock.mockImplementation(() =>
    Promise.resolve({
      balance: { total: 150, reserved: 0, available: 150 },
      ledgerId: 7,
      applied: false
    })
  )
  prismaMocks.tx.user_moemoepoint_ledger.findUnique.mockResolvedValue(row)
}

describe('grantMoemoepoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation(
      (fn: (client: typeof prismaMocks.tx) => Promise<unknown>) =>
        fn(prismaMocks.tx)
    )
    earnMoemoepointMock.mockImplementation((_tx, input: { amount: number }) =>
      Promise.resolve({
        balance: {
          total: 100 + input.amount,
          reserved: 0,
          available: 100 + input.amount
        },
        ledgerId: 1,
        applied: true
      })
    )
    prismaMocks.tx.user_moemoepoint_ledger.findUnique.mockReset()
    prismaMocks.user.findUnique.mockReset()
    prismaMocks.user.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          where.id === 1
            ? { id: 1, name: 'TestUser', moemoepoint: 100 }
            : { id: where.id, name: 'AdminUser' }
        )
    )
  })

  it('should grant moemoepoints successfully', async () => {
    const result = await grantMoemoepoint(grantInput(), 2)

    expect(result).toEqual({
      balance: { total: 150, reserved: 0, available: 150 },
      applied: true
    })
    expect(earnMoemoepointMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 1,
        amount: 50,
        reasonCode: 'admin.grant',
        reason: '管理员发放',
        operatorId: 2,
        idempotencyKey: `admin-grant:2:${REQUEST_ID}`
      })
    )
    expect(createMessageMock).toHaveBeenCalledTimes(1)
    expect(createMessageMock).toHaveBeenCalledWith(
      {
        type: 'system',
        content: '管理员为您发放了 50 萌萌点。',
        sender_id: 2,
        recipient_id: 1,
        link: '/moemoepoint'
      },
      expect.anything()
    )
    expect(prismaMocks.tx.admin_log.create).toHaveBeenCalledTimes(1)
    expect(prismaMocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'grant',
        user_id: 2
      })
    })
  })

  it('should return error when user not found', async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce(null)

    const result = await grantMoemoepoint(grantInput({ uid: 999 }), 2)

    expect(result).toBe('未找到该用户')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('should return error when admin not found', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser' })
      .mockResolvedValueOnce(null)

    const result = await grantMoemoepoint(grantInput(), 999)

    expect(result).toBe('未找到该管理员')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('should include reason in notification when provided', async () => {
    await grantMoemoepoint(grantInput({ reason: '活动奖励' }), 2)

    expect(createMessageMock).toHaveBeenCalledWith(
      {
        type: 'system',
        content: '管理员为您发放了 50 萌萌点。\n理由: 活动奖励',
        sender_id: 2,
        recipient_id: 1,
        link: '/moemoepoint'
      },
      expect.anything()
    )
  })

  it('should not include reason in notification when not provided', async () => {
    await grantMoemoepoint(grantInput({ amount: 30 }), 2)

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '管理员为您发放了 30 萌萌点。'
      }),
      expect.anything()
    )
  })

  it('should include reason in admin log when provided', async () => {
    await grantMoemoepoint(grantInput({ reason: '活动奖励' }), 2)

    expect(prismaMocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining('理由: 活动奖励')
      })
    })
  })

  it('derives the admin log baseline from the committed balance, not the stale pre-read', async () => {
    earnMoemoepointMock.mockResolvedValue({
      balance: { total: 500, reserved: 0, available: 500 },
      ledgerId: 1,
      applied: true
    })

    await grantMoemoepoint(grantInput(), 2)

    const content = prismaMocks.tx.admin_log.create.mock.calls[0][0].data
      .content as string
    expect(content).toContain('原总萌萌点: 450')
    expect(content).toContain('发放后总萌萌点: 500')
  })

  it('pays nothing and notifies nobody when the same request replays', async () => {
    replayWith(ledgerRow())

    const result = await grantMoemoepoint(grantInput(), 2)

    expect(result).toEqual({
      balance: { total: 150, reserved: 0, available: 150 },
      applied: false
    })
    expect(
      prismaMocks.tx.user_moemoepoint_ledger.findUnique
    ).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }))
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(prismaMocks.tx.admin_log.create).not.toHaveBeenCalled()
    expect(prismaMocks.tx.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMocks.user.update).not.toHaveBeenCalled()
  })

  it('accepts a replay whose over-long reason was truncated on the way in', async () => {
    const reason = 'あ'.repeat(600)
    replayWith(ledgerRow({ reason: reason.slice(0, 500) }))

    const result = await grantMoemoepoint(grantInput({ reason }), 2)

    expect(result).toEqual({
      balance: { total: 150, reserved: 0, available: 150 },
      applied: false
    })
  })

  it('refuses a request id that was already used for a different amount', async () => {
    replayWith(ledgerRow({ balance_delta: 30 }))

    const result = await grantMoemoepoint(grantInput(), 2)

    expect(result).toBe(REUSED_REQUEST_ID_ERROR)
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(prismaMocks.tx.admin_log.create).not.toHaveBeenCalled()
  })

  it('refuses a request id that was already used for a different reason', async () => {
    replayWith(ledgerRow({ reason: '别的理由' }))

    const result = await grantMoemoepoint(grantInput({ reason: '活动奖励' }), 2)

    expect(result).toBe(REUSED_REQUEST_ID_ERROR)
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(prismaMocks.tx.admin_log.create).not.toHaveBeenCalled()
  })

  it('retries the whole transaction once when two grants race on the idempotency key', async () => {
    replayWith(ledgerRow())
    prismaMocks.$transaction.mockRejectedValueOnce(p2002(['idempotency_key']))

    const result = await grantMoemoepoint(grantInput(), 2)

    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      balance: { total: 150, reserved: 0, available: 150 },
      applied: false
    })
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(prismaMocks.tx.admin_log.create).not.toHaveBeenCalled()
  })

  it('rethrows a unique constraint failure on another column instead of retrying', async () => {
    const error = p2002(['user_id'])
    prismaMocks.$transaction.mockRejectedValueOnce(error)

    await expect(grantMoemoepoint(grantInput(), 2)).rejects.toBe(error)
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('adminGrantMoemoepointSchema', () => {
  it('should accept valid input', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100,
      requestId: REQUEST_ID,
      reason: '活动奖励'
    })
    expect(result.success).toBe(true)
  })

  it('should accept input without reason', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100,
      requestId: REQUEST_ID
    })
    expect(result.success).toBe(true)
  })

  it('should reject a missing request id', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100
    })
    expect(result.success).toBe(false)
  })

  it('should reject a request id that is not a uuid', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100,
      requestId: 'retry-1'
    })
    expect(result.success).toBe(false)
  })

  it('should reject amount of 0', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 0,
      requestId: REQUEST_ID
    })
    expect(result.success).toBe(false)
  })

  it('should reject negative amount', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: -10,
      requestId: REQUEST_ID
    })
    expect(result.success).toBe(false)
  })

  it('should reject amount exceeding maximum', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100001,
      requestId: REQUEST_ID
    })
    expect(result.success).toBe(false)
  })

  it('should reject non-integer amount', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 10.5,
      requestId: REQUEST_ID
    })
    expect(result.success).toBe(false)
  })

  it('should reject reason exceeding max length', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 10,
      requestId: REQUEST_ID,
      reason: 'a'.repeat(501)
    })
    expect(result.success).toBe(false)
  })
})
