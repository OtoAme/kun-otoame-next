import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  message: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn()
  },
  transaction: vi.fn(),
  lock: vi.fn(),
  user: { findUnique: vi.fn() },
  rateLimit: vi.fn()
}))

vi.mock('~/prisma/index', () => ({
  prisma: {
    user_conversation: mocks.conversation,
    user_private_message: mocks.message,
    user: mocks.user,
    $transaction: mocks.transaction
  }
}))
vi.mock('~/lib/s3', () => ({
  deleteFileFromS3: vi.fn(),
  getS3PublicUrl: () => null
}))
vi.mock('~/app/api/message/conversation/rateLimit', () => ({
  checkConversationActionRateLimit: mocks.rateLimit
}))

const conversation = {
  id: 5,
  user_a_id: 1,
  user_b_id: 2,
  user_a_unread_count: 0,
  user_b_unread_count: 7,
  user_a_hidden: false,
  user_b_hidden: false,
  user_a: { id: 1, name: 'One', avatar: '' },
  user_b: { id: 2, name: 'Two', avatar: '' }
}
const message = (id: number) => ({
  id,
  conversation_id: 5,
  sender_id: 2,
  type: 0,
  content: `message ${id}`,
  status: 0,
  is_deleted: false,
  edited_at: null,
  created: new Date(1_000_000 - id),
  sender: conversation.user_b
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.conversation.findUnique.mockResolvedValue(conversation)
  mocks.lock.mockResolvedValue([conversation])
  mocks.message.findMany.mockResolvedValue([])
  mocks.message.findFirst.mockResolvedValue({ id: 121 })
  mocks.message.count.mockResolvedValue(120)
  mocks.message.updateMany.mockResolvedValue({ count: 80 })
  mocks.user.findUnique.mockResolvedValue({
    id: 2,
    allow_private_message: true
  })
  mocks.rateLimit.mockResolvedValue({ allowed: true })
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.lock,
      user_conversation: mocks.conversation,
      user_private_message: mocks.message
    })
  )
})

describe('private chat synchronization protocol', () => {
  it('uses message numbers for the first page despite reverse creation times', async () => {
    mocks.message.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => message(121 - index))
    )
    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(5, { page: 1, limit: 50 }, 1)
    expect(result).toMatchObject({
      oldestId: 72,
      latestId: 121,
      hasMoreBefore: true,
      hasMoreAfter: false,
      messages: Array.from({ length: 50 }, (_, index) =>
        expect.objectContaining({ id: 72 + index })
      )
    })
    expect(mocks.message.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { id: 'desc' },
      take: 51
    })
    expect(mocks.message.updateMany).not.toHaveBeenCalled()
  })

  it('returns a bounded ascending next batch and keeps review separate from its boundary', async () => {
    mocks.message.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 51 }, (_, index) => message(20 + index * 2))
      )
      .mockResolvedValueOnce([message(4)])
    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 50, afterId: 18, reviewIds: [4] },
      1
    )
    expect(result).toMatchObject({
      oldestId: 20,
      latestId: 118,
      hasMoreAfter: true,
      reviewMessages: [expect.objectContaining({ id: 4 })],
      unavailableIds: []
    })
    expect(mocks.message.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { id: 'asc' },
      take: 51
    })
    expect(mocks.message.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a review target in another conversation', async () => {
    mocks.message.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...message(4), conversation_id: 6 }])
    const { getConversationMessages } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await getConversationMessages(
      5,
      { page: 1, limit: 50, afterId: 0, reviewIds: [4] },
      1
    )
    expect(result).toMatchObject({ kind: 'conversation-error', status: 400 })
  })

  it('accepts empty-conversation cursors and rejects more than 100 unique review targets', async () => {
    const { getConversationMessagesSchema } = await import(
      '~/validations/conversation'
    )
    expect(
      getConversationMessagesSchema.safeParse({
        page: 1,
        limit: 50,
        afterId: 0,
        reviewIds: '1,1,3'
      })
    ).toMatchObject({
      success: true,
      data: { afterId: 0, reviewIds: [1, 3] }
    })
    expect(
      getConversationMessagesSchema.safeParse({
        page: 1,
        limit: 50,
        reviewIds: Array.from({ length: 101 }, (_, index) => index + 1).join(
          ','
        )
      }).success
    ).toBe(false)
  })

  it('confirms stale unread message states even when the count is already zero', async () => {
    const { markConversationAsRead } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    expect(await markConversationAsRead(5, 1)).toMatchObject({
      readThroughId: 121
    })
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.message.updateMany.mock.invocationCallOrder[0]
    )
    expect(mocks.message.updateMany).toHaveBeenCalledWith({
      where: { conversation_id: 5, sender_id: 2, status: 0 },
      data: { status: 1 }
    })
    expect(mocks.conversation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { user_a_unread_count: 0 }
    })
  })

  it('locks the conversation before creating a message number', async () => {
    mocks.message.create.mockResolvedValue({
      ...message(122),
      sender: conversation.user_a
    })
    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    await sendMessage(5, { type: 0, content: 'hello' }, 1)
    expect(mocks.lock).toHaveBeenCalledOnce()
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.message.create.mock.invocationCallOrder[0]
    )
  })
})
