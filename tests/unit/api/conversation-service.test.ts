import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  user_conversation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  user_private_message: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  _tx: {
    user: {
      update: vi.fn(),
      updateMany: vi.fn()
    },
    user_private_message: {
      create: vi.fn()
    },
    user_conversation: {
      create: vi.fn(),
      update: vi.fn()
    }
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn()
}))

const redisMock = vi.hoisted(() => ({
  redis: {
    eval: vi.fn()
  },
  runRedisCommand: vi.fn((command: () => Promise<unknown>) => command()),
  getPrefixedRedisKey: (key: string) => `kun:touchgal:${key}`,
  setKv: vi.fn()
}))

const rateLimitMock = vi.hoisted(() => ({
  checkConversationActionRateLimit: vi.fn()
}))

const s3Mock = vi.hoisted(() => ({
  deleteFileFromS3: vi.fn()
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

vi.mock('~/lib/redis', () => redisMock)
vi.mock('~/lib/s3', () => s3Mock)
vi.mock('~/app/api/message/conversation/rateLimit', () => rateLimitMock)

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
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock._tx))
    prismaMock.user.findUnique.mockResolvedValue({
      id: 8,
      allow_private_message: true
    })
    redisMock.redis.eval.mockResolvedValue(JSON.stringify({ ok: true }))
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
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
        data: expect.objectContaining({
          user_a_hidden: false,
          user_b_hidden: false,
          user_b_unread_count: { increment: 1 }
        })
      })
    )
    expect(result).toMatchObject({ id: 9, replyTo: { messageId: 3 } })
  })

  it('stores the selected reply image snapshot when replying to an image', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 3,
      conversation_id: 5,
      sender_id: 8,
      content: '',
      type: 1,
      is_deleted: false,
      image_url: 'https://img.example/a.webp',
      image_width: 800,
      image_height: 600,
      image_size: 1,
      image_mime: 'image/webp',
      image_name: 'a.webp',
      image_group: [
        {
          url: 'https://img.example/a.webp',
          width: 800,
          height: 600,
          size: 1,
          mime: 'image/webp',
          name: 'a.webp'
        },
        {
          url: 'https://img.example/b.webp',
          width: 900,
          height: 600,
          size: 1,
          mime: 'image/webp',
          name: 'b.webp'
        }
      ],
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
      reply_preview_content: '[图片]',
      reply_preview_sender_name: 'Mio',
      reply_selected_text: null,
      reply_image: {
        url: 'https://img.example/b.webp',
        width: 900,
        height: 600,
        size: 1,
        mime: 'image/webp',
        name: 'b.webp'
      },
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
        replyImageIndex: 1
      },
      1007
    )

    expect(prismaMock._tx.user_private_message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reply_to_message_id: 3,
          reply_preview_content: '[图片]',
          reply_image: {
            url: 'https://img.example/b.webp',
            width: 900,
            height: 600,
            size: 1,
            mime: 'image/webp',
            name: 'b.webp'
          }
        })
      })
    )
    expect(result).toMatchObject({
      id: 9,
      replyTo: {
        messageId: 3,
        image: { url: 'https://img.example/b.webp' }
      }
    })
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

  it('does not consume uploaded image metadata when the reply target is invalid', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue(null)
    const image = {
      url: 'https://img.example/conversation/5/1007-reply.avif',
      width: 800,
      height: 600,
      size: 12345,
      mime: 'image/avif' as const,
      name: 'reply.avif'
    }

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      { type: 1, content: '', image, replyToMessageId: 999 },
      1007
    )

    expect(result).toBe('回复的消息不存在')
    expect(redisMock.redis.eval).not.toHaveBeenCalled()
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

  it('rejects sending when the user exceeds the private chat send rate limit', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '发送过于频繁，请 30 秒后再试',
      retryAfterMs: 30_000
    })

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(5, { type: 0, content: 'spam' }, 1007)

    expect(result).toEqual({
      kind: 'conversation-rate-limit',
      message: '发送过于频繁，请 30 秒后再试',
      retryAfterMs: 30_000
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'send',
      1007
    )
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects sending to an existing conversation when the recipient disallows private messages', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 8,
      allow_private_message: false
    })

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    try {
      const result = await sendMessage(5, { type: 0, content: 'hello' }, 1007)

      expect(result).toBe('对方已关闭接收私信')
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 8 },
        select: { id: true, allow_private_message: true }
      })
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    } finally {
      prismaMock.user.findUnique.mockReset()
    }
  })

  it('sends image message metadata', async () => {
    const image = {
      url: 'https://img.example/conversation/5/1007-chat.avif',
      width: 800,
      height: 600,
      size: 12345,
      mime: 'image/avif' as const,
      name: 'chat.avif'
    }
    prismaMock._tx.user_private_message.create.mockResolvedValue({
      id: 10,
      type: 1,
      content: '',
      status: 0,
      is_deleted: false,
      edited_at: null,
      image_url: image.url,
      image_width: 800,
      image_height: 600,
      image_size: 12345,
      image_mime: 'image/avif',
      image_name: 'chat.avif',
      image_group: [image],
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
        image
      },
      1007
    )

    expect(prismaMock._tx.user_private_message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 1,
          image_url: image.url,
          image_width: 800,
          image_height: 600,
          image_size: 12345,
          image_mime: 'image/avif',
          image_name: 'chat.avif',
          image_group: [image]
        })
      })
    )
    const urlHash = createHash('sha256').update(image.url).digest('hex')
    expect(redisMock.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      `kun:touchgal:conversation:image-upload:5:1007:${urlHash}`,
      JSON.stringify(image)
    )
    expect(result).toMatchObject({
      id: 10,
      type: 1,
      image: { url: image.url },
      images: [{ url: image.url }]
    })
  })

  it('rejects image messages whose metadata was not produced by the private chat upload flow', async () => {
    redisMock.redis.eval.mockResolvedValueOnce(
      JSON.stringify({ ok: false, code: 'missing', index: 1 })
    )

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await sendMessage(
      5,
      {
        type: 1,
        content: '',
        image: {
          url: 'https://img.example/conversation/5/1007-forged.avif',
          width: 800,
          height: 600,
          size: 12345,
          mime: 'image/avif',
          name: 'forged.avif'
        }
      },
      1007
    )

    expect(result).toBe('图片已过期，请重新上传')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('restores consumed image metadata when the message transaction fails', async () => {
    const image = {
      url: 'https://img.example/conversation/5/1007-retry.avif',
      width: 800,
      height: 600,
      size: 12345,
      mime: 'image/avif' as const,
      name: 'retry.avif'
    }
    const error = new Error('database unavailable')
    prismaMock.$transaction.mockRejectedValueOnce(error)

    const { sendMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )

    await expect(
      sendMessage(
        5,
        {
          type: 1,
          content: '',
          image
        },
        1007
      )
    ).rejects.toThrow('database unavailable')

    const urlHash = createHash('sha256').update(image.url).digest('hex')
    expect(redisMock.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      `kun:touchgal:conversation:image-upload:5:1007:${urlHash}`,
      JSON.stringify(image)
    )
    expect(redisMock.setKv).toHaveBeenCalledWith(
      `conversation:image-upload:5:1007:${urlHash}`,
      JSON.stringify(image),
      60 * 60
    )
  })
})

