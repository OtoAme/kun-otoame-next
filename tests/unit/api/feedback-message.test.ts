import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  patch: {
    findUnique: vi.fn()
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  user_message: {
    create: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  $transaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn(prismaMock))
}))

vi.mock('~/prisma', () => ({
  prisma: prismaMock
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

const createMessageMock = vi.hoisted(() => vi.fn())
const createCaseMock = vi.hoisted(() => vi.fn())

vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock,
  lockNotificationAccounts: vi.fn(async () => new Set([7, 100]))
}))
vi.mock('~/app/api/case/service', () => ({
  createCase: createCaseMock
}))

import { handleFeedback } from '~/app/api/admin/feedback/service'
import { createFeedback } from '~/app/api/patch/feedback/service'

describe('feedback messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)
    )
    createCaseMock.mockResolvedValue({ case: { id: 20 } })
    prismaMock.user_message.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.user_message.findUniqueOrThrow.mockImplementation(() =>
      prismaMock.user_message.findUnique()
    )
  })

  it('writes feedback into an other case while keeping the old endpoint contract', async () => {
    await createFeedback(
      {
        patchId: 10,
        content: '这里是一条足够长的反馈内容'
      },
      100
    )
    expect(createCaseMock).toHaveBeenCalledWith(
      {
        kind: 'other',
        targetType: 'patch',
        targetId: 10,
        content: '这里是一条足够长的反馈内容'
      },
      100
    )
    expect(prismaMock.user_message.create).not.toHaveBeenCalled()
    expect(prismaMock.user_message.createMany).not.toHaveBeenCalled()
  })

  it('sends handled feedback receipts as system messages', async () => {
    prismaMock.user_message.findUnique.mockResolvedValue({
      id: 50,
      type: 'feedback',
      content: '用户反馈\n\n反馈内容',
      status: 0,
      sender_id: 100,
      recipient_id: null
    })

    await handleFeedback(
      {
        messageId: 50,
        content: '已处理'
      },
      7
    )

    expect(createMessageMock).toHaveBeenCalledWith(
      {
        event_type: 'feedback-result',
        actor_id: 7,
        type: 'system',
        content: expect.stringContaining('您的反馈已处理'),
        recipient_id: 100,
        link: '/'
      },
      prismaMock
    )
    expect(prismaMock.user_message.updateMany).toHaveBeenCalledWith({
      where: {
        id: 50,
        type: 'feedback',
        recipient_id: null,
        sender_id: 100,
        status: 0
      },
      data: { status: 1 }
    })
  })

  it.each([
    null,
    { id: 50, type: 'system', recipient_id: 8, sender_id: 100, status: 0 },
    { id: 50, type: 'feedback', recipient_id: 8, sender_id: 100, status: 0 },
    { id: 50, type: 'apply', recipient_id: null, sender_id: 100, status: 0 },
    { id: 50, type: 'feedback', recipient_id: null, sender_id: null, status: 0 }
  ])(
    'rejects missing or ordinary notification records without writes',
    async (record) => {
      prismaMock.user_message.findUnique.mockResolvedValue(record)
      expect(await handleFeedback({ messageId: 50, content: '' }, 7)).toBe(
        '未找到该反馈'
      )
      expect(prismaMock.user_message.update).not.toHaveBeenCalled()
      expect(prismaMock.user_message.updateMany).not.toHaveBeenCalled()
      expect(createMessageMock).not.toHaveBeenCalled()
    }
  )

  it('does not generate a second result after losing a concurrent processing claim', async () => {
    prismaMock.user_message.findUnique.mockResolvedValue({
      id: 50,
      type: 'feedback',
      recipient_id: null,
      sender_id: 100,
      status: 0,
      content: '合成反馈'
    })
    prismaMock.user_message.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await handleFeedback({ messageId: 50, content: '' }, 7)).toBe(
      '该反馈已被处理'
    )
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('reads feedback and the current claimed body in the processing transaction', async () => {
    let active = false
    const observations: boolean[] = []
    prismaMock.$transaction.mockImplementation(async (callback) => {
      active = true
      try {
        return await callback(prismaMock)
      } finally {
        active = false
      }
    })
    prismaMock.user_message.findUnique.mockImplementation(async () => {
      observations.push(active)
      return {
        id: 50,
        type: 'feedback',
        recipient_id: null,
        sender_id: 100,
        status: 0,
        content: '事务内合成反馈'
      }
    })
    await handleFeedback({ messageId: 50, content: '' }, 7)
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every(Boolean)).toBe(true)
  })
})
