import { redis, runRedisCommand } from '~/lib/redis'

const PATCH_VIEWS_BUFFER_KEY = 'kun:touchgal:views:buffer'
const PATCH_VIEWS_PENDING_KEY = `${PATCH_VIEWS_BUFFER_KEY}:pending`

interface PatchViewBufferCheckout {
  key: string
  entries: Record<string, string>
}

export const incrementPatchViewBuffer = async (uniqueId: string) => {
  await runRedisCommand(() =>
    redis.hincrby(PATCH_VIEWS_BUFFER_KEY, uniqueId, 1)
  )
}

const parseBufferedCount = (value: string | null) => {
  if (!value) {
    return 0
  }

  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

export const getPatchViewBufferCounts = async (uniqueIds: string[]) => {
  const uniqueIdList = [...new Set(uniqueIds)].filter(Boolean)
  const counts = new Map<string, number>()
  if (!uniqueIdList.length) {
    return counts
  }

  const [bufferCounts, pendingCounts] = await Promise.all([
    runRedisCommand(() => redis.hmget(PATCH_VIEWS_BUFFER_KEY, ...uniqueIdList)),
    runRedisCommand(() => redis.hmget(PATCH_VIEWS_PENDING_KEY, ...uniqueIdList))
  ])

  uniqueIdList.forEach((uniqueId, index) => {
    const count =
      parseBufferedCount(bufferCounts[index]) +
      parseBufferedCount(pendingCounts[index])

    if (count > 0) {
      counts.set(uniqueId, count)
    }
  })

  return counts
}

export const checkoutPatchViewBuffer =
  async (): Promise<PatchViewBufferCheckout | null> => {
    const hasPending = await runRedisCommand(() =>
      redis.eval(
        `
          if redis.call("EXISTS", KEYS[2]) == 0 then
            if redis.call("EXISTS", KEYS[1]) == 0 then
              return 0
            end
            redis.call("RENAME", KEYS[1], KEYS[2])
          end
          return 1
        `,
        2,
        PATCH_VIEWS_BUFFER_KEY,
        PATCH_VIEWS_PENDING_KEY
      )
    )

    if (hasPending !== 1) {
      return null
    }

    const entries = await runRedisCommand(() =>
      redis.hgetall(PATCH_VIEWS_PENDING_KEY)
    )
    if (Object.keys(entries).length === 0) {
      await runRedisCommand(() => redis.del(PATCH_VIEWS_PENDING_KEY))
      return null
    }

    return {
      key: PATCH_VIEWS_PENDING_KEY,
      entries
    }
  }

export const acknowledgePatchViewBuffer = async (key: string) => {
  if (key !== PATCH_VIEWS_PENDING_KEY) {
    throw new Error('Invalid patch view buffer pending key')
  }

  await runRedisCommand(() => redis.del(key))
}
