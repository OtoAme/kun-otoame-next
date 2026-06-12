import { parseCookies } from '~/utils/cookies'

const PERSONALIZED_COOKIE_KEYS = [
  'kun-galgame-patch-moe-token',
  'kun-patch-setting-store|state|data|kunNsfwEnable',
  'kun-patch-setting-store|state|data|kunBlockedTagIds'
]

export const ANONYMOUS_API_CACHE_CONTROL =
  'public, s-maxage=30, stale-while-revalidate=300'

export const PERSONALIZED_API_CACHE_CONTROL = 'private, no-store'

export const isPersonalizedApiRequest = (req: Pick<Request, 'headers'>) => {
  const cookieHeader = req.headers.get('cookie')
  if (!cookieHeader) {
    return false
  }

  const cookies = parseCookies(cookieHeader)

  return PERSONALIZED_COOKIE_KEYS.some((key) => cookies[key] !== undefined)
}

export const getAnonymousApiCacheControl = (req: Pick<Request, 'headers'>) =>
  isPersonalizedApiRequest(req)
    ? PERSONALIZED_API_CACHE_CONTROL
    : ANONYMOUS_API_CACHE_CONTROL

export const withAnonymousApiCache = <T extends Response>(
  response: T,
  req: Pick<Request, 'headers'>
) => {
  response.headers.set('Cache-Control', getAnonymousApiCacheControl(req))
  return response
}
