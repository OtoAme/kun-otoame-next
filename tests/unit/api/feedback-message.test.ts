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
    update: vi.fn()
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

vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock
}))

import { handleFeedback } from '~/app/api/admin/feedback/service'
import { createFeedback } from '~/app/api/patch/feedback/service'

describe('feedback messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)
    )
  })

  it('keeps the feedback work item as feedback but sends admin notifications as system messages', async () => {
    prismaMock.patch.findUnique.mockResolvedValue({
      id: 10,
      name: '测试游戏',
      unique_id: 'abc12345'
    })
    prismaMock.user.findUnique.mockResolvedValue({
      id: 100,
      name: '提交者'
    })
    prismaMock.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])

    await createFeedback(
      {
        patchId: 10,
        content: '这里是一条足够长的反馈内容'
      },
      100
    )

    const workItem = prismaMock.user_message.create.mock.calls[0][0].data
    expect(workItem).toMatchObject({
      type: 'feedback',
      sender_id: 100,
      link: '/abc12345'
    })
    expect(workItem.recipient_id).toBeUndefined()
    expect(prismaMock.user_message.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ type: 'system', recipient_id: 1 }),
        expect.objectContaining({ type: 'system', recipient_id: 2 })
      ]
    })
  })

  it('sends handled feedback receipts as system messages', async () => {
    prismaMock.user_message.findUnique.mockResolvedValue({
      id: 50,
      type: 'feedback',
      content: '用户反馈\n\n反馈内容',
      status: 0,
      sender_id: 100
    })

    await handleFeedback({
      messageId: 50,
      content: '已处理'
    })

    expect(createMessageMock).toHaveBeenCalledWith({
      type: 'system',
      content: expect.stringContaining('您的反馈已处理'),
      recipient_id: 100,
      link: '/'
    })
  })
})
