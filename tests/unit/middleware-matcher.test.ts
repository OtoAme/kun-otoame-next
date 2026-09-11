import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '~/middleware'

const doesMiddlewareMatch = (url: string) =>
  unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url
  })

describe('middleware matcher', () => {
  it('protects dashboard and both administrator preview paths', () => {
    for (const path of ['/dashboard', '/dashboard/user', '/preview/submission/7', '/preview/resource/8']) {
      expect(doesMiddlewareMatch(`https://www.otoame.top${path}`)).toBe(true)
    }
  })

  it('does not buffer the large admin Sticker import request', () => {
    expect(
      doesMiddlewareMatch(
        'https://www.otoame.top/api/admin/stickers/import?packId=1'
      )
    ).toBe(false)

    expect(
      doesMiddlewareMatch(
        'https://www.otoame.top/api/admin/stickers/import/preview'
      )
    ).toBe(true)
  })

  it('keeps other admin Sticker API routes behind middleware', () => {
    expect(
      doesMiddlewareMatch('https://www.otoame.top/api/admin/stickers/packs')
    ).toBe(true)
  })
})
