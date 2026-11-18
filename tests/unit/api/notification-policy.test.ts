import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import type { CreateMessageType } from '~/types/api/message'

vi.mock('~/prisma/index', () => ({ prisma: {} }))

import {
  aggregateNotificationBatch,
  createNotificationBatch
} from '~/app/api/utils/message'

const makeTransaction = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }, { id: 8 }, { id: 9 }]),
  $executeRaw: vi.fn().mockResolvedValue(1),
  notification_subscription: { findMany: vi.fn().mockResolvedValue([]) },
  user_message: {
    createManyAndReturn: vi.fn().mockImplementation(async ({ data }) =>
      data.map((input: CreateMessageType, index: number) => ({
        ...input,
        id: index + 100,
        sender_id: input.sender_id ?? null,
        recipient_id: input.recipient_id ?? null,
        content_version: 1n,
        aggregate_count: 1
      }))
    ),
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi
      .fn()
      .mockImplementation(async ({ data }) => ({ ...data, id: 101 }))
  }
})

const notice = (
  changes: Partial<CreateMessageType> = {}
): CreateMessageType => ({
  type: 'system',
  event_type: 'case-follow',
  content: '合成事项动态',
  recipient_id: 8,
  sender_id: 7,
  link: '/issues/42',
  ...changes
})

describe('shared notification delivery policy', () => {
  let database: ReturnType<typeof makeTransaction>
  let transaction: Prisma.TransactionClient
  beforeEach(() => {
    database = makeTransaction()
    transaction = database as unknown as Prisma.TransactionClient
  })

  it('treats disabled optional delivery as a normal skip while preserving a necessary direct notice', async () => {
    database.notification_subscription.findMany.mockResolvedValue([
      { user_id: 8, event_type: 'case-follow', enabled: false },
      { user_id: 9, event_type: 'case-update', enabled: false }
    ])
    const result = await createNotificationBatch(
      [notice(), notice({ recipient_id: 9, event_type: 'case-update' })],
      transaction
    )
    expect(result.map((item) => item.outcome)).toEqual(['disabled', 'created'])
    expect(
      database.user_message.createManyAndReturn.mock.calls[0][0].data
    ).toHaveLength(1)
    expect(database.notification_subscription.findMany).toHaveBeenCalledTimes(1)
    const sql = database.$executeRaw.mock.calls[0][0]
    expect(sql.values).toContain(9)
    expect(sql.values).not.toContain(8)
  })

  it('propagates a preference lookup failure before creating content or changing sequences', async () => {
    database.notification_subscription.findMany.mockRejectedValue(
      new Error('isolated preference read failed')
    )
    await expect(
      createNotificationBatch([notice()], transaction)
    ).rejects.toThrow('preference read failed')
    expect(database.user_message.createManyAndReturn).not.toHaveBeenCalled()
    expect(database.$executeRaw).not.toHaveBeenCalled()
  })

  it('excludes the actor, removed recipients and unaddressed ordinary notices without advancing content', async () => {
    const result = await createNotificationBatch(
      [
        notice({ recipient_id: 7 }),
        notice({ recipient_id: 500 }),
        notice({ recipient_id: undefined })
      ],
      transaction
    )
    expect(result.map((item) => item.outcome)).toEqual([
      'excluded',
      'excluded',
      'excluded'
    ])
    expect(database.user_message.createManyAndReturn).not.toHaveBeenCalled()
    expect(database.$executeRaw).not.toHaveBeenCalled()
  })

  it('preserves the explicit unaddressed creator application record without a recipient sequence', async () => {
    const result = await createNotificationBatch(
      [
        notice({
          type: 'apply',
          event_type: 'creator-application',
          recipient_id: undefined
        })
      ],
      transaction
    )
    expect(result[0].outcome).toBe('created')
    expect(result[0].message?.recipient_id).toBeNull()
    expect(database.$executeRaw).not.toHaveBeenCalled()
  })

  it('excludes a human operator from a system-styled result while preserving automatic results and sender display', async () => {
    const result = await createNotificationBatch(
      [
        {
          ...notice({ event_type: 'submission-result', sender_id: undefined }),
          actor_id: 8
        },
        {
          ...notice({
            event_type: 'submission-result',
            recipient_id: 9,
            sender_id: undefined
          }),
          actor_id: 8
        },
        notice({ event_type: 'submission-result', sender_id: undefined })
      ],
      transaction
    )
    expect(result.map((item) => item.outcome)).toEqual([
      'excluded',
      'created',
      'created'
    ])
    const rows = database.user_message.createManyAndReturn.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(
      rows.every(
        (row: Record<string, unknown>) => !Object.hasOwn(row, 'actor_id')
      )
    ).toBe(true)
    expect(result[1].message?.sender_id).toBeNull()
    expect(
      database.$executeRaw.mock.calls[0][0].values.filter(
        (value: unknown) => value === 1n
      )
    ).toHaveLength(4)
  })

  it('does not attribute one deduplicated insert to two matching inputs or count the retry', async () => {
    database.user_message.createManyAndReturn.mockImplementationOnce(
      async ({ data }) => [
        {
          ...data[0],
          id: 100,
          sender_id: 7,
          recipient_id: 8
        }
      ]
    )
    const result = await createNotificationBatch(
      [notice(), notice()],
      transaction,
      true
    )
    expect(result.map((item) => item.outcome)).toEqual(['created', 'duplicate'])
    expect(database.$executeRaw).toHaveBeenCalledTimes(1)
    expect(
      database.$executeRaw.mock.calls[0][0].values.filter(
        (value: unknown) => value === 1n
      )
    ).toHaveLength(2)
    database.user_message.createManyAndReturn.mockResolvedValueOnce([])
    expect(
      (await createNotificationBatch([notice()], transaction, true))[0].outcome
    ).toBe('duplicate')
    expect(database.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('creates a new dynamic after a read or cleanup wins the aggregate update', async () => {
    database.user_message.findFirst.mockResolvedValueOnce({
      id: 12,
      content_version: 9007199254740993n,
      aggregate_count: 3,
      recipient_id: 8,
      event_type: 'help-follow-answer',
      type: 'system'
    })
    database.user_message.updateMany.mockResolvedValueOnce({ count: 0 })
    await aggregateNotificationBatch(
      [notice({ event_type: 'help-follow-answer' })],
      (_input, count) => `回答 ${count}`,
      transaction
    )
    expect(
      database.user_message.updateMany.mock.calls[0][0].where
    ).toMatchObject({
      id: 12,
      recipient_id: 8,
      status: 0,
      content_version: 9007199254740993n,
      event_type: 'help-follow-answer',
      link: '/issues/42'
    })
    expect(database.user_message.create.mock.calls[0][0].data.content).toBe(
      '回答 1'
    )
    expect(database.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('bounds aggregate contention and leaves the caller transaction responsible for rollback', async () => {
    database.user_message.findFirst.mockResolvedValue({
      id: 12,
      content_version: 1n,
      aggregate_count: 1
    })
    database.user_message.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      aggregateNotificationBatch([notice()], () => '新回答', transaction)
    ).rejects.toThrow('retry the business operation')
    expect(database.user_message.updateMany).toHaveBeenCalledTimes(3)
    expect(database.$executeRaw).not.toHaveBeenCalled()
  })
})
