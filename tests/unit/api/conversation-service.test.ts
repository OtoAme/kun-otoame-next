import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  user_conversation: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  user_private_message: {
    findFirst: vi.fn(),
    create: vi.fn()
  },
  _tx: {
    user_private_message: {
      create: vi.fn()
    },
    user_conversation: {
      update: vi.fn()
    }
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

describe('conversation message sending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    prismaMock.$transaction.mockImplementation(async (fn) =>
      fn(prismaMock._tx)
    )
  })

  it('sends a text reply with server-generated preview and unread increment', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 3,
      conversation_id: 5,
      sender_id: 8,
      content: 'hello original',
      type: 0,
      is_deleted: false,
      sender: { name: 'Mio' }
    })
    prismaMock._tx.user_private_message.create.mockResolvedValue({
      id: 9,
      type: 0,
      content: 'reply',
      status: 0,
      is_deleted: false,
      edited_at: null,
      image_url: null,
      image_width: null,
      image_height: null,
      image_size: null,
      image_mime: null,
      image_name: null,
      reply_to_message_id: 3,
      reply_preview_content: 'hello',
      reply_preview_sender_name: 'Mio',
      reply_selected_text: 'hello',
      created: new Date('2026-06-30T10:00:00.000Z'),
      sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
    })

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      {
        type: 0,
        content: 'reply',
        replyToMessageId: 3,
        replySelectedText: 'hello'
      },
      1007
    )

    expect(prismaMock._tx.user_private_message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reply_to_message_id: 3,
          reply_preview_content: 'hello',
          reply_preview_sender_name: 'Mio',
          reply_selected_text: 'hello'
        })
      })
    )
    expect(prismaMock._tx.user_conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_b_unread_count: { increment: 1 } })
      })
    )
    expect(result).toMatchObject({ id: 9, replyTo: { messageId: 3 } })
  })

  it('rejects a reply target from another conversation', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue(null)

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      { type: 0, content: 'reply', replyToMessageId: 999 },
      1007
    )

    expect(result).toBe('回复的消息不存在')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects replying to a deleted message', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 3,
      conversation_id: 5,
      sender_id: 8,
      content: 'deleted',
      type: 0,
      is_deleted: true,
      sender: { name: 'Mio' }
    })

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      { type: 0, content: 'reply', replyToMessageId: 3 },
      1007
    )

    expect(result).toBe('无法回复已删除的消息')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('sends image message metadata', async () => {
    prismaMock._tx.user_private_message.create.mockResolvedValue({
      id: 10,
      type: 1,
      content: '',
      status: 0,
      is_deleted: false,
      edited_at: null,
      image_url: 'https://img.example/chat.webp',
      image_width: 800,
      image_height: 600,
      image_size: 12345,
      image_mime: 'image/webp',
      image_name: 'chat.webp',
      reply_to_message_id: null,
      reply_preview_content: null,
      reply_preview_sender_name: null,
      reply_selected_text: null,
      created: new Date('2026-06-30T10:00:00.000Z'),
      sender: { id: 1007, name: 'Saya', avatar: '/saya.webp' }
    })

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      {
        type: 1,
        content: '',
        image: {
          url: 'https://img.example/chat.webp',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/webp',
          name: 'chat.webp'
        }
      },
      1007
    )

    expect(prismaMock._tx.user_private_message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 1,
          image_url: 'https://img.example/chat.webp',
          image_width: 800,
          image_height: 600,
          image_size: 12345,
          image_mime: 'image/webp',
          image_name: 'chat.webp'
        })
      })
    )
    expect(result).toMatchObject({
      id: 10,
      type: 1,
      image: { url: 'https://img.example/chat.webp' }
    })
  })
})
