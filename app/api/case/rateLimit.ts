import { getPrefixedRedisKey, redis, runRedisCommand } from '~/lib/redis'

/**
 * Case image uploads create object storage cost, so the upload tier fails
 * closed on a Redis outage (docs/modules/data-cache-upload.md). The intake
 * tier only protects multipart parsing and stays fail-open. Every reply
 * notifies the other side, so a non-administrator's replies are capped per
 * case (D29); a Redis outage must not block a reply, so that tier fails open.
 */
type CaseRateLimitAction = 'image-upload-intake' | 'image-upload' | 'message'

type Policy = {
  limit: number
  windowSeconds: number
  messagePrefix: string
  failClosed: boolean
}

const POLICIES: Record<CaseRateLimitAction, Policy> = {
  'image-upload-intake': {
    limit: 30,
    windowSeconds: 60,
    messagePrefix: '图片上传请求过于频繁',
    failClosed: false
  },
  'image-upload': {
    limit: 20,
    windowSeconds: 10 * 60,
    messagePrefix: '图片上传过于频繁',
    failClosed: true
  },
  message: {
    limit: 5,
    windowSeconds: 10 * 60,
    messagePrefix: '回复过于频繁',
    failClosed: false
  }
}

const RATE_LIMIT_SCRIPT = `
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

  return cjson.encode({ allowed = true })
`

/** `scope` narrows the bucket below the user, e.g. to one case for replies. */
export const checkCaseRateLimit = async (
  action: CaseRateLimitAction,
  uid: number,
  scope?: number
): Promise<string | null> => {
  const policy = POLICIES[action]
  const key = getPrefixedRedisKey(
    `case:rate-limit:${action}:${uid}${scope === undefined ? '' : `:${scope}`}`
  )

  try {
    const raw = await runRedisCommand(() =>
      redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        String(policy.windowSeconds),
        String(policy.limit)
      )
    )
    if (typeof raw !== 'string') {
      throw new Error('Invalid Redis rate limit response')
    }

    const parsed = JSON.parse(raw) as {
      allowed?: boolean
      retryAfterMs?: number
    }
    if (parsed.allowed) {
      return null
    }

    const retrySeconds = Math.max(
      1,
      Math.ceil((parsed.retryAfterMs ?? 0) / 1000)
    )
    return `${policy.messagePrefix}，请 ${retrySeconds} 秒后再试`
  } catch (error) {
    console.error('Failed to check the case rate limit', {
      action,
      uid,
      scope,
      error
    })
    return policy.failClosed ? '服务暂时不可用，请稍后重试' : null
  }
}
