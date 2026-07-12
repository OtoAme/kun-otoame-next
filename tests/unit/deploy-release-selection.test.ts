import { describe, expect, it } from 'vitest'
import {
  getReleaseApiPath,
  selectReleaseAsset
} from '~/scripts/deployReleaseSelection'

describe('deploy release selection', () => {
  it('uses latest only when no release tag is supplied', () => {
    expect(getReleaseApiPath('OtoAme/kun-otoame-next')).toBe(
      '/repos/OtoAme/kun-otoame-next/releases/latest'
    )
  })

  it('encodes and pins the requested release tag', () => {
    expect(
      getReleaseApiPath('OtoAme/kun-otoame-next', 'v2026.07.12+reviewed')
    ).toBe('/repos/OtoAme/kun-otoame-next/releases/tags/v2026.07.12%2Breviewed')
  })

  it('returns release.tar.gz only for the exact expected tag', () => {
    expect(
      selectReleaseAsset(
        {
          tag_name: 'v2026.07.12.1200',
          assets: [
            {
              name: 'release.tar.gz',
              browser_download_url: 'https://example.invalid/release.tar.gz'
            }
          ]
        },
        'v2026.07.12.1200'
      )
    ).toBe('https://example.invalid/release.tar.gz')
  })

  it.each([
    [{ tag_name: 'other', assets: [] }, 'expected', 'tag mismatch'],
    [{ tag_name: 'expected', assets: [] }, 'expected', 'release.tar.gz']
  ])('fails closed for an incompatible release: %o', (release, tag, error) => {
    expect(() => selectReleaseAsset(release, tag)).toThrow(error)
  })
})
