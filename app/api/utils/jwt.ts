import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import {
  delKv,
  delKvs,
  getKv,
  getKvs,
  getPrefixedRedisKey,
  redis,
  runRedisCommand,
  setKv
} from '~/lib/redis'

const KUN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const KUN_MAX_USER_SESSIONS = 5

interface KunSessionData {
  uid: number
  jti: string
  name: string
  role: number
  createdAt: number
}

export interface KunGalgameStatelessPayload {
  require2FA: boolean
  id: number
}

export interface KunGalgamePayload {
  iss: string
  aud: string
  jti: string
  uid: number
  name: string
  role: number
}

const getUserSessionIndexKey = (uid: number) => `access:sessions:${uid}`
const getSessionKey = (uid: number, jti: string) =>
  `access:session:${uid}:${jti}`

const parseSession = (value: string | null) => {
  if (!value) {
    return null
  }

  try {
    const session = JSON.parse(value) as Partial<KunSessionData>
    if (
      typeof session.uid !== 'number' ||
      typeof session.jti !== 'string' ||
      typeof session.name !== 'string' ||
      typeof session.role !== 'number' ||
      typeof session.createdAt !== 'number'
    ) {
      return null
    }

    return session as KunSessionData
  } catch {
    return null
  }
}

const pruneUserSessions = async (uid: number) => {
  const indexKey = getUserSessionIndexKey(uid)
  const prefixedIndexKey = getPrefixedRedisKey(indexKey)
  const sessionCount = await runRedisCommand(() =>
    redis.zcard(prefixedIndexKey)
  )

  if (sessionCount <= KUN_MAX_USER_SESSIONS) {
    return
  }

  const removeCount = sessionCount - KUN_MAX_USER_SESSIONS
  const staleJtis = await runRedisCommand(() =>
    redis.zrange(prefixedIndexKey, 0, removeCount - 1)
  )
  if (!staleJtis.length) {
    return
  }

  await delKvs(staleJtis.map((jti) => getSessionKey(uid, jti)))
  await runRedisCommand(() => redis.zrem(prefixedIndexKey, ...staleJtis))
}

const saveSession = async (session: KunSessionData) => {
  const indexKey = getUserSessionIndexKey(session.uid)
  const prefixedIndexKey = getPrefixedRedisKey(indexKey)

  await setKv(
    getSessionKey(session.uid, session.jti),
    JSON.stringify(session),
    KUN_SESSION_TTL_SECONDS
  )
  await runRedisCommand(() =>
    redis.zadd(prefixedIndexKey, session.createdAt, session.jti)
  )
  await runRedisCommand(() =>
    redis.expire(prefixedIndexKey, KUN_SESSION_TTL_SECONDS)
  )
  await pruneUserSessions(session.uid)
}

export const generateKunToken = async (
  uid: number,
  name: string,
  role: number,
  expire: string
) => {
  const payload: KunGalgamePayload = {
    iss: process.env.JWT_ISS!,
    aud: process.env.JWT_AUD!,
    jti: randomUUID(),
    uid,
    name,
    role
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: expire
  } as jwt.SignOptions)
  await saveSession({
    uid,
    jti: payload.jti,
    name,
    role,
    createdAt: Date.now()
  })

  return token
}

export const generateKunStatelessToken = (
  payload: Record<string, string | number | boolean>,
  expire: number
) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: expire
  })
  return token
}

export type KunIdentityResult =
  | { status: 'authenticated'; payload: KunGalgamePayload }
  | { status: 'guest' }
  | { status: 'unavailable' }

export class SessionUnavailableError extends Error {
  constructor() {
    super('会话验证暂时不可用，请稍后重试')
    this.name = 'SessionUnavailableError'
  }
}