describe('conversation deletion visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.checkConversationActionRateLimit.mockReset()
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a_hidden: false,
      user_b_hidden: false,
      user_a_unread_count: 2,
      user_b_unread_count: 0,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
  })

  it('hides a conversation only for the current user and clears their unread counter', async () => {
    const { deleteConversation } = await import(
      '~/app/api/message/conversation/[id]/service'
    )

    const result = await deleteConversation(5, 1007)

    expect(result).toEqual({})
    expect(prismaMock.user_conversation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        user_a_hidden: true,
        user_a_unread_count: 0
      }
    })
    expect(prismaMock.user_conversation.delete).not.toHaveBeenCalled()
  })

  it('rate limits conversation removal before writing the hidden state', async () => {
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: '私聊管理操作过于频繁，请 15 秒后再试',
      retryAfterMs: 15_000
    })

    const { deleteConversation } = await import(
      '~/app/api/message/conversation/[id]/service'
    )

    const result = await deleteConversation(5, 1007)

    expect(result).toEqual({
      kind: 'conversation-rate-limit',
      message: '私聊管理操作过于频繁，请 15 秒后再试',
      retryAfterMs: 15_000
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-manage',
      1007
    )
    expect(prismaMock.user_conversation.update).not.toHaveBeenCalled()
  })

  it('does not rewrite an already hidden conversation when the current user unread counter is clear', async () => {
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a_hidden: true,
      user_b_hidden: false,
      user_a_unread_count: 0,
      user_b_unread_count: 0,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })

    const { deleteConversation } = await import(
      '~/app/api/message/conversation/[id]/service'
    )

    const result = await deleteConversation(5, 1007)

    expect(result).toEqual({})
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'conversation-manage',
      1007
    )
    expect(prismaMock.user_conversation.update).not.toHaveBeenCalled()
  })

  it('restores the current user visibility when reopening an existing hidden conversation', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ moemoepoint: 100 })
      .mockResolvedValueOnce({ id: 8, allow_private_message: true })
    prismaMock.user_conversation.findUnique.mockResolvedValueOnce({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a_hidden: true,
      user_b_hidden: false
    })

    const { getOrCreateConversation } = await import(
      '~/app/api/message/conversation/service'
    )

    const result = await getOrCreateConversation({ targetUserId: 8 }, 1007, 1)

    expect(result).toEqual({ conversationId: 5, isNew: false })
    expect(prismaMock.user_conversation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { user_a_hidden: false }
    })
  })
})

