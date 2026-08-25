import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
let originalZoneId: string | undefined
let originalToken: string | undefined
let originalImageBedUrl: string | undefined

import {
  purgeCloudflareCache,
  purgePublicApiCache,
  purgePublicPageCache
} from '~/app/api/utils/purgeCloudflareCache'
import {
  purgePatchBannerCache,
  purgeUserAvatarCache
} from '~/app/api/utils/purgeCache'

describe('Cloudflare cache purge helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    })
    originalZoneId = process.env.KUN_CF_CACHE_ZONE_ID
    originalToken = process.env.KUN_CF_CACHE_PURGE_API_TOKEN
    originalImageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
    process.env.KUN_CF_CACHE_ZONE_ID = 'zone-id'
    process.env.KUN_CF_CACHE_PURGE_API_TOKEN = 'purge-token'
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.otoame.top'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalZoneId === undefined) {
      delete process.env.KUN_CF_CACHE_ZONE_ID
    } else {
      process.env.KUN_CF_CACHE_ZONE_ID = originalZoneId
    }
    if (originalToken === undefined) {
      delete process.env.KUN_CF_CACHE_PURGE_API_TOKEN
    } else {
      process.env.KUN_CF_CACHE_PURGE_API_TOKEN = originalToken
    }
    if (originalImageBedUrl === undefined) {
      delete process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
    } else {
      process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = originalImageBedUrl
    }
  })

  it('purges public page URLs with duplicate paths removed', async () => {
    await purgePublicPageCache(['/', 'abc12345', '/abc12345'])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          files: ['https://www.otoame.top/', 'https://www.otoame.top/abc12345']
        })
      })
    )
  })

  it('purges API path prefixes without query strings', async () => {
    await purgePublicApiCache([
      '/api/tag/otomegame',
      'api/tag/otomegame',
      '/api/company/otomegame'
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prefixes: [
            'https://www.otoame.top/api/tag/otomegame',
            'https://www.otoame.top/api/company/otomegame'
          ]
        })
      })
    )
  })

  it('does not call Cloudflare when purge config is missing', async () => {
    delete process.env.KUN_CF_CACHE_ZONE_ID

    const result = await purgeCloudflareCache({
      files: ['https://www.otoame.top/']
    })

    expect(result).toEqual({ status: 0, success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('confirms a purge only when the API says so', async () => {
    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 200, success: true })
  })

  // A rejected purge comes back as 200 with success: false, so callers that keep
  // a retry queue cannot treat a 2xx as confirmation.
  it('does not confirm a 200 the API reported as unsuccessful', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, errors: [{ code: 1012 }] })
    })

    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 200, success: false })
  })

  it('does not confirm an HTTP failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 })

    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 502, success: false })
  })

  it('does not confirm, and does not throw, when the body is unreadable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('unexpected end of JSON input')
      }
    })

    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 200, success: false })
  })

  it('does not confirm when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('timed out'))

    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 0, success: false })
  })

  it('reuses the safe Cloudflare helper for banner and avatar purges', async () => {
    await purgePatchBannerCache(7)
    await purgeUserAvatarCache(9)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        body: JSON.stringify({
          files: [
            'https://img.otoame.top/patch/7/banner/banner.avif',
            'https://img.otoame.top/patch/7/banner/banner-mini.avif',
            'https://img.otoame.top/patch/7/banner/banner-full.avif'
          ]
        })
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        body: JSON.stringify({
          files: [
            'https://img.otoame.top/user/avatar/user_9/avatar.avif',
            'https://img.otoame.top/user/avatar/user_9/avatar-mini.avif'
          ]
        })
      })
    )
  })
})
