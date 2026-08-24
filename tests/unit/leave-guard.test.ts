import { describe, expect, it } from 'vitest'
import { getInternalNavigationHref } from '~/utils/leaveGuard'

const CURRENT = 'http://192.168.0.199:3000/edit/rewrite'

const anchor = (href: string, overrides: Partial<{ target: string | null; hasDownload: boolean }> = {}) => ({
  href,
  target: overrides.target ?? null,
  hasDownload: overrides.hasDownload ?? false
})

describe('getInternalNavigationHref', () => {
  it('guards an in-app link that would leave the editor', () => {
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/9b29143f'),
        CURRENT
      )
    ).toBe('/9b29143f')
  })

  it('keeps query and hash so the confirmed navigation lands on the same view', () => {
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/galgame?page=2#list'),
        CURRENT
      )
    ).toBe('/galgame?page=2#list')
  })

  it('ignores in-page anchors on the editor itself', () => {
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/edit/rewrite#gallery'),
        CURRENT
      )
    ).toBeNull()
  })

  it('ignores other origins, new tabs and downloads', () => {
    expect(
      getInternalNavigationHref(anchor('https://vndb.org/v123'), CURRENT)
    ).toBeNull()
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/9b29143f', { target: '_blank' }),
        CURRENT
      )
    ).toBeNull()
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/patch.zip', { hasDownload: true }),
        CURRENT
      )
    ).toBeNull()
  })

  it('treats an explicit _self target as normal in-app navigation', () => {
    expect(
      getInternalNavigationHref(
        anchor('http://192.168.0.199:3000/9b29143f', { target: '_self' }),
        CURRENT
      )
    ).toBe('/9b29143f')
  })

  it('ignores an unparsable href instead of blocking the click', () => {
    expect(getInternalNavigationHref(anchor('javascript:void(0)'), CURRENT)).toBeNull()
  })
})
