import {
  getPrefixedRedisKey,
  redis,
  runRedisCommand
} from '~/lib/redis'

type ConversationRateLimitAction =
  | 'send'
  | 'image-upload'
  | 'image-upload-intake'
  | 'conversation-open'
  | 'message-read'
  | 'message-write'
  | 'notification-read'
  | 'notification-write'
  | 'conversation-manage'

type ConversationRateLimitPolicy = {
  limit: number
  windowSeconds: number
  messagePrefix: string
}

type RedisRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

type ConversationRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; message: string }

export type ConversationImageUploadQuotaReservation = {
  counted: boolean
  count: number
  cost: number
  ttlSeconds: number
  unavailable?: boolean
}

export const CONVERSATION_IMAGE_FREE_UPLOADS_PER_HOUR = 5
export const CONVERSATION_IMAGE_UPLOAD_OVERAGE_MOEMOEPOINT_COST = 5

const CONVERSATION_RATE_LIMIT_POLICIES: Record<
  ConversationRateLimitAction,
  ConversationRateLimitPolicy
> = {
  send: {
    limit: 30,
    windowSeconds: 60,
    messagePrefix: '发送过于频繁'
  },
  'image-upload': {
    limit: 10,
    windowSeconds: 5 * 60,
    messagePrefix: '图片上传过于频繁'
  },
  'image-upload-intake': {
    limit: 30,
    windowSeconds: 60,
    messagePrefix: '图片上传请求过于频繁'
  },
  'conversation-open': {
    limit: 60,
    windowSeconds: 60,
    messagePrefix: '私聊操作过于频繁'
  },
  'message-read': {
    limit: 180,
    windowSeconds: 60,
    messagePrefix: '消息读取过于频繁'
  },
  'message-write': {
    limit: 60,
    windowSeconds: 60,
    messagePrefix: '消息操作过于频繁'
  },
  'notification-read': {
    limit: 180,
    windowSeconds: 60,
    messagePrefix: '通知读取过于频繁'
  },
  'notification-write': {
    limit: 30,
    windowSeconds: 60,
    messagePrefix: '通知操作过于频繁'
  },
  'conversation-manage': {
    limit: 30,
    windowSeconds: 60,
    messagePrefix: '私聊管理操作过于频繁'
  }
}

const CONVERSATION_RATE_LIMIT_SCRIPT = `
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

const CONVERSATION_IMAGE_UPLOAD_QUOTA_SCRIPT = `
  local current = redis.call("INCR", KEYS[1])
  if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end

  local ttl = redis.call("TTL", KEYS[1])
  if ttl < 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end

  return cjson.encode({ count = current, ttlSeconds = ttl })
`

const CONVERSATION_IMAGE_UPLOAD_QUOTA_ROLLBACK_SCRIPT = `
  local current = redis.call("GET", KEYS[1])
  if not current then
    return 0
  end

  local value = tonumber(current)
  if not value or value <= 1 then
    redis.call("DEL", KEYS[1])
    return 0
  end

  return redis.call("DECR", KEYS[1])
`

const parseRedisRateLimitResult = (value: unknown): RedisRateLimitResult => {
  if (typeof value !== 'string') {
    throw new Error('Invalid Redis rate limit response')
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

  throw new Error('Invalid Redis rate limit payload')
}

const formatRateLimitMessage = (
  policy: ConversationRateLimitPolicy,
  retryAfterMs: number
) => {
  const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  return `${policy.messagePrefix}，请 ${retrySeconds} 秒后再试`
}

export const checkConversationActionRateLimit = async (
  action: ConversationRateLimitAction,
  uid: number
): Promise<ConversationRateLimitResult> => {
  const policy = CONVERSATION_RATE_LIMIT_POLICIES[action]
  const key = getPrefixedRedisKey(`conversation:rate-limit:${action}:${uid}`)

  try {
    const rawResult = await runRedisCommand(() =>
      redis.eval(
        CONVERSATION_RATE_LIMIT_SCRIPT,
        1,
        key,
        String(policy.windowSeconds),
        String(policy.limit)
      )
    )
    const result = parseRedisRateLimitResult(rawResult)

    if (result.allowed) {
      return { allowed: true }
    }

    return {
      allowed: false,
      retryAfterMs: result.retryAfterMs,
      message: formatRateLimitMessage(policy, result.retryAfterMs)
    }
  } catch (error) {
    console.error('Failed to check conversation rate limit', {
      action,
      uid,
      error
    })
    return { allowed: true }
  }
}

export const consumeConversationImageUploadQuota = async (
  uid: number
): Promise<ConversationImageUploadQuotaReservation> => {
  const key = getPrefixedRedisKey(`conversation:image-upload-quota:${uid}`)

  try {
    const rawResult = await runRedisCommand(() =>
      redis.eval(CONVERSATION_IMAGE_UPLOAD_QUOTA_SCRIPT, 1, key, String(60 * 60))
    )
    if (typeof rawResult !== 'string') {
      throw new Error('Invalid Redis image upload quota response')
    }

    const parsed = JSON.parse(rawResult) as {
      count?: unknown
      ttlSeconds?: unknown
    }
    if (
      typeof parsed.count !== 'number' ||
      typeof parsed.ttlSeconds !== 'number'
    ) {
      throw new Error('Invalid Redis image upload quota payload')
    }

    const cost =
      parsed.count > CONVERSATION_IMAGE_FREE_UPLOADS_PER_HOUR
        ? CONVERSATION_IMAGE_UPLOAD_OVERAGE_MOEMOEPOINT_COST
        : 0

    return {
      counted: true,
      count: parsed.count,
      ttlSeconds: parsed.ttlSeconds,
      cost
    }
  } catch (error) {
    console.error('Failed to consume conversation image upload quota', {
      uid,
      error
    })
    return {
      counted: false,
      count: 0,
      ttlSeconds: 0,
      cost: 0,
      unavailable: true
    }
  }
}

export const rollbackConversationImageUploadQuota = async (
  uid: number,
  reservation: ConversationImageUploadQuotaReservation
) => {
  if (!reservation.counted) {
    return
  }

  const key = getPrefixedRedisKey(`conversation:image-upload-quota:${uid}`)
  try {
    await runRedisCommand(() =>
      redis.eval(CONVERSATION_IMAGE_UPLOAD_QUOTA_ROLLBACK_SCRIPT, 1, key)
    )
  } catch (error) {
    console.error('Failed to rollback conversation image upload quota', {
      uid,
      error
    })
  }
}