describe('conversation creation moemoepoint charging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ moemoepoint: 20 })
      .mockResolvedValueOnce({ id: 8, allow_private_message: true })
    prismaMock.user_conversation.findUnique.mockResolvedValue(null)
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock._tx))
    prismaMock._tx.user.update.mockResolvedValue({})
    prismaMock._tx.user_conversation.create.mockResolvedValue({ id: 5 })
  })

  it('uses an atomic moemoepoint decrement and does not create a new conversation when the charge loses a race', async () => {
    prismaMock._tx.user.updateMany.mockResolvedValueOnce({ count: 0 })

    const { getOrCreateConversation } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getOrCreateConversation({ targetUserId: 8 }, 1007, 1)

    expect(result).toBe('萌萌点不足，开启新私聊需要消耗 10 萌萌点')
    expect(prismaMock._tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 1007, moemoepoint: { gte: 10 } },
      data: { moemoepoint: { decrement: 10 } }
    })
    expect(prismaMock._tx.user_conversation.create).not.toHaveBeenCalled()
  })

  it('returns the concurrently created conversation when the unique pair create races', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002'
    })
    prismaMock._tx.user.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock._tx.user_conversation.create.mockRejectedValueOnce(uniqueError)
    prismaMock.user_conversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 5,
        user_a_id: 8,
        user_b_id: 1007,
        user_a_hidden: false,
        user_b_hidden: false
      })

    const { getOrCreateConversation } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getOrCreateConversation({ targetUserId: 8 }, 1007, 1)

    expect(result).toEqual({ conversationId: 5, isNew: false })
    expect(prismaMock.user_conversation.findUnique).toHaveBeenLastCalledWith({
      where: {
        user_a_id_user_b_id: { user_a_id: 8, user_b_id: 1007 }
      }
    })
  })

  it('returns the concurrently created conversation for privileged users when direct create races', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002'
    })
    prismaMock.user.findUnique
      .mockReset()
      .mockResolvedValueOnce({ moemoepoint: 0 })
      .mockResolvedValueOnce({ id: 8, allow_private_message: true })
    prismaMock.user_conversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 5,
        user_a_id: 8,
        user_b_id: 1007,
        user_a_hidden: false,
        user_b_hidden: false
      })
    prismaMock.user_conversation.create.mockRejectedValueOnce(uniqueError)

    const { getOrCreateConversation } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getOrCreateConversation({ targetUserId: 8 }, 1007, 3)

    expect(result).toEqual({ conversationId: 5, isNew: false })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.user_conversation.findUnique).toHaveBeenLastCalledWith({
      where: {
        user_a_id_user_b_id: { user_a_id: 8, user_b_id: 1007 }
      }
    })
  })
})