export const verifyKunTokenResult = async (
  refreshToken: string
): Promise<KunIdentityResult> => {
  if (!refreshToken) {
    return { status: 'guest' }
  }

  if (!process.env.JWT_SECRET || !process.env.JWT_ISS || !process.env.JWT_AUD) {
    return { status: 'unavailable' }
  }

  let payload: KunGalgamePayload
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_SECRET!, {
      issuer: process.env.JWT_ISS!,
      audience: process.env.JWT_AUD!
    }) as KunGalgamePayload
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.NotBeforeError
    ) {
      return { status: 'guest' }
    }
    return { status: 'unavailable' }
  }

  if (
    !Number.isSafeInteger(payload.uid) ||
    payload.uid <= 0 ||
    typeof payload.jti !== 'string' ||
    !payload.jti
  ) {
    return { status: 'guest' }
  }

  try {
    const session = parseSession(
      await getKv(getSessionKey(payload.uid, payload.jti))
    )

    if (session) {
      if (session.uid !== payload.uid || session.jti !== payload.jti) {
        return { status: 'guest' }
      }
      return {
        status: 'authenticated',
        payload: { ...payload, name: session.name, role: session.role }
      }
    }

    const legacyToken = await getKv(`access:token:${payload.uid}`)
    if (!legacyToken || legacyToken !== refreshToken) {
      return { status: 'guest' }
    }

    await saveSession({
      uid: payload.uid,
      jti: payload.jti,
      name: payload.name,
      role: payload.role,
      createdAt: Date.now()
    })
    await delKv(`access:token:${payload.uid}`)

    return { status: 'authenticated', payload }
  } catch {
    return { status: 'unavailable' }
  }
}

export const verifyKunToken = async (refreshToken: string) => {
  const result = await verifyKunTokenResult(refreshToken)
  return result.status === 'authenticated' ? result.payload : null
}

export const deleteKunToken = async (uid: number) => {
  const indexKey = getUserSessionIndexKey(uid)
  const prefixedIndexKey = getPrefixedRedisKey(indexKey)
  const jtis = await runRedisCommand(() =>
    redis.zrange(prefixedIndexKey, 0, -1)
  )

  if (jtis.length) {
    await delKvs(jtis.map((jti) => getSessionKey(uid, jti)))
  }

  await delKv(indexKey)
  await delKv(`access:token:${uid}`)
}

export const deleteKunSession = async (uid: number, jti: string) => {
  await delKv(getSessionKey(uid, jti))
  await runRedisCommand(() =>
    redis.zrem(getPrefixedRedisKey(getUserSessionIndexKey(uid)), jti)
  )
}

export const deleteOtherKunSessions = async (
  uid: number,
  currentJti: string
) => {
  const indexKey = getUserSessionIndexKey(uid)
  const prefixedIndexKey = getPrefixedRedisKey(indexKey)
  const jtis = await runRedisCommand(() =>
    redis.zrange(prefixedIndexKey, 0, -1)
  )
  const staleJtis = jtis.filter((jti) => jti !== currentJti)
  if (!staleJtis.length) {
    return
  }

  await delKvs(staleJtis.map((jti) => getSessionKey(uid, jti)))
  await runRedisCommand(() => redis.zrem(prefixedIndexKey, ...staleJtis))
}

export const updateKunSessions = async (
  uid: number,
  input: Partial<Pick<KunSessionData, 'name' | 'role'>>
) => {
  const indexKey = getUserSessionIndexKey(uid)
  const prefixedIndexKey = getPrefixedRedisKey(indexKey)
  const jtis = await runRedisCommand(() =>
    redis.zrange(prefixedIndexKey, 0, -1)
  )
  if (!jtis.length) {
    return
  }

  const sessionKeys = jtis.map((jti) => getSessionKey(uid, jti))
  const sessions = await getKvs(sessionKeys)

  await Promise.all(
    sessions.map(async (value, index) => {
      const session = parseSession(value)
      if (!session) {
        await runRedisCommand(() => redis.zrem(prefixedIndexKey, jtis[index]))
        return
      }

      await setKv(
        sessionKeys[index],
        JSON.stringify({ ...session, ...input }),
        KUN_SESSION_TTL_SECONDS
      )
    })
  )

  await runRedisCommand(() =>
    redis.expire(prefixedIndexKey, KUN_SESSION_TTL_SECONDS)
  )
}
