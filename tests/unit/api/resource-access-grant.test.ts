import { createHmac } from 'crypto'
import { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_resource_access_grant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    patch_resource_access: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn()
    }
  }

  return {
    $transaction: vi.fn(),
    tx
  }
})

const redisMocks = vi.hoisted(() => ({
  eval: vi.fn()
}))

const timerMocks = vi.hoisted(() => ({
  wait: vi.fn()
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

vi.mock('~/lib/redis', () => ({
  getPrefixedRedisKey: (key: string) => `kun:touchgal:${key}`,
  redis: redisMocks,
  runRedisCommand: <T>(command: () => Promise<T>) => command()
}))

vi.mock('node:timers/promises', () => ({
  setTimeout: timerMocks.wait
}))

import {
  getResourceAccessActor,
  getResourceAccessActorKey,
  getResourceAccessActorWhere,
  getResourceAccessIpHash,
  getResourceAccessViewerKey,
  getResourceAccessViewerWhere
} from '~/app/api/patch/resource/download/access/actor'
import {
  resolveResourceAccessGrant,
  ResourceAccessGrantBusyError
} from '~/app/api/patch/resource/download/access/grant'

const visitorToken = '123e4567-e89b-42d3-a456-426614174000'
const visitorActor = {
  actorType: 'visitor' as const,
  uid: 0 as const,
  visitorToken,
  ipHash: '',
  shouldSetVisitorCookie: false as const
}
const userActor = {
  actorType: 'user' as const,
  uid: 1007,
  visitorToken: '' as const,
  ipHash: '',
  shouldSetVisitorCookie: false as const
}

const baseInput = {
  actor: visitorActor,
  patchId: 7,
  resourceId: 11,
  linkId: 22,
  storage: 'user',
  section: 'galgame' as const,
  now: new Date('2026-07-10T02:00:00.000Z')
}

type TransactionCallback = (tx: typeof prismaMocks.tx) => Promise<unknown>

const createKnownRequestError = (code: 'P2002' | 'P2034') =>
  new Prisma.PrismaClientKnownRequestError(`test ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client
  })

const createDriverAdapterWriteConflictError = () =>
  Object.assign(new Error('test adapter write conflict'), {
    name: 'DriverAdapterError',
    cause: {
      kind: 'TransactionWriteConflict',
      originalCode: '40001',
      originalMessage: 'test adapter write conflict'
    }
  })

const rejectFirstTransactionAfterCallback = (code: 'P2002' | 'P2034') => {
  let attempt = 0
  prismaMocks.$transaction.mockImplementation(
    async (callback: TransactionCallback) => {
      const result = await callback(prismaMocks.tx)
      attempt += 1
      if (attempt === 1) {
        throw createKnownRequestError(code)
      }
      return result
    }
  )
}

const originalJwtSecret = process.env.JWT_SECRET

beforeEach(() => {
  redisMocks.eval.mockReset()
  timerMocks.wait.mockReset().mockResolvedValue(undefined)
  prismaMocks.$transaction.mockReset()
  prismaMocks.tx.patch_resource_access_grant.findUnique.mockReset()
  prismaMocks.tx.patch_resource_access_grant.create.mockReset()
  prismaMocks.tx.patch_resource_access_grant.update.mockReset()
  prismaMocks.tx.patch_resource_access.count.mockReset()
  prismaMocks.tx.patch_resource_access.findFirst.mockReset()
  prismaMocks.tx.patch_resource_access.create.mockReset()

  prismaMocks.$transaction.mockImplementation(
    async (callback: TransactionCallback) => callback(prismaMocks.tx)
  )
  prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue(null)
  prismaMocks.tx.patch_resource_access_grant.create.mockImplementation(
    async ({
      data
    }: {
      data: { actor_key: string; resource_id: number; expires: Date }
    }) => data
  )
  prismaMocks.tx.patch_resource_access_grant.update.mockImplementation(
    async ({ data }: { data: { expires: Date } }) => ({
      actor_key: `visitor:${visitorToken}`,
      resource_id: baseInput.resourceId,
      expires: data.expires
    })
  )
  prismaMocks.tx.patch_resource_access.count.mockResolvedValue(0)
  prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValue(null)
  prismaMocks.tx.patch_resource_access.create.mockResolvedValue({ id: 1 })
})

afterEach(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = originalJwtSecret
  }
})

describe('resource access actor identity helpers', () => {
  it('uses the same canonical keys and where clauses for actors and viewers', () => {
    expect(getResourceAccessActorKey(userActor)).toBe('user:1007')
    expect(getResourceAccessActorKey(visitorActor)).toBe(
      `visitor:${visitorToken}`
    )
    expect(getResourceAccessViewerKey({ uid: 1007 })).toBe('user:1007')
    expect(getResourceAccessViewerKey({ uid: 0, visitorToken })).toBe(
      `visitor:${visitorToken}`
    )
    expect(getResourceAccessViewerKey({ uid: 0 })).toBeNull()

    expect(getResourceAccessActorWhere(userActor)).toEqual({
      actor_type: 'user',
      user_id: 1007
    })
    expect(getResourceAccessActorWhere(visitorActor)).toEqual({
      actor_type: 'visitor',
      visitor_token: visitorToken
    })
    expect(getResourceAccessViewerWhere({ uid: 1007 })).toEqual({
      actor_type: 'user',
      user_id: 1007
    })
    expect(getResourceAccessViewerWhere({ uid: 0, visitorToken })).toEqual({
      actor_type: 'visitor',
      visitor_token: visitorToken
    })
    expect(getResourceAccessViewerWhere({ uid: 0 })).toBeNull()
  })

  it('hashes the forwarded IP only for a first-time visitor', () => {
    process.env.JWT_SECRET = 'resource-access-test-secret'
    const rawIp = '203.0.113.42'
    const headers = new Headers({ 'x-forwarded-for': `${rawIp}, 10.0.0.1` })
    const request = new NextRequest('https://www.otoame.top/resource', {
      headers
    })
    const expectedHash = createHmac('sha256', 'resource-access-test-secret')
      .update(`resource-access:${rawIp}`)
      .digest('hex')

    const actor = getResourceAccessActor(request, 0)

    expect(getResourceAccessIpHash(request)).toBe(expectedHash)
    expect(actor).toMatchObject({
      actorType: 'visitor',
      uid: 0,
      ipHash: expectedHash,
      shouldSetVisitorCookie: true
    })
    expect(actor.ipHash).not.toBe(rawIp)
  })

  it('does not hash an IP when a visitor already has a valid cookie', () => {
    process.env.JWT_SECRET = 'resource-access-test-secret'
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.42',
      cookie: `kun-resource-access-token=${visitorToken}`
    })
    const actor = getResourceAccessActor(
      new NextRequest('https://www.otoame.top/resource', { headers }),
      0
    )

    expect(actor).toEqual(visitorActor)
  })

  it('does not hash an IP for a logged-in user', () => {
    process.env.JWT_SECRET = 'resource-access-test-secret'
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.42' })
    const actor = getResourceAccessActor(
      new NextRequest('https://www.otoame.top/resource', { headers }),
      1007
    )

    expect(actor).toEqual(userActor)
  })

  it('leaves the first-time visitor IP hash empty without JWT_SECRET', () => {
    delete process.env.JWT_SECRET
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.42' })
    const actor = getResourceAccessActor(
      new NextRequest('https://www.otoame.top/resource', { headers }),
      0
    )

    expect(
      getResourceAccessIpHash(
        new NextRequest('https://www.otoame.top/resource', { headers })
      )
    ).toBe('')
    expect(actor).toMatchObject({
      actorType: 'visitor',
      ipHash: '',
      shouldSetVisitorCookie: true
    })
  })
})

describe('resource access grant service', () => {
  it('does not call Redis while evaluating the product quota for a new visitor grant', async () => {
    await resolveResourceAccessGrant({
      actor: visitorActor,
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      storage: 'user',
      section: 'galgame',
      now: new Date('2026-07-10T00:00:00.000Z')
    })

    expect(redisMocks.eval).not.toHaveBeenCalled()
  })

  it('creates a 24-hour resource grant and consumes the last daily and weekly slots', async () => {
    const now = baseInput.now
    const expires = new Date('2026-07-11T02:00:00.000Z')
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(19)

    const result = await resolveResourceAccessGrant(baseInput)

    expect(result).toEqual({
      kind: 'resource_granted',
      expires,
      quota: {
        scope: 'visitor',
        resourceKind: 'galgame',
        remaining: { daily: 0, weekly: 0 },
        resetsAt: {
          daily: '2026-07-10T16:00:00.000Z',
          weekly: '2026-07-12T16:00:00.000Z'
        }
      }
    })
    expect(prismaMocks.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
    expect(prismaMocks.tx.patch_resource_access.count).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          actor_type: 'visitor',
          visitor_token: visitorToken,
          section: 'galgame',
          access_kind: 'resource_grant',
          created: { gte: new Date('2026-07-09T16:00:00.000Z') }
        }
      }
    )
    expect(prismaMocks.tx.patch_resource_access.count).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          actor_type: 'visitor',
          visitor_token: visitorToken,
          section: 'galgame',
          access_kind: 'resource_grant',
          created: { gte: new Date('2026-07-05T16:00:00.000Z') }
        }
      }
    )
    expect(
      prismaMocks.tx.patch_resource_access_grant.create
    ).toHaveBeenCalledWith({
      data: {
        actor_key: `visitor:${visitorToken}`,
        resource_id: 11,
        expires
      }
    })
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: {
        actor_type: 'visitor',
        user_id: null,
        visitor_token: visitorToken,
        patch_id: 7,
        resource_id: 11,
        link_id: 22,
        section: 'galgame',
        storage: 'user',
        cost: 0,
        created: now,
        access_kind: 'resource_grant',
        expires
      }
    })
  })

  it('records the first reveal of another mirror without product quota', async () => {
    const expires = new Date('2026-07-11T00:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires
    })

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      now: new Date('2026-07-10T00:00:00.000Z')
    })

    expect(result).toEqual({ kind: 'link_revealed', expires })
    expect(prismaMocks.tx.patch_resource_access.count).not.toHaveBeenCalled()
    expect(prismaMocks.tx.patch_resource_access.findFirst).toHaveBeenCalledWith(
      {
        where: {
          actor_type: 'visitor',
          visitor_token: visitorToken,
          resource_id: 11,
          link_id: 22,
          expires: { gte: expires }
        },
        select: { id: true }
      }
    )
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link_id: 22,
        access_kind: 'link_reveal',
        expires
      })
    })
    expect(
      prismaMocks.tx.patch_resource_access_grant.update
    ).not.toHaveBeenCalled()
  })

  it('reuses an already revealed mirror without another write', async () => {
    const expires = new Date('2026-07-11T00:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires
    })
    prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValue({ id: 31 })

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      now: new Date('2026-07-10T00:00:00.000Z')
    })

    expect(result).toEqual({ kind: 'reused', expires })
    expect(prismaMocks.tx.patch_resource_access.create).not.toHaveBeenCalled()
    expect(prismaMocks.tx.patch_resource_access.count).not.toHaveBeenCalled()
  })

  it('repairs a legacy reveal whose expiry does not cover the current grant', async () => {
    const expires = new Date('2026-07-11T00:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires
    })
    prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValue(null)

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      now: new Date('2026-07-10T00:00:00.000Z')
    })

    expect(result).toEqual({ kind: 'link_revealed', expires })
    expect(prismaMocks.tx.patch_resource_access.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expires: { gte: expires } })
      })
    )
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        access_kind: 'link_reveal',
        expires
      })
    })
  })

  it('blocks a sixth visitor resource grant on the same Shanghai day', async () => {
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      resourceId: 12,
      linkId: 23
    })

    expect(result).toEqual({
      kind: 'limited',
      window: 'daily',
      retryAfterSeconds: 50400,
      remaining: { daily: 0, weekly: 15 },
      resetsAt: {
        daily: '2026-07-10T16:00:00.000Z',
        weekly: '2026-07-12T16:00:00.000Z'
      }
    })
    expect(
      prismaMocks.tx.patch_resource_access_grant.create
    ).not.toHaveBeenCalled()
    expect(prismaMocks.tx.patch_resource_access.create).not.toHaveBeenCalled()
  })

  it('blocks the twenty-first visitor resource grant in the Shanghai week', async () => {
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(20)

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      resourceId: 12,
      linkId: 23
    })

    expect(result).toMatchObject({
      kind: 'limited',
      window: 'weekly',
      retryAfterSeconds: 223200,
      remaining: { daily: 1, weekly: 0 }
    })
    expect(
      prismaMocks.tx.patch_resource_access_grant.create
    ).not.toHaveBeenCalled()
    expect(prismaMocks.tx.patch_resource_access.create).not.toHaveBeenCalled()
  })

  it('reports the daily limit first when both visitor windows are full', async () => {
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(20)

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      resourceId: 12,
      linkId: 23
    })

    expect(result).toMatchObject({
      kind: 'limited',
      window: 'daily',
      remaining: { daily: 0, weekly: 0 }
    })
  })

  it.each([
    {
      name: 'logged-in game resource',
      actor: userActor,
      section: 'galgame' as const
    },
    {
      name: 'visitor patch resource',
      actor: visitorActor,
      section: 'patch' as const
    }
  ])(
    'grants a $name without product count or quota',
    async ({ actor, section }) => {
      const result = await resolveResourceAccessGrant({
        ...baseInput,
        actor,
        section
      })

      expect(result).toMatchObject({ kind: 'resource_granted' })
      expect(result).not.toHaveProperty('quota')
      expect(prismaMocks.tx.patch_resource_access.count).not.toHaveBeenCalled()
    }
  )

  it('updates an expired grant and records a new resource grant event', async () => {
    const now = new Date('2026-07-10T02:00:00.000Z')
    const expires = new Date('2026-07-11T02:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires: new Date('2026-07-10T01:59:59.999Z')
    })

    const result = await resolveResourceAccessGrant({ ...baseInput, now })

    expect(result).toMatchObject({ kind: 'resource_granted', expires })
    expect(
      prismaMocks.tx.patch_resource_access_grant.update
    ).toHaveBeenCalledWith({
      where: {
        actor_key_resource_id: {
          actor_key: `visitor:${visitorToken}`,
          resource_id: 11
        }
      },
      data: { expires }
    })
    expect(
      prismaMocks.tx.patch_resource_access_grant.create
    ).not.toHaveBeenCalled()
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        access_kind: 'resource_grant',
        expires
      })
    })
  })

  it('retries an active same-mirror reveal conflict and then reuses it', async () => {
    const expires = new Date('2026-07-11T00:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires
    })
    prismaMocks.tx.patch_resource_access.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 31 })
    rejectFirstTransactionAfterCallback('P2034')

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      now: new Date('2026-07-10T00:00:00.000Z')
    })

    expect(result).toEqual({ kind: 'reused', expires })
    expect(
      prismaMocks.tx.patch_resource_access_grant.findUnique
    ).toHaveBeenCalledTimes(2)
    expect(
      prismaMocks.tx.patch_resource_access.findFirst
    ).toHaveBeenCalledTimes(2)
  })

  it('allows active concurrent reveals of different mirrors without extending expiry', async () => {
    const expires = new Date('2026-07-11T00:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique.mockResolvedValue({
      actor_key: `visitor:${visitorToken}`,
      resource_id: 11,
      expires
    })

    const [first, second] = await Promise.all([
      resolveResourceAccessGrant({
        ...baseInput,
        linkId: 22,
        now: new Date('2026-07-10T00:00:00.000Z')
      }),
      resolveResourceAccessGrant({
        ...baseInput,
        linkId: 23,
        now: new Date('2026-07-10T12:00:00.000Z')
      })
    ])

    expect(first).toEqual({ kind: 'link_revealed', expires })
    expect(second).toEqual({ kind: 'link_revealed', expires })
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link_id: 22,
        access_kind: 'link_reveal',
        expires
      })
    })
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link_id: 23,
        access_kind: 'link_reveal',
        expires
      })
    })
    expect(prismaMocks.tx.patch_resource_access.count).not.toHaveBeenCalled()
  })

  it('retries a new same-resource same-mirror race and returns reused', async () => {
    const expires = new Date('2026-07-11T02:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        actor_key: `visitor:${visitorToken}`,
        resource_id: 11,
        expires
      })
    prismaMocks.tx.patch_resource_access_grant.create.mockRejectedValueOnce(
      createKnownRequestError('P2002')
    )
    prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValueOnce({
      id: 31
    })

    const result = await resolveResourceAccessGrant(baseInput)

    expect(result).toEqual({ kind: 'reused', expires })
    expect(
      prismaMocks.tx.patch_resource_access_grant.findUnique
    ).toHaveBeenCalledTimes(2)
  })

  it('retries a new same-resource different-mirror race and reveals its mirror', async () => {
    const expires = new Date('2026-07-11T02:00:00.000Z')
    prismaMocks.tx.patch_resource_access_grant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        actor_key: `visitor:${visitorToken}`,
        resource_id: 11,
        expires
      })
    prismaMocks.tx.patch_resource_access_grant.create.mockRejectedValueOnce(
      createKnownRequestError('P2002')
    )
    prismaMocks.tx.patch_resource_access.findFirst.mockResolvedValueOnce(null)

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      linkId: 23
    })

    expect(result).toEqual({ kind: 'link_revealed', expires })
    expect(prismaMocks.tx.patch_resource_access.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link_id: 23,
        access_kind: 'link_reveal',
        expires
      })
    })
  })

  it('restarts a daily-boundary transaction and limits the losing resource', async () => {
    prismaMocks.tx.patch_resource_access_grant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(11)
    let writesAfterConflict:
      | { grantCreates: number; eventCreates: number }
      | undefined
    let attempt = 0
    prismaMocks.$transaction.mockImplementation(
      async (callback: TransactionCallback) => {
        const result = await callback(prismaMocks.tx)
        attempt += 1
        if (attempt === 1) {
          writesAfterConflict = {
            grantCreates:
              prismaMocks.tx.patch_resource_access_grant.create.mock.calls
                .length,
            eventCreates:
              prismaMocks.tx.patch_resource_access.create.mock.calls.length
          }
          throw createKnownRequestError('P2034')
        }
        return result
      }
    )

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      resourceId: 12,
      linkId: 23
    })

    expect(result).toMatchObject({
      kind: 'limited',
      window: 'daily',
      remaining: { daily: 0, weekly: 9 }
    })
    expect(prismaMocks.tx.patch_resource_access.count).toHaveBeenCalledTimes(4)
    expect(writesAfterConflict).toEqual({
      grantCreates:
        prismaMocks.tx.patch_resource_access_grant.create.mock.calls.length,
      eventCreates:
        prismaMocks.tx.patch_resource_access.create.mock.calls.length
    })
  })

  it('restarts a weekly-boundary transaction and limits the losing resource', async () => {
    prismaMocks.tx.patch_resource_access_grant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    prismaMocks.tx.patch_resource_access.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(19)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(20)
    let writesAfterConflict:
      | { grantCreates: number; eventCreates: number }
      | undefined
    let attempt = 0
    prismaMocks.$transaction.mockImplementation(
      async (callback: TransactionCallback) => {
        const result = await callback(prismaMocks.tx)
        attempt += 1
        if (attempt === 1) {
          writesAfterConflict = {
            grantCreates:
              prismaMocks.tx.patch_resource_access_grant.create.mock.calls
                .length,
            eventCreates:
              prismaMocks.tx.patch_resource_access.create.mock.calls.length
          }
          throw createKnownRequestError('P2034')
        }
        return result
      }
    )

    const result = await resolveResourceAccessGrant({
      ...baseInput,
      resourceId: 12,
      linkId: 23
    })

    expect(result).toMatchObject({
      kind: 'limited',
      window: 'weekly',
      remaining: { daily: 2, weekly: 0 }
    })
    expect(prismaMocks.tx.patch_resource_access.count).toHaveBeenCalledTimes(4)
    expect(writesAfterConflict).toEqual({
      grantCreates:
        prismaMocks.tx.patch_resource_access_grant.create.mock.calls.length,
      eventCreates:
        prismaMocks.tx.patch_resource_access.create.mock.calls.length
    })
  })

  it('throws busy after three retryable transaction conflicts', async () => {
    prismaMocks.$transaction.mockRejectedValue(createKnownRequestError('P2034'))

    await expect(resolveResourceAccessGrant(baseInput)).rejects.toBeInstanceOf(
      ResourceAccessGrantBusyError
    )
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(3)
  })

  it('backs off between retryable transaction conflicts', async () => {
    const result = {
      kind: 'reused' as const,
      expires: new Date('2026-07-11T02:00:00.000Z')
    }
    prismaMocks.$transaction
      .mockRejectedValueOnce(createKnownRequestError('P2034'))
      .mockRejectedValueOnce(createKnownRequestError('P2034'))
      .mockResolvedValueOnce(result)

    await expect(resolveResourceAccessGrant(baseInput)).resolves.toEqual(result)

    expect(timerMocks.wait.mock.calls).toEqual([[50], [100]])
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(3)
  })

  it('retries adapter-level PostgreSQL serialization conflicts', async () => {
    const result = {
      kind: 'limited' as const,
      window: 'daily' as const,
      retryAfterSeconds: 60,
      remaining: { daily: 0, weekly: 15 },
      resetsAt: {
        daily: '2026-07-10T16:00:00.000Z',
        weekly: '2026-07-12T16:00:00.000Z'
      }
    }
    prismaMocks.$transaction
      .mockRejectedValueOnce(createDriverAdapterWriteConflictError())
      .mockResolvedValueOnce(result)

    await expect(resolveResourceAccessGrant(baseInput)).resolves.toEqual(result)

    expect(timerMocks.wait.mock.calls).toEqual([[50]])
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(2)
  })
})