describe('conversation message write rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.checkConversationActionRateLimit.mockReset()
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: false,
      message: '消息操作过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })
  })

  it('rejects message edits before loading the message row when write operations are rate limited', async () => {
    const { updateMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await updateMessage(
      5,
      { messageId: 12, content: 'updated' },
      1007
    )

    expect(result).toEqual({
      kind: 'conversation-rate-limit',
      message: '消息操作过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-write',
      1007
    )
    expect(prismaMock.user_private_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.update).not.toHaveBeenCalled()
  })

  it('rejects message deletes before loading the message row or cleaning S3 when write operations are rate limited', async () => {
    const { deleteMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await deleteMessage(5, { messageId: 12 }, 1007)

    expect(result).toEqual({
      kind: 'conversation-rate-limit',
      message: '消息操作过于频繁，请 9 秒后再试',
      retryAfterMs: 9_000
    })
    expect(rateLimitMock.checkConversationActionRateLimit).toHaveBeenCalledWith(
      'message-write',
      1007
    )
    expect(prismaMock.user_private_message.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user_private_message.update).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(s3Mock.deleteFileFromS3).not.toHaveBeenCalled()
  })
})

describe('conversation message deletion cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example'
    rateLimitMock.checkConversationActionRateLimit.mockResolvedValue({
      allowed: true
    })
    prismaMock.user_conversation.findUnique.mockResolvedValue({
      id: 5,
      user_a_id: 1007,
      user_b_id: 8,
      user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
      user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' }
    })
    prismaMock.user_private_message.update.mockResolvedValue({
      id: 12,
      is_deleted: true
    })
    prismaMock.$queryRaw.mockResolvedValue([])
  })

  it('deletes unreferenced S3 objects when deleting an own image message', async () => {
    const imageA = {
      url: 'https://img.example/conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif',
      width: 800,
      height: 600,
      size: 123,
      mime: 'image/avif',
      name: 'a.avif'
    }
    const imageB = {
      url: 'https://img.example/conversation/5/1007-1782780000001-123e4567-e89b-12d3-a456-426614174001.avif',
      width: 900,
      height: 600,
      size: 456,
      mime: 'image/avif',
      name: 'b.avif'
    }
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 12,
      conversation_id: 5,
      sender_id: 1007,
      content: '',
      type: 1,
      is_deleted: false,
      image_url: imageA.url,
      image_width: imageA.width,
      image_height: imageA.height,
      image_size: imageA.size,
      image_mime: imageA.mime,
      image_name: imageA.name,
      image_group: [imageA, imageB]
    })

    const { deleteMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await deleteMessage(5, { messageId: 12 }, 1007)

    expect(result).toEqual({})
    expect(prismaMock.user_private_message.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { is_deleted: true }
    })
    expect(prismaMock.$queryRaw).toHaveBeenCalled()
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'
    )
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      'conversation/5/1007-1782780000001-123e4567-e89b-12d3-a456-426614174001.avif'
    )
  })

  it('keeps S3 objects that are still referenced by another active private message', async () => {
    const image = {
      url: 'https://img.example/conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif',
      width: 800,
      height: 600,
      size: 123,
      mime: 'image/avif',
      name: 'a.avif'
    }
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 12,
      conversation_id: 5,
      sender_id: 1007,
      content: '',
      type: 1,
      is_deleted: false,
      image_url: image.url,
      image_width: image.width,
      image_height: image.height,
      image_size: image.size,
      image_mime: image.mime,
      image_name: image.name,
      image_group: [image]
    })
    prismaMock.$queryRaw.mockResolvedValue([
      {
        key: 'conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif'
      }
    ])

    const { deleteMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await deleteMessage(5, { messageId: 12 }, 1007)

    expect(result).toEqual({})
    expect(prismaMock.user_private_message.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { is_deleted: true }
    })
    expect(s3Mock.deleteFileFromS3).not.toHaveBeenCalled()
  })

  it('keeps message deletion successful when S3 cleanup reference checks fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 12,
      conversation_id: 5,
      sender_id: 1007,
      content: '',
      type: 1,
      is_deleted: false,
      image_url:
        'https://img.example/conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif',
      image_width: 800,
      image_height: 600,
      image_size: 123,
      image_mime: 'image/avif',
      image_name: 'a.avif',
      image_group: null
    })
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db unavailable'))

    const { deleteMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )

    await expect(deleteMessage(5, { messageId: 12 }, 1007)).resolves.toEqual(
      {}
    )
    expect(prismaMock.user_private_message.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { is_deleted: true }
    })
    expect(consoleError).toHaveBeenCalledWith(
      '[Conversation] Failed to cleanup private message images',
      expect.objectContaining({ messageId: 12 })
    )
    consoleError.mockRestore()
  })

  it('does not run S3 cleanup again when deleting an already deleted message', async () => {
    prismaMock.user_private_message.findFirst.mockResolvedValue({
      id: 12,
      conversation_id: 5,
      sender_id: 1007,
      content: '',
      type: 1,
      is_deleted: true,
      image_url:
        'https://img.example/conversation/5/1007-1782780000000-123e4567-e89b-12d3-a456-426614174000.avif',
      image_width: 800,
      image_height: 600,
      image_size: 123,
      image_mime: 'image/avif',
      image_name: 'a.avif',
      image_group: null
    })

    const { deleteMessage } = await import(
      '~/app/api/message/conversation/[id]/service'
    )
    const result = await deleteMessage(5, { messageId: 12 }, 1007)

    expect(result).toEqual({})
    expect(prismaMock.user_private_message.update).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(s3Mock.deleteFileFromS3).not.toHaveBeenCalled()
  })
})

