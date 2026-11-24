import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  user_message: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn()
  },
  user_conversation: { findFirst: vi.fn().mockResolvedValue(null) },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: database }))
vi.mock('~/app/api/message/notificationQuery', () => ({
  notificationCategorySql: {},
  readNotificationSummary: vi
    .fn()
    .mockResolvedValue({ unread: 84, sequence: '90', categories: {} })
}))
vi.mock('~/lib/accountPreferences/version', () => ({
  readAccountPreferenceVersion: vi.fn().mockResolvedValue(0)
}))

describe('notification reading scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.user_message.findFirst.mockResolvedValue({ id: 1 })
    database.user_message.updateMany.mockResolvedValue({ count: 90 })
    database.$transaction.mockImplementation(async (action) => action(database))
    database.$queryRaw.mockResolvedValue([{ id: 1007 }])
  })

  it('confirms only the exact visible versions, without leaking another recipient or clearing changed content', async () => {
    database.user_message.findMany.mockResolvedValue([
      { id: 1, content_version: 9007199254740993n, status: 0, link: '/help/1' },
      { id: 2, content_version: 2n, status: 0, link: '/help/1' },
      { id: 3, content_version: 1n, status: 1, link: '/help/1' }
    ])
    database.user_message.updateMany.mockResolvedValue({ count: 1 })
    const { readMessage } = await import('~/app/api/message/service')
    const result = await readMessage(1007, {
      items: [
        { id: 1, version: '9007199254740993' },
        { id: 2, version: '1' },
        { id: 3, version: '1' },
        { id: 4, version: '1' }
      ]
    })
    expect(result).toMatchObject({
      results: [
        { id: 1, outcome: 'read' },
        { id: 2, outcome: 'changed' },
        { id: 3, outcome: 'already_read' },
        { id: 4, outcome: 'missing' }
      ],
      summary: { notifications: { unread: 84, sequence: '90' } }
    })
    expect(database.user_message.updateMany).toHaveBeenCalledTimes(1)
    expect(database.user_message.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 1,
        recipient_id: 1007,
        status: 0,
        content_version: 9007199254740993n
      },
      data: { status: 1, updated: undefined }
    })
    expect(
      database.user_message.findMany.mock.calls[0][0].where.recipient_id
    ).toBe(1007)
  })

  it('rejects a mismatched detail target with the same result as an unavailable message', async () => {
    database.user_message.findMany.mockResolvedValue([
      { id: 1, content_version: 1n, status: 0, link: '/help/1' }
    ])
    const { readMessage } = await import('~/app/api/message/service')
    expect(
      await readMessage(1007, {
        items: [{ id: 1, version: '1' }],
        target: '/help/2'
      })
    ).toMatchObject({ results: [{ id: 1, outcome: 'missing' }] })
    expect(database.user_message.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a legacy unscoped read without clearing unseen notifications', async () => {
    const { readMessage } = await import('~/app/api/message/service')
    const result = await readMessage(1007)
    expect(database.user_message.updateMany).not.toHaveBeenCalled()
    expect(result).toMatchObject({ code: 'NOTIFICATION_SCOPE_REQUIRED' })
  })

  it('marks every unread row in an explicit category across pages and leaves later insertions outside the captured ids', async () => {
    database.$queryRaw
      .mockResolvedValueOnce([{ id: 1007 }])
      .mockResolvedValueOnce(
        Array.from({ length: 75 }, (_, index) => ({ id: index + 1 }))
      )
    database.$executeRaw.mockResolvedValueOnce(75)
    const { readAllMessages } = await import('~/app/api/message/service')
    const result = await readAllMessages(1007, { scope: 'help' })
    expect(result).toMatchObject({
      read: 75,
      summary: { hasUnreadConversation: false }
    })
    const selected = database.$queryRaw.mock.calls[1][0]
    expect(selected.sql).toContain('ORDER BY id FOR UPDATE')
    expect(selected.values).toContain(1007)
    expect(selected.values).toContain('help')
    const update = database.$executeRaw.mock.calls[0][0]
    expect(update.sql).toContain('SET status = 1')
    expect(update.sql).not.toContain('updated =')
    expect(update.values).toContain(1007)
    expect(update.values.at(-1)).toEqual(
      Array.from({ length: 75 }, (_, index) => index + 1)
    )
  })

  it('handles an empty explicit all scope without changing messages', async () => {
    database.$queryRaw
      .mockResolvedValueOnce([{ id: 1007 }])
      .mockResolvedValueOnce([])
    const { readAllMessages } = await import('~/app/api/message/service')
    expect(await readAllMessages(1007, { scope: 'all' })).toMatchObject({
      read: 0
    })
    expect(database.$executeRaw).not.toHaveBeenCalled()
  })
})
