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
const createCaseMock = vi.hoisted(() => vi.fn())

vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock
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
