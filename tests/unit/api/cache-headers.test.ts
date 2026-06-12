import { describe, expect, it } from 'vitest'
import {
  getAnonymousApiCacheControl,
  isPersonalizedApiRequest
} from '~/app/api/utils/cacheHeaders'

const requestWithCookie = (cookie: string) =>
  ({
    headers: {
      get: (name: string) => (name.toLowerCase() === 'cookie' ? cookie : null)
    }
  }) as Request

describe('API cache headers', () => {
  it('marks requests without personalization cookies as public-cacheable', () => {
    const req = requestWithCookie('')

    expect(isPersonalizedApiRequest(req)).toBe(false)
    expect(getAnonymousApiCacheControl(req)).toBe(
      'public, s-maxage=30, stale-while-revalidate=300'
    )
  })

  it('does not shared-cache login or NSFW personalized requests', () => {
    expect(
      isPersonalizedApiRequest(
        requestWithCookie('kun-galgame-patch-moe-token=token')
      )
    ).toBe(true)
    expect(
      isPersonalizedApiRequest(
        requestWithCookie(
          'kun-patch-setting-store|state|data|kunNsfwEnable=all'
        )
      )
    ).toBe(true)
    expect(
      getAnonymousApiCacheControl(
        requestWithCookie('kun-galgame-patch-moe-token=token')
      )
    ).toBe('private, no-store')
  })

  it('does not shared-cache blocked tag personalized requests', () => {
    const req = requestWithCookie(
      'kun-patch-setting-store|state|data|kunBlockedTagIds=%5B1%5D'
    )

    expect(isPersonalizedApiRequest(req)).toBe(true)
    expect(getAnonymousApiCacheControl(req)).toBe('private, no-store')
  })
})
