import { NextRequest } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { getCachedAnonymousJsonResponse } from '~/app/api/utils/anonymousApiResponseCache'
import { getHomeData } from './service'

export const GET = async (req: NextRequest) => {
  return getCachedAnonymousJsonResponse(
    req,
    'home',
    async () => {
      const visibilityWhere = await getPatchVisibilityWhere(req)

      return getHomeData(visibilityWhere)
    },
    {
      shouldCacheValue: (response) => response.galgames.length > 0
    }
  )
}
