import { getPrefixedRedisKey, redis, runRedisCommand } from '~/lib/redis'
import type { ResourceAccessActor } from './actor'

export type ResourceAccessRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; message: string }

type RedisRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

const RESOURCE_ACCESS_ACTION_RATE_LIMIT_SECONDS = 60
const RESOURCE_ACCESS_ACTION_RATE_LIMIT_COUNT = 30

const RESOURCE_ACCESS_RATE_LIMIT_SCRIPT = `
  -- resource access action rate limit
  local current = redis.call("INCR", KEYS[1])
  if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end

  local ttl = redis.call("PTTL", KEYS[1])
  if ttl < 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1]) * 1000
  end

  local limit = tonumber(ARGV[2])
  if current > limit then
    return cjson.encode({ allowed = false, retryAfterMs = ttl })
  end

  return cjson.encode({ allowed = true, remaining = limit - current })
`

const parseRedisRateLimitResult = (value: unknown): RedisRateLimitResult => {
  if (typeof value !== 'string') {
    throw new Error('Invalid Redis resource access rate limit response')
  }

  const parsed = JSON.parse(value) as Partial<RedisRateLimitResult>
  if (parsed.allowed === true && typeof parsed.remaining === 'number') {
    return parsed as RedisRateLimitResult
  }
  if (
    parsed.allowed === false &&
    typeof parsed.retryAfterMs === 'number' &&
    Number.isFinite(parsed.retryAfterMs)
  ) {
    return parsed as RedisRateLimitResult
  }

  throw new Error('Invalid Redis resource access rate limit payload')
}

const getActorRateLimitKey = (actor: ResourceAccessActor) =>
  actor.actorType === 'user'
    ? `resource-access:rate-limit:v1:user:${actor.uid}`
    : actor.shouldSetVisitorCookie && actor.ipHash
      ? `resource-access:rate-limit:v1:visitor-ip:${actor.ipHash}`
      : `resource-access:rate-limit:v1:visitor-token:${actor.visitorToken}`

const formatRateLimitMessage = (retryAfterMs: number) =>
  `获取下载链接过于频繁，请 ${Math.max(
    1,
    Math.ceil(retryAfterMs / 1000)
  )} 秒后再试`

export const checkResourceAccessActionRateLimit = async (
  actor: ResourceAccessActor
): Promise<ResourceAccessRateLimitResult> => {
  const key = getPrefixedRedisKey(getActorRateLimitKey(actor))

  try {
    const rawResult = await runRedisCommand(() =>
      redis.eval(
        RESOURCE_ACCESS_RATE_LIMIT_SCRIPT,
        1,
        key,
        String(RESOURCE_ACCESS_ACTION_RATE_LIMIT_SECONDS),
        String(RESOURCE_ACCESS_ACTION_RATE_LIMIT_COUNT)
      )
    )
    const result = parseRedisRateLimitResult(rawResult)
    return result.allowed
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterMs: result.retryAfterMs,
          message: formatRateLimitMessage(result.retryAfterMs)
        }
  } catch (error) {
    console.error('Failed to check resource access action rate limit', {
      actorType: actor.actorType,
      errorName: error instanceof Error ? error.name : 'UnknownError'
    })
    return { allowed: true }
  }
}
