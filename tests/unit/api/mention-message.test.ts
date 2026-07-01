import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn()
  },
  user_message: {
    createMany: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMock
}))

describe('mention message anti-abuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates mentions, skips self, and ignores missing users before creating notifications', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 2 }, { id: 3 }])

    const { createMentionMessage } = await import(
      '~/app/api/utils/createMentionMessage'
    )

    await createMentionMessage(
      'abcd1234',
      '测试作品',
      55,
      1,
      'Alice',
      [
        '[@Bob](/user/2/resource)',
        '[@Bob again](/user/2/resource)',
        '[@Self](/user/1/resource)',
        '[@Missing](/user/999/resource)',
        '[@Carol](/user/3/resource)'
      ].join(' ')
    )

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [2, 999, 3] } },
      select: { id: true }
    })
    expect(prismaMock.user_message.createMany).toHaveBeenCalledTimes(1)
    const data = prismaMock.user_message.createMany.mock.calls[0][0].data
    expect(data.map((item: { recipient_id: number }) => item.recipient_id)).toEqual([
      2, 3
    ])
  })

  it('caps mention notifications per comment', async () => {
    const mentions = Array.from(
      { length: 25 },
      (_, index) => `[@User${index + 2}](/user/${index + 2}/resource)`
    ).join(' ')
    prismaMock.user.findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, index) => ({ id: index + 2 }))
    )

    const { createMentionMessage } = await import(
      '~/app/api/utils/createMentionMessage'
    )

    await createMentionMessage('abcd1234', '测试作品', 55, 1, 'Alice', mentions)

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: Array.from({ length: 20 }, (_, index) => index + 2) } },
      select: { id: true }
    })
    expect(prismaMock.user_message.createMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.user_message.createMany.mock.calls[0][0].data).toHaveLength(
      20
    )
  })

  it('does not create mention notifications when no valid recipients remain', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([])

    const { createMentionMessage } = await import(
      '~/app/api/utils/createMentionMessage'
    )

    await createMentionMessage(
      'abcd1234',
      '测试作品',
      55,
      1,
      'Alice',
      '[@Self](/user/1/resource) [@Missing](/user/999/resource)'
    )

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [999] } },
      select: { id: true }
    })
    expect(prismaMock.user_message.createMany).not.toHaveBeenCalled()
  })
})
