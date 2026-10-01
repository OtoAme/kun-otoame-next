import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

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
    fetchMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    })
    vi.stubEnv('KUN_CF_CACHE_ZONE_ID', 'zone-id')
    vi.stubEnv('KUN_CF_CACHE_PURGE_API_TOKEN', 'purge-token')
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', '')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', '')
    vi.stubEnv('KUN_VISUAL_NOVEL_IMAGE_BED_URL', 'https://img.otoame.top')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
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

  it('purges API prefixes without schemes, query strings or fragments', async () => {
    await purgePublicApiCache([
      '/api/tag/otomegame',
      'api/tag/otomegame?page=2#results',
      '/api/company/otomegame?sort=name'
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prefixes: [
            'www.otoame.top/api/tag/otomegame',
            'www.otoame.top/api/company/otomegame'
          ]
        })
      })
    )
  })

  it('keeps site and image URLs in the default zone when no site zone is set', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', 'unused-site-token')
    const files = [
      'https://www.otoame.top/game',
      'https://img.otoame.top/a.avif'
    ]

    expect(await purgeCloudflareCache(files)).toEqual({
      status: 200,
      success: true
    })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer purge-token'
        }),
        body: JSON.stringify({ files })
      })
    )
  })

  it('uses the site SaaS zone with the shared token and keeps the visitor URL', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')

    await purgePublicPageCache(['/game'])

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://api.cloudflare.com/client/v4/zones/site-provider-zone/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer purge-token'
        }),
        body: JSON.stringify({ files: ['https://www.otoame.top/game'] })
      })
    )
  })

  it('allows the site zone and its own token without default credentials', async () => {
    vi.stubEnv('KUN_CF_CACHE_ZONE_ID', '')
    vi.stubEnv('KUN_CF_CACHE_PURGE_API_TOKEN', '')
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', 'site-token')

    const result = await purgeCloudflareCache(['https://www.otoame.top/game'])

    expect(result).toEqual({ status: 200, success: true })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://api.cloudflare.com/client/v4/zones/site-provider-zone/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer site-token' })
      })
    )
  })

  it('splits mixed public URLs by exact site hostname and honors the site token', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', 'site-token')
    const imageUrls = [
      'https://img.otoame.top/a.avif',
      'https://storage.example.net/a.avif',
      'https://www.otoame.top.example.net/a.avif',
      'not a URL'
    ]

    const result = await purgeCloudflareCache([
      'https://WWW.OTOAME.TOP/game?view=1',
      ...imageUrls
    ])

    expect(result).toEqual({ status: 200, success: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/site-provider-zone/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer site-token'
        }),
        body: JSON.stringify({ files: ['https://WWW.OTOAME.TOP/game?view=1'] })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer purge-token'
        }),
        body: JSON.stringify({ files: imageUrls })
      })
    )
  })

  it('routes and deduplicates full URL and scheme-free prefixes after normalization', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')

    await purgeCloudflareCache({
      prefixes: [
        'https://www.otoame.top/api/tag/otomegame?page=1#top',
        'www.otoame.top/api/tag/otomegame?page=2',
        'http://img.otoame.top/patch/7?size=mini#image'
      ]
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/site-provider-zone/purge_cache',
      expect.objectContaining({
        body: JSON.stringify({ prefixes: ['www.otoame.top/api/tag/otomegame'] })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
      expect.objectContaining({
        body: JSON.stringify({ prefixes: ['img.otoame.top/patch/7'] })
      })
    )
  })

  it.each(['', '   '])(
    'treats an empty site zone %j as unconfigured',
    async (zone) => {
      vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', zone)

      await purgePublicPageCache(['/'])

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        'https://api.cloudflare.com/client/v4/zones/zone-id/purge_cache',
        expect.anything()
      )
    }
  )

  it('uses the shared token when the site token contains only whitespace', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', '   ')

    await purgePublicPageCache(['/'])

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://api.cloudflare.com/client/v4/zones/site-provider-zone/purge_cache',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer purge-token'
        })
      })
    )
  })

  it('does not fall back to the default zone when the configured site has no token', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_PURGE_API_TOKEN', '')

    expect(await purgeCloudflareCache(['https://www.otoame.top/'])).toEqual({
      status: 0,
      success: false
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still purges the configured site but reports missing image credentials', async () => {
    vi.stubEnv('KUN_CF_CACHE_ZONE_ID', '')
    vi.stubEnv('KUN_CF_CACHE_PURGE_API_TOKEN', '')
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', 'site-token')

    const result = await purgeCloudflareCache([
      'https://www.otoame.top/',
      'https://img.otoame.top/a.avif'
    ])

    expect(result).toEqual({ status: 0, success: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/zones/site-provider-zone/')
  })

  it.each([
    { status: 200, ok: true, success: false },
    { status: 403, ok: false, success: true }
  ])(
    'does not confirm a mixed purge when one zone fails with $status',
    async (response) => {
      vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
      fetchMock.mockResolvedValueOnce({
        ...response,
        json: async () => ({ success: response.success })
      })

      const result = await purgeCloudflareCache([
        'https://www.otoame.top/',
        'https://img.otoame.top/a.avif'
      ])

      expect(result).toEqual({ status: response.status, success: false })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it('attempts both zones when one request rejects', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    fetchMock.mockRejectedValueOnce(new Error('timed out'))

    const result = await purgeCloudflareCache([
      'https://www.otoame.top/',
      'https://img.otoame.top/a.avif'
    ])

    expect(result).toEqual({ status: 0, success: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('starts both zone requests while the first acknowledgement is pending', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    let acknowledgeFirst!: () => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledgeFirst = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ success: true })
            })
        })
    )

    const pending = purgeCloudflareCache([
      'https://www.otoame.top/',
      'https://img.otoame.top/a.avif'
    ])

    try {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      acknowledgeFirst()
    }
    expect(await pending).toEqual({ status: 200, success: true })
  })

  it('logs the failed zone, hostnames and API errors without credentials or full URLs', async () => {
    vi.stubEnv('KUN_CF_CACHE_SITE_ZONE_ID', 'site-provider-zone')
    vi.stubEnv('KUN_CF_CACHE_SITE_PURGE_API_TOKEN', 'site-token')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        errors: [
          {
            code: 10000,
            message:
              'Authentication error: site-token site-provider-zone purge-token zone-id https://www.otoame.top/private?key=secret'
          }
        ]
      })
    })

    await purgeCloudflareCache(['https://www.otoame.top/private?key=secret'])

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[Cloudflare]'),
      expect.objectContaining({
        zone: 'site',
        status: 403,
        hostnames: ['www.otoame.top'],
        errors: [
          expect.objectContaining({
            code: 10000,
            message: expect.stringContaining('Authentication error')
          })
        ]
      })
    )
    const log = JSON.stringify(vi.mocked(console.error).mock.calls)
    for (const secret of [
      'site-token',
      'site-provider-zone',
      'purge-token',
      'zone-id',
      '/private',
      'key=secret'
    ]) {
      expect(log).not.toContain(secret)
    }
  })

  it.each([[], {}, { files: [], prefixes: [] }])(
    'does not send an empty purge %j',
    async (payload) => {
      expect(await purgeCloudflareCache(payload)).toEqual({
        status: 0,
        success: false
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

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
    fetchMock.mockRejectedValue(
      new Error('timed out at /zones/zone-id with purge-token')
    )

    const result = await purgeCloudflareCache(['https://img.otoame.top/a.avif'])
    expect(result).toEqual({ status: 0, success: false })
    const log = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(log).not.toContain('zone-id')
    expect(log).not.toContain('purge-token')
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
