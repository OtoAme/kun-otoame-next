import { NextRequest, NextResponse } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { isPersonalizedApiRequest } from '~/app/api/utils/cacheHeaders'
import { getShoutboxBanner } from '../service'
import { getShoutboxCacheControl } from '../cache'

export const GET = async (req: NextRequest) => {
  const visibilityWhere = await getPatchVisibilityWhere(req)
  const response = await getShoutboxBanner({
    visibilityWhere,
    useCache: !isPersonalizedApiRequest(req)
  })
  return NextResponse.json(response, {
    headers: {
      'Cache-Control': getShoutboxCacheControl(
        response.validUntil,
        isPersonalizedApiRequest(req)
      )
    }
  })
}
