export const VISITOR_GAME_RESOURCE_DAILY_LIMIT = 5
export const VISITOR_GAME_RESOURCE_WEEKLY_LIMIT = 20
export const RESOURCE_ACCESS_GRANT_MS = 24 * 60 * 60 * 1000

export const getResourceAccessPolicy = (
  actorType: 'visitor' | 'user',
  resourceKind: 'galgame' | 'patch'
) =>
  actorType === 'visitor' && resourceKind === 'galgame'
    ? {
        productQuota: 'visitor' as const,
        dailyLimit: VISITOR_GAME_RESOURCE_DAILY_LIMIT,
        weeklyLimit: VISITOR_GAME_RESOURCE_WEEKLY_LIMIT
      }
    : { productQuota: 'none' as const }
