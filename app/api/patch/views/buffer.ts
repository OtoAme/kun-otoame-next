import { redis, runRedisCommand } from '~/lib/redis'

const PATCH_VIEWS_BUFFER_KEY = 'kun:touchgal:views:buffer'
const PATCH_VIEWS_PENDING_KEY = `${PATCH_VIEWS_BUFFER_KEY}:pending`
const PATCH_STATS_VIEW_KEY = 'kun:touchgal:patch:stats:view'
const PATCH_STATS_DOWNLOAD_KEY = 'kun:touchgal:patch:stats:download'

interface PatchViewBufferCheckout {
  key: string
  entries: Record<string, string>
}

export const incrementPatchViewBuffer = async (
  uniqueId: string,
  currentView?: number
) => {
  if (typeof currentView === 'number' && Number.isFinite(currentView)) {
    await runRedisCommand(() =>
      redis.eval(
        `
          if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 0 then
            redis.call("HSET", KEYS[2], ARGV[1], ARGV[2])
          end
          redis.call("HINCRBY", KEYS[1], ARGV[1], 1)
          return redis.call("HINCRBY", KEYS[2], ARGV[1], 1)
        `,
        2,
        PATCH_VIEWS_BUFFER_KEY,
        PATCH_STATS_VIEW_KEY,
        uniqueId,
        Math.max(0, Math.floor(currentView))
      )
    )
    return
  }

  await runRedisCommand(() =>
    redis
      .multi()
      .hincrby(PATCH_VIEWS_BUFFER_KEY, uniqueId, 1)
      .hincrby(PATCH_STATS_VIEW_KEY, uniqueId, 1)
      .exec()
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

export const setRealtimePatchDownloadStats = async (
  uniqueId: string,
  download: number
) => {
  await runRedisCommand(() =>
    redis.hset(PATCH_STATS_DOWNLOAD_KEY, uniqueId, Math.max(0, download))
  )
}

export const getRealtimePatchStats = async (uniqueIds: string[]) => {
  const uniqueIdList = [...new Set(uniqueIds)].filter(Boolean)
  const stats = {
    view: new Map<string, number>(),
    download: new Map<string, number>()
  }
  if (!uniqueIdList.length) {
    return stats
  }

  const [viewCounts, downloadCounts] = await Promise.all([
    runRedisCommand(() => redis.hmget(PATCH_STATS_VIEW_KEY, ...uniqueIdList)),
    runRedisCommand(() =>
      redis.hmget(PATCH_STATS_DOWNLOAD_KEY, ...uniqueIdList)
    )
  ])

  uniqueIdList.forEach((uniqueId, index) => {
    const view = parseBufferedCount(viewCounts[index])
    const download = parseBufferedCount(downloadCounts[index])

    if (view > 0) {
      stats.view.set(uniqueId, view)
    }
    if (download > 0) {
      stats.download.set(uniqueId, download)
    }
  })

  return stats
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
