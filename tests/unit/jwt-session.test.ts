import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisState = vi.hoisted(() => {
  const kv = new Map<string, string>()
  const zsets = new Map<string, Map<string, number>>()

  const getZset = (key: string) => {
    const existing = zsets.get(key)
    if (existing) {
      return existing
    }

    const next = new Map<string, number>()
    zsets.set(key, next)
    return next
  }

  const sortZsetMembers = (zset: Map<string, number>) =>
    [...zset.entries()].sort((a, b) => a[1] - b[1]).map(([member]) => member)

  return {
    kv,
    zsets,
    redis: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        kv.set(key, value)
        return 'OK'
      }),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => {
        kv.set(key, value)
        return 'OK'
      }),
      mget: vi.fn(async (...keys: string[]) =>
        keys.map((key) => kv.get(key) ?? null)
      ),
      del: vi.fn(async (...keys: string[]) => {
        let deleted = 0
        for (const key of keys) {
          if (kv.delete(key)) {
            deleted++
          }
          if (zsets.delete(key)) {
            deleted++
          }
        }
        return deleted
      }),
      zadd: vi.fn(async (key: string, score: number, member: string) => {
        getZset(key).set(member, Number(score))
        return 1
      }),
      zcard: vi.fn(async (key: string) => getZset(key).size),
      zrange: vi.fn(async (key: string, start: number, stop: number) => {
        const members = sortZsetMembers(getZset(key))
        const end = stop === -1 ? members.length : stop + 1
        return members.slice(start, end)
      }),
      zrem: vi.fn(async (key: string, ...members: string[]) => {
        const zset = getZset(key)
        let removed = 0
        for (const member of members) {
          if (zset.delete(member)) {
            removed++
          }
        }
        return removed
      }),
      expire: vi.fn(async () => 1)
    }
  }
})

vi.mock('ioredis', () => {
  return {
    default: class Redis {
      constructor() {
        return redisState.redis
      }
    }
  }
})

import {
  deleteKunSession,
  deleteKunToken,
  deleteOtherKunSessions,
  generateKunToken,
  updateKunSessions,
  verifyKunToken
} from '~/app/api/utils/jwt'

const prefixed = (key: string) => `kun:touchgal:${key}`

const getStoredSession = (uid: number, jti: string) => {
  const value = redisState.kv.get(prefixed(`access:session:${uid}:${jti}`))
  return value ? JSON.parse(value) : null
}

describe('JWT Redis sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisState.kv.clear()
    redisState.zsets.clear()

    process.env.JWT_SECRET = 'unit-test-secret'
    process.env.JWT_ISS = 'unit-test-issuer'
    process.env.JWT_AUD = 'unit-test-audience'
  })

  it('keeps multiple devices valid for the same user', async () => {
    const firstToken = await generateKunToken(7, 'saya', 1, '30d')
    const secondToken = await generateKunToken(7, 'saya', 1, '30d')

    const firstPayload = await verifyKunToken(firstToken)
    const secondPayload = await verifyKunToken(secondToken)

    expect(firstPayload?.uid).toBe(7)
    expect(secondPayload?.uid).toBe(7)
    expect(firstPayload?.jti).not.toBe(secondPayload?.jti)
  })

  it('limits one user to five newest sessions', async () => {
    const tokens: string[] = []
    vi.useFakeTimers()
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(new Date(`2026-05-06T00:00:0${i}.000Z`))
      tokens.push(await generateKunToken(8, 'multi', 1, '30d'))
    }
    vi.useRealTimers()

    await expect(verifyKunToken(tokens[0])).resolves.toBeNull()

    const validPayloads = await Promise.all(
      tokens.slice(1).map((token) => verifyKunToken(token))
    )
    expect(validPayloads.every(Boolean)).toBe(true)

    const sessionIndex = redisState.zsets.get(prefixed('access:sessions:8'))
    expect(sessionIndex?.size).toBe(5)
  })

  it('deletes only the current session on logout', async () => {
    const firstToken = await generateKunToken(9, 'logout', 1, '30d')
    const secondToken = await generateKunToken(9, 'logout', 1, '30d')
    const firstPayload = await verifyKunToken(firstToken)

    await deleteKunSession(9, firstPayload!.jti)

    await expect(verifyKunToken(firstToken)).resolves.toBeNull()
    await expect(verifyKunToken(secondToken)).resolves.toMatchObject({
      uid: 9
    })
  })

  it('can delete all other sessions while keeping the current device', async () => {
    const currentToken = await generateKunToken(10, 'password', 1, '30d')
    const otherToken = await generateKunToken(10, 'password', 1, '30d')
    const currentPayload = await verifyKunToken(currentToken)

    await deleteOtherKunSessions(10, currentPayload!.jti)

    await expect(verifyKunToken(currentToken)).resolves.toMatchObject({
      uid: 10
    })
    await expect(verifyKunToken(otherToken)).resolves.toBeNull()
  })

  it('can delete every session for a user', async () => {
    const firstToken = await generateKunToken(11, 'revoke', 1, '30d')
    const secondToken = await generateKunToken(11, 'revoke', 1, '30d')

    await deleteKunToken(11)

    await expect(verifyKunToken(firstToken)).resolves.toBeNull()
    await expect(verifyKunToken(secondToken)).resolves.toBeNull()
  })

  it('uses role and name from Redis session during verification', async () => {
    const token = await generateKunToken(12, 'old-name', 1, '30d')

    await updateKunSessions(12, { name: 'new-name', role: 3 })

    await expect(verifyKunToken(token)).resolves.toMatchObject({
      uid: 12,
      name: 'new-name',
      role: 3
    })
  })

  it('migrates a legacy single-token session on first verification', async () => {
    const token = await generateKunToken(13, 'legacy', 2, '30d')
    const payload = await verifyKunToken(token)

    await deleteKunToken(13)
    redisState.kv.set(prefixed('access:token:13'), token)

    const migratedPayload = await verifyKunToken(token)

    expect(migratedPayload).toMatchObject({
      uid: 13,
      name: 'legacy',
      role: 2
    })
    expect(getStoredSession(13, payload!.jti)).toMatchObject({
      uid: 13,
      name: 'legacy',
      role: 2
    })
    expect(redisState.kv.has(prefixed('access:token:13'))).toBe(false)
  })
})
