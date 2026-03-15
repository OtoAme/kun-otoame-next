import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
const prismaMocks = vi.hoisted(() => {
  const transactionFn = vi.fn()
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    admin_log: {
      create: vi.fn()
    },
    $transaction: vi.fn((fn: (prisma: any) => Promise<any>) => {
      return fn({
        user: { update: transactionFn },
        admin_log: { create: vi.fn() }
      })
    }),
    _transactionUserUpdate: transactionFn
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

import { grantMoemoepoint } from '~/app/api/admin/user/grant-moemoepoint'
import { adminGrantMoemoepointSchema } from '~/validations/admin'

describe('grantMoemoepoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset $transaction to use a fresh inner mock each test
    prismaMocks.$transaction.mockImplementation(
      (fn: (prisma: any) => Promise<any>) => {
        return fn({
          user: { update: prismaMocks._transactionUserUpdate },
          admin_log: { create: prismaMocks.admin_log.create }
        })
      }
    )
  })

  it('should grant moemoepoints successfully', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser', moemoepoint: 100 })
      .mockResolvedValueOnce({ id: 2, name: 'AdminUser' })

    const result = await grantMoemoepoint(
      { uid: 1, amount: 50 },
      2
    )

    expect(result).toEqual({})
    expect(prismaMocks._transactionUserUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { moemoepoint: { increment: 50 } }
    })
    expect(createMessageMock).toHaveBeenCalledWith({
      type: 'system',
      content: '管理员为您发放了 50 萌萌点。',
      sender_id: 2,
      recipient_id: 1,
      link: '/user/1/resource'
    })
    expect(prismaMocks.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'grant',
        user_id: 2
      })
    })
  })

  it('should return error when user not found', async () => {
    prismaMocks.user.findUnique.mockResolvedValueOnce(null)

    const result = await grantMoemoepoint({ uid: 999, amount: 50 }, 2)

    expect(result).toBe('未找到该用户')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('should return error when admin not found', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser', moemoepoint: 100 })
      .mockResolvedValueOnce(null)

    const result = await grantMoemoepoint({ uid: 1, amount: 50 }, 999)

    expect(result).toBe('未找到该管理员')
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
  })

  it('should include reason in notification when provided', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser', moemoepoint: 100 })
      .mockResolvedValueOnce({ id: 2, name: 'AdminUser' })

    await grantMoemoepoint(
      { uid: 1, amount: 50, reason: '活动奖励' },
      2
    )

    expect(createMessageMock).toHaveBeenCalledWith({
      type: 'system',
      content: '管理员为您发放了 50 萌萌点。\n理由: 活动奖励',
      sender_id: 2,
      recipient_id: 1,
      link: '/user/1/resource'
    })
  })

  it('should not include reason in notification when not provided', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser', moemoepoint: 100 })
      .mockResolvedValueOnce({ id: 2, name: 'AdminUser' })

    await grantMoemoepoint({ uid: 1, amount: 30 }, 2)

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '管理员为您发放了 30 萌萌点。'
      })
    )
  })

  it('should include reason in admin log when provided', async () => {
    prismaMocks.user.findUnique
      .mockResolvedValueOnce({ id: 1, name: 'TestUser', moemoepoint: 100 })
      .mockResolvedValueOnce({ id: 2, name: 'AdminUser' })

    await grantMoemoepoint(
      { uid: 1, amount: 50, reason: '活动奖励' },
      2
    )

    expect(prismaMocks.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining('理由: 活动奖励')
      })
    })
  })
})

describe('adminGrantMoemoepointSchema', () => {
  it('should accept valid input', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100,
      reason: '活动奖励'
    })
    expect(result.success).toBe(true)
  })

  it('should accept input without reason', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100
    })
    expect(result.success).toBe(true)
  })

  it('should reject amount of 0', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 0
    })
    expect(result.success).toBe(false)
  })

  it('should reject negative amount', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: -10
    })
    expect(result.success).toBe(false)
  })

  it('should reject amount exceeding maximum', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 100001
    })
    expect(result.success).toBe(false)
  })

  it('should reject non-integer amount', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 10.5
    })
    expect(result.success).toBe(false)
  })

  it('should reject reason exceeding max length', () => {
    const result = adminGrantMoemoepointSchema.safeParse({
      uid: 1,
      amount: 10,
      reason: 'a'.repeat(501)
    })
    expect(result.success).toBe(false)
  })
})
