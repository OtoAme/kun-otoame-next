import { NextRequest, NextResponse } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { isPersonalizedApiRequest } from '~/app/api/utils/cacheHeaders'
import { getShoutboxBanner } from '../service'
import { getShoutboxCacheControl } from '../cache'
import { toShoutboxReadError } from '../errors'

export const GET = async (req: NextRequest) => {
  const personalized = isPersonalizedApiRequest(req)
  try {
    const visibilityWhere = await getPatchVisibilityWhere(req)
    const response = await getShoutboxBanner({ visibilityWhere })
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': getShoutboxCacheControl(
          response.validUntil,
          personalized
        )
      }
    })
  } catch (error) {
    const readError = toShoutboxReadError(error, 'global')
    return NextResponse.json(readError.message, {
      status: 503,
      headers: {
        'Cache-Control': 'private, no-store',
        'Retry-After': String(readError.retryAfterSeconds)
      }
    })
  }
}
