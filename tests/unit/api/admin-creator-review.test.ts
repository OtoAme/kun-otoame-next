import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    user_message: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn()
    },
    user: { updateMany: vi.fn() },
    admin_log: { create: vi.fn() }
  }
  return {
    tx,
    prisma: {
      user: { findUnique: vi.fn() },
      user_message: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx))
    },
    updateKunSessions: vi.fn()
  }
})

vi.mock('~/prisma/index', () => ({ prisma: mocks.prisma }))
vi.mock('~/app/api/utils/jwt', () => ({
  updateKunSessions: mocks.updateKunSessions
}))

import {
  approveCreator,
  declineCreator,
  getAdminCreator
} from '~/app/api/admin/creator/service'

const applicant = {
  id: 21,
  name: 'kuro',
  role: 1,
  _count: { patch_resource: 4 }
}
const admin = { id: 2, name: '七海', role: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.user.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(where.id === 2 ? admin : where.id === 21 ? applicant : null)
  )
  mocks.prisma.user_message.findUnique.mockResolvedValue({ sender_id: 21 })
  mocks.tx.user_message.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 })
})

describe('approveCreator', () => {
  it('claims an open application, promotes only an ordinary user and notifies inside the transaction', async () => {
    await expect(approveCreator({ messageId: 7, uid: 21 }, 2)).resolves.toEqual(
      {}
    )
    expect(mocks.tx.user_message.updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        type: 'apply',
        recipient_id: null,
        sender_id: 21,
        status: { in: [0, 1] }
      },
      data: { status: 2 }
    })
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 21, role: 1 },
      data: { role: 2 }
    })
    expect(mocks.tx.user_message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_id: 21,
        link: '/apply/success'
      })
    })
    expect(mocks.tx.admin_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'creator_review', user_id: 2 })
    })
    expect(mocks.updateKunSessions).toHaveBeenCalledWith(21, { role: 2 })
  })

  it('does nothing when the application was already handled', async () => {
    mocks.tx.user_message.updateMany.mockResolvedValue({ count: 0 })
    mocks.tx.user_message.findUnique.mockResolvedValue({ sender_id: 21 })
    await expect(approveCreator({ messageId: 7, uid: 21 }, 2)).resolves.toBe(
      '该创作者申请已被处理，请刷新列表'
    )
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.user_message.create).not.toHaveBeenCalled()
    expect(mocks.tx.admin_log.create).not.toHaveBeenCalled()
    expect(mocks.updateKunSessions).not.toHaveBeenCalled()
  })

  it('rejects an application that belongs to another user', async () => {
    mocks.tx.user_message.updateMany.mockResolvedValue({ count: 0 })
    mocks.tx.user_message.findUnique.mockResolvedValue({ sender_id: 99 })
    await expect(approveCreator({ messageId: 7, uid: 21 }, 2)).resolves.toBe(
      '创作者请求与用户不匹配'
    )
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled()
  })

  it('never lowers an account another admin promoted in the meantime', async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 })
    await expect(approveCreator({ messageId: 7, uid: 21 }, 2)).resolves.toEqual(
      {}
    )
    expect(mocks.updateKunSessions).not.toHaveBeenCalled()
    expect(mocks.tx.admin_log.create.mock.calls[0][0].data.content).toContain(
      '角色未改动'
    )
  })
})

describe('declineCreator', () => {
  it('claims the application, notifies with the reason and never touches roles', async () => {
    await expect(
      declineCreator({ messageId: 7, reason: '资源太少' }, 2)
    ).resolves.toEqual({})
    expect(mocks.tx.user_message.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 7,
        sender_id: 21,
        status: { in: [0, 1] }
      }),
      data: { status: 3 }
    })
    expect(
      mocks.tx.user_message.create.mock.calls[0][0].data.content
    ).toContain('资源太少')
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled()
    expect(mocks.updateKunSessions).not.toHaveBeenCalled()
  })

  it('does nothing on a repeated decline', async () => {
    mocks.tx.user_message.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      declineCreator({ messageId: 7, reason: '资源太少' }, 2)
    ).resolves.toBe('该创作者申请已被处理，请刷新列表')
    expect(mocks.tx.user_message.create).not.toHaveBeenCalled()
    expect(mocks.tx.admin_log.create).not.toHaveBeenCalled()
  })
})

describe('getAdminCreator', () => {
  it.each([
    ['pending', { in: [0, 1] }],
    ['approved', { equals: 2 }],
    ['declined', { equals: 3 }]
  ] as const)('filters %s applications', async (status, expected) => {
    mocks.prisma.user_message.findMany.mockResolvedValue([])
    mocks.prisma.user_message.count.mockResolvedValue(0)
    await getAdminCreator({ page: 1, limit: 30, status })
    expect(
      mocks.prisma.user_message.findMany.mock.calls[0][0].where.status
    ).toEqual(expected)
  })

  it('lists every status for the legacy page', async () => {
    mocks.prisma.user_message.findMany.mockResolvedValue([])
    mocks.prisma.user_message.count.mockResolvedValue(0)
    await getAdminCreator({ page: 1, limit: 30, status: 'all' })
    expect(
      mocks.prisma.user_message.findMany.mock.calls[0][0].where
    ).not.toHaveProperty('status')
  })
})
