import { parseCookies } from '~/utils/cookies'
import { getContentLimitWhere } from '~/utils/contentPreference'
import { getRequestIdentity, requireAvailableIdentity } from './sessionIdentity'
import type { NextRequest } from 'next/server'

export const getNSFWHeader = async (req: NextRequest) => {
  const payload = requireAvailableIdentity(await getRequestIdentity(req))
  if (!payload) {
    return { content_limit: 'sfw' }
  }
  const cookies = parseCookies(req.headers.get('cookie') ?? '')
  return getContentLimitWhere(
    cookies['kun-patch-setting-store|state|data|kunNsfwEnable']
  )
}
