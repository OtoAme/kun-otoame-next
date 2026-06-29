import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  user_conversation: {
    findUnique: vi.fn(),
    create: vi.fn()
  },
  $transaction: vi.fn()
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

describe('conversation service permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ moemoepoint: 100 })
      .mockResolvedValueOnce({
        id: 8,
        name: 'Mio',
        allow_private_message: false
      })
    prismaMock.user_conversation.findUnique.mockResolvedValue(null)
  })

  it('does not offer a new conversation when the target user disallows private messages', async () => {
    const { checkConversation } = await import(
      '~/app/api/message/conversation/service'
    )

    const result = await checkConversation({ targetUserId: 8 }, 1007, 1)

    expect(result).toEqual({ error: '对方已关闭接收私信' })
    expect(prismaMock.user_conversation.findUnique).not.toHaveBeenCalled()
  })

  it('does not create a new conversation when the target user disallows private messages', async () => {
    const { getOrCreateConversation } = await import(
      '~/app/api/message/conversation/service'
    )

    const result = await getOrCreateConversation({ targetUserId: 8 }, 1007, 1)

    expect(result).toBe('对方已关闭接收私信')
    expect(prismaMock.user_conversation.create).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
