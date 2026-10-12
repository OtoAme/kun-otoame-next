import { getPrefixedRedisKey, redis, runRedisCommand } from '~/lib/redis'
const SCRIPT = `
local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('EXPIRE',KEYS[1],60) end
local ttl=redis.call('PTTL',KEYS[1])
if ttl<0 then redis.call('EXPIRE',KEYS[1],60); ttl=60000 end
return {n,ttl}
`
export const checkLinkHealthRateLimit = async (uid: number) => {
  try {
    const result = await runRedisCommand(() =>
      redis.eval(SCRIPT, 1, getPrefixedRedisKey(`link-health:user:${uid}`))
    )
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !result.every((n) => Number.isFinite(Number(n)))
    )
      throw new Error('Invalid rate result')
    return Number(result[0]) <= 30
      ? null
      : Math.max(1, Math.ceil(Number(result[1]) / 1000))
  } catch {
    console.error('[LinkHealth] Technical rate limit unavailable')
    return null
  }
}
