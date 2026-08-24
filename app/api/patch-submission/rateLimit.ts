import { getPrefixedRedisKey, redis, runRedisCommand } from '~/lib/redis'

/**
 * Rate limit tiers for the submission domain.
 *
 * The project's existing rule is that action limits fail open on a Redis outage,
 * while limits guarding unmeterable object storage cost fail closed
 * (docs/modules/data-cache-upload.md). Submissions split that further:
 *
 * - fail-closed: creating a draft, submitting, uploading assets — these move
 *   money or create storage cost.
 * - fail-open: reading a draft and autosaving — a Redis hiccup must not
 *   interrupt someone mid-edit.
 * - no limit at all: deleting a draft, and every review settlement. Those are
 *   the paths that return a deposit, and a 429 there would strand it. Note this
 *   is not the same as failing open: fail-open still answers 429 once the
 *   threshold is crossed, which is exactly what must not happen to a refund.
 */
type PatchSubmissionRateLimitAction =
  | 'create'
  | 'submit'
  | 'asset-upload'
  | 'read'
  | 'autosave'

type Policy = {
  limit: number
  windowSeconds: number
  messagePrefix: string
  /** true: a Redis outage rejects the request. false: it lets it through. */
  failClosed: boolean
}

const POLICIES: Record<PatchSubmissionRateLimitAction, Policy> = {
  create: {
    limit: 20,
    windowSeconds: 60 * 60,
    messagePrefix: '新建投稿过于频繁',
    failClosed: true
  },
  submit: {
    limit: 20,
    windowSeconds: 60 * 60,
    messagePrefix: '提交操作过于频繁',
    failClosed: true
  },
  'asset-upload': {
    limit: 30,
    windowSeconds: 10 * 60,
    messagePrefix: '素材上传过于频繁',
    failClosed: true
  },
  read: {
    limit: 240,
    windowSeconds: 60,
    messagePrefix: '请求过于频繁',
    failClosed: false
  },
  autosave: {
    limit: 120,
    windowSeconds: 60,
    messagePrefix: '保存过于频繁',
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

export const checkPatchSubmissionRateLimit = async (
  action: PatchSubmissionRateLimitAction,
  uid: number
): Promise<string | null> => {
  const policy = POLICIES[action]
  const key = getPrefixedRedisKey(`patch-submission:rate-limit:${action}:${uid}`)

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

    const retrySeconds = Math.max(1, Math.ceil((parsed.retryAfterMs ?? 0) / 1000))
    return `${policy.messagePrefix}，请 ${retrySeconds} 秒后再试`
  } catch (error) {
    console.error('Failed to check the patch submission rate limit', {
      action,
      uid,
      error
    })
    return policy.failClosed
      ? '服务暂时不可用, 请稍后重试'
      : null
  }
}