describe('conversation list summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('summarizes image-only last messages as image text', async () => {
    prismaMock.user_conversation.findMany.mockResolvedValue([
      {
        id: 5,
        user_a_id: 1007,
        user_b_id: 8,
        user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
        user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' },
        messages: [
          { type: 1, content: '', image_url: 'https://img.example/chat.webp' }
        ],
        last_message_time: new Date('2026-06-30T10:00:00.000Z'),
        user_a_unread_count: 0,
        user_b_unread_count: 2
      }
    ])
    prismaMock.user_conversation.count.mockResolvedValue(1)

    const { getConversations } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getConversations({ page: 1, limit: 30 }, 1007)

    expect(prismaMock.user_conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { user_a_id: 1007, user_a_hidden: false },
            { user_b_id: 1007, user_b_hidden: false }
          ]
        },
        include: expect.objectContaining({
          messages: expect.objectContaining({
            select: {
              type: true,
              content: true,
              image_url: true,
              image_group: true,
              is_deleted: true
            }
          })
        })
      })
    )
    expect(result.conversations[0]).toMatchObject({
      lastMessage: '[图片]',
      unreadCount: 0
    })
  })

  it('summarizes corrupted image-only last messages as unavailable image text', async () => {
    prismaMock.user_conversation.findMany.mockResolvedValue([
      {
        id: 5,
        user_a_id: 1007,
        user_b_id: 8,
        user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
        user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' },
        messages: [
          {
            type: 1,
            content: '',
            image_url: null,
            image_group: [{ url: 'not-a-complete-image' }],
            is_deleted: false
          }
        ],
        last_message_time: new Date('2026-06-30T10:00:00.000Z'),
        user_a_unread_count: 0,
        user_b_unread_count: 0
      }
    ])
    prismaMock.user_conversation.count.mockResolvedValue(1)

    const { getConversations } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getConversations({ page: 1, limit: 30 }, 1007)

    expect(result.conversations[0]).toMatchObject({
      lastMessage: '[图片不可用]'
    })
  })

  it('does not expose deleted last message content in conversation summaries', async () => {
    prismaMock.user_conversation.findMany.mockResolvedValue([
      {
        id: 5,
        user_a_id: 1007,
        user_b_id: 8,
        user_a: { id: 1007, name: 'Saya', avatar: '/saya.webp' },
        user_b: { id: 8, name: 'Mio', avatar: '/mio.webp' },
        messages: [
          {
            type: 0,
            content: 'private text that was deleted',
            image_url: null,
            is_deleted: true
          }
        ],
        last_message_time: new Date('2026-06-30T10:00:00.000Z'),
        user_a_unread_count: 0,
        user_b_unread_count: 0
      }
    ])
    prismaMock.user_conversation.count.mockResolvedValue(1)

    const { getConversations } = await import(
      '~/app/api/message/conversation/service'
    )
    const result = await getConversations({ page: 1, limit: 30 }, 1007)

    expect(prismaMock.user_conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          messages: expect.objectContaining({
            select: {
              type: true,
              content: true,
              image_url: true,
              image_group: true,
              is_deleted: true
            }
          })
        })
      })
    )
    expect(result.conversations[0]).toMatchObject({
      lastMessage: '消息已删除'
    })
  })
})
